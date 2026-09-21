import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import type { BackupProject, ICloudBackupService } from "./cloudBackup.js";
import { createGithubBackup, type GithubBackupPort } from "./backupGithub.js";
import {
  canonicalProject,
  createSnapshot,
  projectId,
  restoreSnapshot,
  scanProject,
  snapshotDiff,
} from "./backupSnapshot.js";
import { getZCodeDataRootDir } from "../paths.js";
import { runGit } from "./backupProcess.js";

interface SavedState {
  version: 1;
  device: string;
  account?: string;
  projects: Record<string, BackupProject>;
}
export function createCloudBackupService(options: {
  supported: boolean;
  dataRoot?: string;
  github?: GithubBackupPort;
  schedule?: boolean;
  now?: () => number;
  pollIntervalMs?: number;
}): ICloudBackupService {
  const root = resolve(
    options.dataRoot ?? join(process.env.DCODE_DATA_DIR || getZCodeDataRootDir(), "cloud-backup"),
  );
  const stateFile = join(root, "state.json");
  const github = options.github ?? createGithubBackup(root);
  const now = options.now ?? Date.now;
  let loginController: AbortController | undefined,
    error: string | undefined,
    disposed = false,
    ticking = false;
  const uploads = new Set<AbortController>();
  const operations = new Set<Promise<unknown>>();
  const ensureSupported = () => {
    if (!options.supported || disposed)
      throw new Error("Cloud backup requires the local Windows desktop and Git Credential Manager");
  };
  async function read(): Promise<SavedState> {
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8")) as SavedState;
      if (
        state.version !== 1 ||
        !state.device ||
        !state.projects ||
        typeof state.projects !== "object"
      )
        throw new Error("Invalid backup state; original file preserved");
      return state;
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, device: randomUUID(), projects: {} };
      throw failure;
    }
  }
  const write = (state: SavedState) =>
    atomicWritePrivateTextFile(stateFile, JSON.stringify(state, null, 2));
  const locked = <T>(operation: (state: SavedState) => Promise<T>) => {
    ensureSupported();
    const work = withFileLock(
      stateFile,
      async () => {
        ensureSupported();
        return operation(await read());
      },
      { lockMaxWaitMs: 300000 },
    );
    operations.add(work);
    void work.then(
      () => operations.delete(work),
      () => operations.delete(work),
    );
    return work;
  };
  async function runBackup(state: SavedState, project: BackupProject) {
    if (!project.enabled) throw new Error("Enable this project's cloud backup first");
    if (!state.account || state.account !== project.account)
      throw new Error("Reconnect the account that owns this backup");
    const folder = join(root, projectId(project.path));
    try {
      const captured = await scanProject(project.path, project.excludes, root);
      // 再核对一次，避免 Agent 在逐文件采集期间继续写入而形成不一致快照。
      const verified = await scanProject(project.path, project.excludes, root);
      if (verified.preview.fingerprint !== captured.preview.fingerprint)
        throw new Error("Project changed during capture; retry when writing has finished");
      const previous = project.snapshots.at(-1);
      const snapshot = await createSnapshot(folder, captured, previous?.sha);
      if (snapshot) {
        project.snapshots.push(snapshot);
        project.lastLocal = snapshot.createdAt;
      }
      project.retryAt = now() + project.intervalMinutes * 60000;
      await write(state);
      const pending = project.snapshots.filter((item) => !item.uploaded);
      if (pending.length) {
        ensureSupported();
        const controller = new AbortController();
        uploads.add(controller);
        try {
          await github.upload(
            project.repository,
            project.branch,
            pending.at(-1)!.sha,
            join(folder, "repository.git"),
            project.account,
            controller.signal,
          );
        } finally {
          uploads.delete(controller);
        }
        for (const item of pending) item.uploaded = true;
        project.lastCloud = new Date(now()).toISOString();
      }
      project.failures = 0;
      delete project.lastError;
      await write(state);
    } catch (failure) {
      project.lastError = failure instanceof Error ? failure.message : "Backup failed";
      project.failures += 1;
      project.retryAt = now() + Math.min(60 * 60000, 30000 * 2 ** Math.min(project.failures, 7));
      await write(state);
      throw failure;
    }
  }
  const service: ICloudBackupService = {
    async status(path) {
      if (!options.supported) return { supported: false, loginPending: false };
      const state = await read();
      const canonical = path ? await canonicalProject(path).catch(() => undefined) : undefined;
      return {
        supported: true,
        account: state.account,
        loginPending: Boolean(loginController),
        error,
        project: canonical ? state.projects[projectId(canonical)] : undefined,
      };
    },
    async login() {
      ensureSupported();
      if (loginController) return;
      const controller = new AbortController();
      loginController = controller;
      error = undefined;
      try {
        await locked(async (state) => {
          if (state.account)
            throw new Error("Disconnect the current backup account before signing in again");
          state.account = await github.login(controller.signal);
          if (controller.signal.aborted) throw new Error("Login cancelled");
          await write(state);
        });
      } catch (failure) {
        error = failure instanceof Error ? failure.message : "Login failed";
        throw failure;
      } finally {
        loginController = undefined;
      }
    },
    async cancelLogin() {
      loginController?.abort();
    },
    async disconnect() {
      loginController?.abort();
      await locked(async (state) => {
        for (const project of Object.values(state.projects)) project.enabled = false;
        await write(state);
        if (state.account) await github.disconnect(state.account);
        delete state.account;
        await write(state);
        error = undefined;
      });
    },
    async repositories() {
      ensureSupported();
      return github.repositories();
    },
    async importRemote(inputPath, repository) {
      await locked(async (state) => {
        if (!state.account || !github.download)
          throw new Error("Connect GitHub before reading cloud snapshots");
        const path = await canonicalProject(inputPath),
          id = projectId(path),
          gitDir = join(root, id, "repository.git");
        if (state.projects[id]) throw new Error("This project already has a backup destination");
        await github.download(repository, gitDir, state.account);
        const lines = (
          await runGit([
            "--git-dir",
            gitDir,
            "log",
            "--all",
            "--max-count=100",
            "--format=%H%x09%cI",
          ])
        )
          .toString()
          .trim();
        const snapshots = [];
        for (const line of lines ? lines.split("\n").reverse() : []) {
          const [sha, createdAt] = line.trim().split("\t");
          if (!sha || !createdAt || !/^[a-f0-9]{40,64}$/.test(sha))
            throw new Error("Invalid remote snapshot");
          const files = (await runGit(["--git-dir", gitDir, "ls-tree", "-rz", "--name-only", sha]))
            .toString()
            .split("\0")
            .filter(Boolean).length;
          snapshots.push({ sha, createdAt, files, uploaded: true });
        }
        state.projects[id] = {
          path,
          repository,
          account: state.account,
          enabled: false,
          approved: false,
          branch: `snapshots/${state.device}-${id}`,
          intervalMinutes: 10,
          excludes: [],
          failures: 0,
          snapshots,
          lastCloud: snapshots.at(-1)?.createdAt,
        };
        await write(state);
      });
    },
    async preview(path, excludes) {
      ensureSupported();
      return (await scanProject(await canonicalProject(path), excludes, root)).preview;
    },
    async enable(request) {
      await locked(async (state) => {
        if (!state.account) throw new Error("Connect GitHub first");
        if (![5, 10, 30, 60].includes(request.intervalMinutes))
          throw new Error("Invalid backup interval");
        const path = await canonicalProject(request.path),
          id = projectId(path);
        const scan = await scanProject(path, request.excludes, root);
        if (scan.preview.blocked.length || scan.preview.fingerprint !== request.fingerprint)
          throw new Error(
            "Files changed or are blocked; review a fresh preview before enabling backup",
          );
        const previous = state.projects[id];
        if (
          previous &&
          (previous.repository !== request.repository || previous.account !== state.account)
        )
          throw new Error(
            "Existing snapshots belong to another destination; reconnect their original account and repository",
          );
        await github.ensureRepository(request.repository, request.create, state.account);
        const project: BackupProject = {
          path,
          enabled: true,
          approved: true,
          repository: request.repository,
          account: state.account,
          branch: previous?.branch ?? `snapshots/${state.device}-${id}`,
          intervalMinutes: request.intervalMinutes,
          excludes: request.excludes,
          failures: 0,
          snapshots: previous?.snapshots ?? [],
          lastLocal: previous?.lastLocal,
          lastCloud: previous?.lastCloud,
        };
        state.projects[id] = project;
        await write(state);
        await runBackup(state, project);
      });
    },
    async setEnabled(path, enabled) {
      await locked(async (state) => {
        const project = state.projects[projectId(await canonicalProject(path))];
        if (!project || (enabled && (state.account !== project.account || !project.approved)))
          throw new Error("Review and configure this project's backup first");
        project.enabled = enabled;
        project.retryAt = now();
        await write(state);
      });
    },
    async backup(path) {
      await locked(async (state) => {
        const project = state.projects[projectId(await canonicalProject(path))];
        if (!project) throw new Error("Configure this project's backup first");
        await runBackup(state, project);
      });
    },
    async diff(path, sha) {
      return locked(async (state) => {
        const id = projectId(await canonicalProject(path));
        if (!state.projects[id]?.snapshots.some((item) => item.sha === sha))
          throw new Error("Unknown snapshot");
        return snapshotDiff(join(root, id), sha);
      });
    },
    async restore(path, sha, parentDirectory) {
      return locked(async (state) => {
        const id = projectId(await canonicalProject(path));
        if (!state.projects[id]?.snapshots.some((item) => item.sha === sha))
          throw new Error("Unknown snapshot");
        return restoreSnapshot(join(root, id), sha, parentDirectory);
      });
    },
    async dispose() {
      disposed = true;
      clearInterval(timer);
      loginController?.abort();
      for (const controller of uploads) controller.abort();
      await Promise.allSettled(operations);
    },
  };
  const timer =
    options.supported && options.schedule !== false
      ? setInterval(() => {
          if (ticking || disposed || loginController) return;
          ticking = true;
          void locked(async (state) => {
            for (const project of Object.values(state.projects)) {
              if (disposed) break;
              if (
                project.enabled &&
                state.account === project.account &&
                (project.retryAt ?? 0) <= now()
              )
                await runBackup(state, project).catch(() => {});
            }
          })
            .catch(() => {})
            .finally(() => {
              ticking = false;
            });
        }, options.pollIntervalMs ?? 30000)
      : undefined;
  timer?.unref();
  return service;
}
