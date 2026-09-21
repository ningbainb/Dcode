import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import type { Ignore } from "ignore";
import type { BackupPreview, BackupSnapshot } from "./cloudBackup.js";
import { isolatedGitEnv, runGit } from "./backupProcess.js";

const MAX_BYTES = 250 * 1024 * 1024;
const defaultExcludes = [
  ".git",
  ".dcode",
  ".data",
  ".cache",
  ".tools",
  "node_modules",
  "dist",
  "build",
  "artifacts",
  ".github/workflows",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  ".npmrc",
  ".pypirc",
];
const secret =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})/;
export const projectId = (path: string) =>
  createHash("sha256")
    .update(process.platform === "win32" ? path.toLowerCase() : path)
    .digest("hex")
    .slice(0, 24);
export async function canonicalProject(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Select an absolute local Git project path");
  const root = await realpath(path);
  const top = (await runGit(["-C", root, "rev-parse", "--show-toplevel"])).toString().trim();
  if ((await realpath(top)) !== root)
    throw new Error("Select the root folder of the Git repository");
  return root;
}
export interface CapturedFiles {
  preview: BackupPreview;
  contents: Map<string, Buffer>;
  modes: Map<string, string>;
}
export async function scanProject(
  path: string,
  excludes: string[],
  dataRoot: string,
): Promise<CapturedFiles> {
  if (
    excludes.length > 100 ||
    excludes.some((rule) => rule.length > 500 || rule.includes("\0") || rule.startsWith("!"))
  )
    throw new Error("Invalid exclusion rules; protected files cannot be re-included");
  const matcher = (ignore as unknown as () => Ignore)().add(defaultExcludes).add(excludes);
  const entries = (
    await runGit(["-C", path, "ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (entries.length > 20000)
    throw new Error("Backup supports up to 20,000 files; exclude generated content first");
  const contents = new Map<string, Buffer>(),
    modes = new Map<string, string>();
  const preview: BackupPreview = {
    fingerprint: "",
    files: [],
    bytes: 0,
    excluded: [],
    blocked: [],
  };
  const digest = createHash("sha256").update(JSON.stringify(excludes));
  for (const file of [...new Set(entries)].sort()) {
    const local = resolve(path, file),
      rel = relative(path, local);
    if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Invalid repository file path");
    if (matcher.ignores(file) || local === dataRoot || local.startsWith(`${dataRoot}${sep}`)) {
      preview.excluded.push({ path: file, reason: "Excluded by backup rules" });
      continue;
    }
    const stat = await lstat(local).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(local)) !== local) {
      preview.blocked.push({
        path: file,
        reason: "Links, submodules and special files are not supported",
      });
      continue;
    }
    if (stat.size >= 100 * 1024 * 1024) {
      preview.blocked.push({ path: file, reason: "File exceeds the 100 MiB limit" });
      continue;
    }
    if (preview.bytes + stat.size > MAX_BYTES)
      throw new Error("Snapshot exceeds 250 MiB; exclude large generated files");
    const bytes = await readFile(local);
    const after = await lstat(local);
    if (stat.mtimeMs !== after.mtimeMs || stat.size !== after.size)
      throw new Error("Files are changing; retry when writing has finished");
    const text = bytes.toString("utf8");
    if (secret.test(text) || text.startsWith("version https://git-lfs.github.com/spec/v1")) {
      preview.blocked.push({
        path: file,
        reason: "Possible credential or LFS pointer; exclude this file before backup",
      });
      continue;
    }
    contents.set(file, bytes);
    modes.set(file, stat.mode & 0o111 ? "100755" : "100644");
    preview.files.push(file);
    preview.bytes += bytes.length;
    digest.update(file).update("\0").update(bytes).update("\0").update(modes.get(file)!);
  }
  preview.fingerprint = digest.digest("hex");
  return { preview, contents, modes };
}

export async function createSnapshot(
  root: string,
  captured: CapturedFiles,
  previous?: string,
): Promise<BackupSnapshot | null> {
  if (captured.preview.blocked.length)
    throw new Error("Resolve blocked files before creating a snapshot");
  await mkdir(root, { recursive: true });
  const repository = join(root, "repository.git");
  await runGit(["init", "--bare", repository]);
  const stage = join(root, `capture-${randomUUID()}`);
  await mkdir(stage);
  const git = (args: string[], input?: string) =>
    runGit(["--git-dir", repository, "-c", "core.autocrlf=false", ...args], {
      env: isolatedGitEnv({
        GIT_INDEX_FILE: join(stage, "index"),
        GIT_AUTHOR_NAME: "DCode Backup",
        GIT_AUTHOR_EMAIL: "backup@dcode.local",
        GIT_COMMITTER_NAME: "DCode Backup",
        GIT_COMMITTER_EMAIL: "backup@dcode.local",
      }),
      input,
    });
  try {
    const paths: string[] = [];
    for (const [file, bytes] of captured.contents) {
      const target = join(stage, "files", file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      paths.push(JSON.stringify(target.replaceAll("\\", "/")));
    }
    const hashes = paths.length
      ? (await git(["hash-object", "-w", "--no-filters", "--stdin-paths"], `${paths.join("\n")}\n`))
          .toString()
          .trim()
          .split("\n")
      : [];
    await git(["read-tree", "--empty"]);
    if (hashes.length)
      await git(
        ["update-index", "-z", "--index-info"],
        captured.preview.files
          .map((file, i) => `${captured.modes.get(file)} ${hashes[i]}\t${file}\0`)
          .join(""),
      );
    const tree = (await git(["write-tree"])).toString().trim();
    if (previous && (await git(["rev-parse", `${previous}^{tree}`])).toString().trim() === tree)
      return null;
    const createdAt = new Date().toISOString();
    const sha = (
      await git(
        ["commit-tree", tree, ...(previous ? ["-p", previous] : [])],
        `DCode snapshot ${createdAt}\n`,
      )
    )
      .toString()
      .trim();
    await git(["update-ref", "refs/heads/local-snapshots", sha]);
    return { sha, createdAt, files: captured.preview.files.length, uploaded: false };
  } finally {
    // 只清理本次在隔离数据目录创建的 capture；绝不删除原项目文件。
    await rm(stage, { recursive: true, force: true });
  }
}

export async function snapshotDiff(root: string, sha: string): Promise<string> {
  return (
    await runGit(
      [
        "--git-dir",
        join(root, "repository.git"),
        "show",
        "--format=short",
        "--no-ext-diff",
        "--no-textconv",
        sha,
      ],
      { limit: 8 * 1024 * 1024 },
    )
  ).toString();
}
export async function restoreSnapshot(root: string, sha: string, parent: string): Promise<string> {
  const destination = join(
    await realpath(parent),
    `dcode-restore-${sha.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(destination);
  const git = (args: string[]) =>
    runGit(["--git-dir", join(root, "repository.git"), ...args], { limit: MAX_BYTES });
  const entries = (await git(["ls-tree", "-rz", sha])).toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const split = entry.indexOf("\t"),
      metadata = entry.slice(0, split).split(" "),
      file = entry.slice(split + 1);
    const target = resolve(destination, file),
      rel = relative(destination, target);
    if (
      !["100644", "100755"].includes(metadata[0]!) ||
      !rel ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      file.split(/[\\/]/).some((part) => part.toLowerCase() === ".git" || part.includes(":"))
    )
      throw new Error("Unsafe snapshot path");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await git(["cat-file", "blob", metadata[2]!]), {
      flag: "wx",
      mode: metadata[0] === "100755" ? 0o755 : 0o644,
    });
  }
  return destination;
}
export function suggestedRepository(path: string): string {
  return `dcode-backup-${basename(path).replace(/[^a-zA-Z0-9_-]/g, "-")}-${projectId(path).slice(0, 6)}`;
}
