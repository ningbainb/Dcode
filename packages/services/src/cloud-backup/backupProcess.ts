import { spawn } from "node:child_process";
import { terminateProcessTreeAndWait } from "../process/processTreeTerminator.js";

export function isolatedGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(GIT_|GCM_|GH_|GITHUB_)/i.test(key)) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    ...extra,
  };
}

export function runGit(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string | Buffer;
    signal?: AbortSignal;
    timeout?: number;
    limit?: number;
  } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Git operation cancelled"));
      return;
    }
    const startedAt = Date.now();
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: options.env ?? isolatedGitEnv(),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0,
      failed = false,
      stopping = false;
    const finishError = (error: Error) => {
      if (!failed) {
        failed = true;
        reject(error);
      }
    };
    const stop = (reason: string) => {
      if (stopping) return;
      stopping = true;
      // 直接 kill git 会遗留 GCM/HTTP 子进程，沿用宿主按创建标识核对的进程树回收。
      void terminateProcessTreeAndWait(child, {
        ownedProcessStartedAtMs: startedAt,
        forceAfterMs: 1000,
      })
        .catch(() => {})
        .finally(() => finishError(new Error(reason)));
    };
    const onAbort = () => stop("Git operation cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("Git operation timed out"), options.timeout ?? 120000);
    child.on("error", () => finishError(new Error("Git operation unavailable or cancelled")));
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > (options.limit ?? 32 * 1024 * 1024)) {
        stop("Git result exceeds the backup limit");
      } else chunks.push(data);
    });
    // GCM stderr may contain credentials/device codes. Never include it in RPC errors or logs.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (stopping) return;
      if (code !== 0)
        finishError(
          new Error(
            `Git operation failed (${code ?? "cancelled"}); check authentication, permissions or repository rules`,
          ),
        );
      else if (!failed) resolve(Buffer.concat(chunks));
    });
  });
}
