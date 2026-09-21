import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolatedGitEnv, runGit as nativeRunGit } from "./backupProcess.js";

const MARKER = "DCode private snapshot backup";
export interface GithubBackupPort {
  download?(repository: string, gitDir: string, account: string): Promise<void>;
  login(signal: AbortSignal): Promise<string>;
  disconnect(account: string): Promise<void>;
  repositories(): Promise<string[]>;
  ensureRepository(fullName: string, create: boolean, account: string): Promise<void>;
  upload(
    repository: string,
    branch: string,
    sha: string,
    gitDir: string,
    account: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export function createGithubBackup(
  root: string,
  dependencies: { runGit?: typeof nativeRunGit; fetch?: typeof globalThis.fetch } = {},
): GithubBackupPort {
  const runGit = dependencies.runGit ?? nativeRunGit;
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const env = (interactive = false) =>
    isolatedGitEnv({
      GCM_NAMESPACE: "dcode-cloud-backup",
      GCM_CREDENTIAL_STORE: "dpapi",
      GCM_DPAPI_STORE_PATH: join(root, "credentials"),
      GCM_INTERACTIVE: interactive ? "always" : "never",
      GCM_GUI_PROMPT: "0",
      GCM_TRACE: "0",
    });
  const manager = (args: string[], input?: string, signal?: AbortSignal) =>
    runGit(["credential-manager", ...args], {
      env: env(args.includes("login")),
      input,
      cwd: root,
      signal,
      timeout: 300000,
    });
  async function token(account?: string): Promise<string> {
    const output = (
      await manager(
        ["get"],
        `protocol=https\nhost=github.com\n${account ? `username=${account}\n` : ""}\n`,
      )
    ).toString();
    const password = output
      .split(/\r?\n/)
      .find((line) => line.startsWith("password="))
      ?.slice(9);
    if (!password) throw new Error("GitHub login is required");
    return password;
  }
  async function api(route: string, account?: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`https://api.github.com${route}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${await token(account)}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `GitHub request failed (${response.status}); check login, access, rate limits or repository rules`,
      );
    return response.json();
  }
  async function identity(account?: string): Promise<string> {
    const user = (await api("/user", account)) as { login: string };
    if (!/^[a-zA-Z0-9-]+$/.test(user.login)) throw new Error("Invalid GitHub identity");
    return user.login;
  }
  const validate = (repository: string) => {
    if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
      throw new Error("Use owner/repository for the private destination");
  };
  async function check(repository: string, account: string) {
    validate(repository);
    if ((await identity(account)).toLowerCase() !== account.toLowerCase())
      throw new Error("GitHub account changed; reconnect before uploading");
    const repo = (await api(`/repos/${repository}`, account)) as {
      private: boolean;
      archived: boolean;
      description: string;
      permissions?: { push: boolean };
      owner: { login: string };
    };
    if (
      !repo.private ||
      repo.archived ||
      !repo.permissions?.push ||
      repo.description !== MARKER ||
      repo.owner.login.toLowerCase() !== account.toLowerCase()
    ) {
      throw new Error("Destination must be your private, writable DCode backup repository");
    }
  }
  return {
    async download(repository, gitDir, account) {
      await check(repository, account);
      await runGit(["init", "--bare", gitDir]);
      await runGit(
        [
          "--git-dir",
          gitDir,
          "-c",
          "credential.helper=",
          "-c",
          "credential.helper=manager",
          "-c",
          "credential.useHttpPath=false",
          "fetch",
          "--no-tags",
          `https://${account}@github.com/${repository}.git`,
          "+refs/heads/snapshots/*:refs/remotes/cloud/*",
        ],
        { env: env(), timeout: 180000 },
      );
    },
    async login(signal) {
      await mkdir(root, { recursive: true });
      await mkdir(join(root, "credentials"), { recursive: true });
      await manager(
        ["github", "login", "--url", "https://github.com", "--browser", "--force"],
        undefined,
        signal,
      );
      return identity();
    },
    async disconnect(account) {
      await manager(["github", "logout", account]);
    },
    async repositories() {
      const repositories = (await api(
        "/user/repos?affiliation=owner&visibility=private&sort=updated&per_page=100",
      )) as Array<{ full_name: string; description: string; private: boolean }>;
      return repositories
        .filter((repo) => repo.private && repo.description === MARKER)
        .map((repo) => repo.full_name);
    },
    async ensureRepository(repository, create, account) {
      validate(repository);
      if (repository.split("/")[0]!.toLowerCase() !== account.toLowerCase())
        throw new Error("Choose a repository owned by the connected account");
      if (create)
        await api("/user/repos", account, {
          name: repository.split("/")[1],
          private: true,
          description: MARKER,
          has_issues: false,
          has_projects: false,
          has_wiki: false,
          auto_init: false,
        });
      await check(repository, account);
    },
    async upload(repository, branch, sha, gitDir, account, signal) {
      await check(repository, account);
      if (!/^snapshots\/[a-f0-9-]+$/.test(branch) || !/^[a-f0-9]{40,64}$/.test(sha))
        throw new Error("Invalid backup reference");
      const remote = `https://${account}@github.com/${repository}.git`;
      const options = { env: env(), signal, timeout: 180000 };
      const base = [
        "--git-dir",
        gitDir,
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=manager",
        "-c",
        "credential.useHttpPath=false",
      ];
      await runGit(
        [...base, "push", "--porcelain", remote, `${sha}:refs/heads/${branch}`],
        options,
      );
      const result = (
        await runGit([...base, "ls-remote", remote, `refs/heads/${branch}`], options)
      ).toString();
      if (!result.startsWith(`${sha}\t`))
        throw new Error("Remote snapshot was not confirmed; upload will retry");
    },
  };
}
