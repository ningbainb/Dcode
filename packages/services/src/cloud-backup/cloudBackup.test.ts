import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createCloudBackupService } from "./cloudBackupService.js";
import {
  canonicalProject,
  createSnapshot,
  scanProject,
  restoreSnapshot,
} from "./backupSnapshot.js";
import { isolatedGitEnv, runGit } from "./backupProcess.js";
import type { GithubBackupPort } from "./backupGithub.js";
import { createGithubBackup } from "./backupGithub.js";

const testRoot = process.env.DCODE_TEST_ROOT;
if (!testRoot) throw new Error("DCODE_TEST_ROOT must point inside the workspace");
await mkdir(testRoot, { recursive: true });
async function fixture() {
  const root = await mkdtemp(join(testRoot!, "backup-")),
    path = join(root, "project");
  await mkdir(path);
  await runGit(["init", path]);
  await writeFile(join(path, "tracked.txt"), "baseline\n");
  await writeFile(join(path, "deleted.txt"), "old\n");
  await writeFile(join(path, ".env"), "SECRET=private\n");
  await runGit(["-C", path, "add", "."]);
  await runGit([
    "-C",
    path,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "Baseline",
  ]);
  return { root, path: await canonicalProject(path) };
}
test("independent snapshots include dirty/new/deleted files without changing source index or HEAD", async () => {
  const { root, path } = await fixture();
  const head = (await runGit(["-C", path, "rev-parse", "HEAD"])).toString();
  await writeFile(join(path, "tracked.txt"), "staged\n");
  await runGit(["-C", path, "add", "tracked.txt"]);
  await writeFile(join(path, "tracked.txt"), "unstaged final\n");
  await unlink(join(path, "deleted.txt"));
  await writeFile(join(path, "新 file.txt"), "new contents\n");
  await writeFile(join(path, ".gitignore"), "ignored.txt\n");
  await writeFile(join(path, "ignored.txt"), "ignored");
  const index = await readFile(join(path, ".git/index"));
  const data = join(root, "backup");
  const captured = await scanProject(path, [], data);
  assert.ok(captured.preview.files.includes("新 file.txt"));
  assert.ok(!captured.preview.files.includes("deleted.txt"));
  assert.ok(!captured.preview.files.includes("ignored.txt"));
  assert.ok(captured.preview.excluded.some((item) => item.path === ".env"));
  const snapshot = await createSnapshot(data, captured);
  assert.ok(snapshot);
  assert.equal(await createSnapshot(data, captured, snapshot.sha), null);
  const restored = await restoreSnapshot(data, snapshot.sha, root);
  assert.equal(await readFile(join(restored, "tracked.txt"), "utf8"), "unstaged final\n");
  assert.equal(await readFile(join(restored, "新 file.txt"), "utf8"), "new contents\n");
  await assert.rejects(readFile(join(restored, ".env")));
  assert.deepEqual(await readFile(join(path, ".git/index")), index);
  assert.equal((await runGit(["-C", path, "rev-parse", "HEAD"])).toString(), head);
  assert.equal((await runGit(["-C", path, "remote"])).toString(), "");
});
test("blocked content cannot enter snapshots and protected exclusions cannot be undone", async () => {
  const { root, path } = await fixture();
  await writeFile(join(path, "credentials.txt"), `ghp_${"a".repeat(36)}`);
  const captured = await scanProject(path, [], join(root, "backup"));
  assert.equal(captured.preview.blocked.length, 1);
  await assert.rejects(createSnapshot(join(root, "backup"), captured), /blocked/);
  await assert.rejects(scanProject(path, ["!.env"], root), /protected/);
});
test("durable queue retries after restart, verifies remote commit, pauses and restores", async () => {
  const { root, path } = await fixture(),
    dataRoot = join(root, "backup"),
    remote = join(root, "remote.git");
  await runGit(["init", "--bare", remote]);
  let online = false,
    uploads = 0,
    identity = "tester";
  const github: GithubBackupPort = {
    async login() {
      return "tester";
    },
    async disconnect() {},
    async repositories() {
      return ["tester/backup"];
    },
    async download(_repository, gitDir) {
      await runGit(["init", "--bare", gitDir]);
      await runGit([
        "--git-dir",
        gitDir,
        "fetch",
        remote,
        "+refs/heads/snapshots/*:refs/remotes/cloud/*",
      ]);
    },
    async ensureRepository(repository) {
      assert.equal(repository, "tester/backup");
    },
    async upload(_repository, branch, sha, gitDir, account) {
      assert.equal(account, identity);
      if (!online) throw new Error("Offline fixture");
      uploads++;
      await runGit(["--git-dir", gitDir, "push", remote, `${sha}:refs/heads/${branch}`]);
      assert.ok(
        (await runGit(["ls-remote", remote, `refs/heads/${branch}`])).toString().startsWith(sha),
      );
    },
  };
  let service = createCloudBackupService({ supported: true, dataRoot, github, schedule: false });
  await service.login();
  const preview = await service.preview(path, []);
  await assert.rejects(
    service.enable({
      path,
      repository: "tester/backup",
      create: true,
      intervalMinutes: 10,
      excludes: [],
      fingerprint: "stale",
    }),
    /review/,
  );
  await assert.rejects(
    service.enable({
      path,
      repository: "tester/backup",
      create: true,
      intervalMinutes: 10,
      excludes: [],
      fingerprint: preview.fingerprint,
    }),
    /Offline/,
  );
  let status = await service.status(path);
  assert.equal(status.project?.snapshots.length, 1);
  assert.equal(status.project?.lastCloud, undefined);
  await service.dispose();
  service = createCloudBackupService({ supported: true, dataRoot, github, schedule: false });
  online = true;
  await service.backup(path);
  status = await service.status(path);
  assert.equal(uploads, 1);
  assert.equal(status.project?.snapshots.length, 1);
  assert.equal(status.project?.snapshots[0]?.uploaded, true);
  await service.backup(path);
  assert.equal(uploads, 1);
  await service.setEnabled(path, false);
  await assert.rejects(service.backup(path), /Enable/);
  await service.setEnabled(path, true);
  await writeFile(join(path, "tracked.txt"), "second snapshot\n");
  await Promise.all([service.backup(path), service.backup(path)]);
  assert.equal(uploads, 2);
  status = await service.status(path);
  assert.equal(status.project?.snapshots.length, 2);
  const sha = status.project!.snapshots.at(-1)!.sha;
  assert.ok((await service.diff(path, sha)).includes("second snapshot"));
  const restored = await service.restore(path, sha, root);
  assert.equal(await readFile(join(restored, "tracked.txt"), "utf8"), "second snapshot\n");
  await assert.rejects(service.restore(path, "../../invalid", root), /Unknown/);
  const recovered = createCloudBackupService({
    supported: true,
    dataRoot: join(root, "new-device"),
    github,
    schedule: false,
  });
  await recovered.login();
  await recovered.importRemote(path, "tester/backup");
  const imported = (await recovered.status(path)).project!;
  assert.equal(imported.enabled, false);
  assert.equal(imported.snapshots.length, 2);
  await assert.rejects(recovered.setEnabled(path, true), /Review/);
  const cloudCopy = await recovered.restore(path, imported.snapshots.at(-1)!.sha, root);
  assert.equal(await readFile(join(cloudCopy, "tracked.txt"), "utf8"), "second snapshot\n");
  await recovered.dispose();
  identity = "other";
  await writeFile(join(path, "tracked.txt"), "third\n");
  await assert.rejects(service.backup(path));
  assert.equal((await service.status(path)).project!.snapshots.at(-1)!.uploaded, false);
  await service.disconnect();
  assert.equal((await service.status(path)).project!.enabled, false);
  await service.dispose();
});
test(
  "Windows GCM uses isolated DPAPI files, without plaintext credentials",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(testRoot!, "dpapi-"));
    const env = isolatedGitEnv({
      GCM_CREDENTIAL_STORE: "dpapi",
      GCM_DPAPI_STORE_PATH: root,
      GCM_NAMESPACE: "dcode-cloud-backup-test",
    });
    const input =
      "protocol=https\nhost=backup-test.invalid\nusername=fixture\npassword=synthetic-backup-test-secret\n\n";
    await runGit(["credential-manager", "store"], { env, input });
    const result = await runGit(["credential-manager", "get"], {
      env,
      input: "protocol=https\nhost=backup-test.invalid\nusername=fixture\n\n",
    });
    assert.ok(result.toString().includes("password=synthetic-backup-test-secret"));
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    assert.ok(files.some((file) => file.isFile()));
    for (const file of files.filter((item) => item.isFile()))
      assert.ok(
        !(await readFile(join(file.parentPath, file.name))).includes(
          Buffer.from("synthetic-backup-test-secret"),
        ),
      );
  },
);

test("GitHub adapter uses browser auth and rejects public destinations or changed accounts before push", async () => {
  const root = await mkdtemp(join(testRoot!, "github-port-"));
  let privateRepo = true,
    identity = "tester",
    pushes = 0,
    login = false;
  const port = createGithubBackup(root, {
    async runGit(args, options) {
      assert.equal(options?.env?.GCM_CREDENTIAL_STORE, "dpapi");
      assert.equal(options?.env?.GCM_DPAPI_STORE_PATH, join(root, "credentials"));
      if (args.includes("login")) {
        login = true;
        assert.ok(args.includes("--browser"));
      }
      if (args.includes("push")) pushes++;
      return Buffer.from(args.includes("get") ? "password=synthetic-token\n" : "");
    },
    async fetch(url, init) {
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Bearer synthetic-token",
      );
      return new Response(
        JSON.stringify(
          String(url).endsWith("/user")
            ? { login: identity }
            : {
                private: privateRepo,
                archived: false,
                permissions: { push: true },
                owner: { login: "tester" },
                description: "DCode private snapshot backup",
              },
        ),
        { status: 200 },
      );
    },
  });
  assert.equal(await port.login(new AbortController().signal), "tester");
  assert.equal(login, true);
  await port.ensureRepository("tester/backup", false, "tester");
  privateRepo = false;
  await assert.rejects(
    port.upload(
      "tester/backup",
      "snapshots/abcd",
      "a".repeat(40),
      root,
      "tester",
      new AbortController().signal,
    ),
    /private/,
  );
  privateRepo = true;
  identity = "other";
  await assert.rejects(
    port.upload(
      "tester/backup",
      "snapshots/abcd",
      "a".repeat(40),
      root,
      "tester",
      new AbortController().signal,
    ),
    /account changed/,
  );
  assert.equal(pushes, 0);
});

test("automatic scheduling resumes an eligible project and stops after pause", async () => {
  const { root, path } = await fixture();
  let clock = Date.now(),
    uploads = 0;
  const github: GithubBackupPort = {
    async login() {
      return "timer";
    },
    async disconnect() {},
    async repositories() {
      return [];
    },
    async ensureRepository() {},
    async upload() {
      uploads++;
    },
  };
  const service = createCloudBackupService({
    supported: true,
    dataRoot: join(root, "data"),
    github,
    now: () => clock,
    pollIntervalMs: 20,
  });
  try {
    await service.login();
    const preview = await service.preview(path, []);
    await service.enable({
      path,
      repository: "timer/backup",
      create: true,
      intervalMinutes: 5,
      excludes: [],
      fingerprint: preview.fingerprint,
    });
    assert.equal(uploads, 1);
    await writeFile(join(path, "tracked.txt"), "scheduled\n");
    clock += 6 * 60000;
    const deadline = Date.now() + 30000;
    while (uploads < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(uploads, 2);
    await service.setEnabled(path, false);
    await writeFile(join(path, "tracked.txt"), "paused\n");
    clock += 6 * 60000;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(uploads, 2);
  } finally {
    await service.dispose();
  }
});
