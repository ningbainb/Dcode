import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DshRuntimeController } from "../vendor/runtime-controller.mjs";
import { ensureDcodeProfile, PROFILE_NAME } from "./profile.mjs";
import { grantWindowsWorkspaceOwnerRight } from "./windows-workspace-acl.mjs";

export class DshLifecycle extends EventEmitter {
  constructor({ dataDir, executable = process.execPath, controllerFactory, prepareProfile } = {}) {
    super();
    if (!dataDir) throw new TypeError("DCode dataDir is required");
    this.dataDir = dataDir;
    this.dshHome = join(dataDir, "dsh");
    this.logsPath = join(dataDir, "logs");
    this.runtimeTempDir = join(dataDir, "dsh-temp");
    this.executable = executable;
    this.importBridgeToken = randomUUID();
    this.controllerFactory = controllerFactory ?? ((options) => new DshRuntimeController(options));
    this.prepareProfile = prepareProfile ?? ensureDcodeProfile;
    this.generation = 0;
    this.starting = undefined;
    this.controller = undefined;
    this.cookie = "";
  }

  health() {
    const status = this.controller?.status;
    return {
      state:
        this.lastError || status?.error
          ? "error"
          : status?.state === "ready" && this.cookie
            ? "ready"
            : this.starting || status?.state === "starting"
              ? "starting"
              : "stopped",
      ...(this.lastError || status?.error
        ? {
            error:
              "DeepSeek Harness failed to start or stopped unexpectedly. Restart Runtime or open logs.",
          }
        : {}),
      generation: this.generation,
    };
  }

  async start() {
    if (this.controller?.status.state === "ready" && this.cookie) return this.health();
    if (this.starting) return this.starting;
    this.lastError = undefined;
    this.starting = this.startRuntime();
    try {
      return await this.starting;
    } catch (error) {
      this.lastError = error;
      this.cookie = "";
      await appendFile(
        join(this.logsPath, "dsh-runtime.log"),
        `Startup failed: ${error.message}\n`,
      ).catch(() => {});
      this.emit("status", this.health());
      throw new Error("DeepSeek Harness failed to start. Restart Runtime or open logs.", {
        cause: error,
      });
    } finally {
      this.starting = undefined;
    }
  }

  async startRuntime() {
    await mkdir(this.logsPath, { recursive: true });
    await mkdir(this.runtimeTempDir, { recursive: true });
    if (process.platform === "win32") {
      // 0.1.7 的会话临时目录需要 WRITE_OWNER；只修复 Dcode 自有目录，避免改系统 TEMP。
      await grantWindowsWorkspaceOwnerRight(this.runtimeTempDir);
    }
    const { cliPath } = await this.prepareProfile(this.dshHome, this.executable);
    if (!this.controller) {
      this.controller = this.controllerFactory({
        cliPath,
        cwd: this.dataDir,
        dshHome: this.dshHome,
        profileName: PROFILE_NAME,
        executable: this.executable,
        preferredPort: 0,
        runtimeHost: "127.0.0.1",
        autoRestart: false,
        logStore: {
          append: (line) => appendFile(join(this.logsPath, "dsh-runtime.log"), `${line}\n`),
        },
        environmentProvider: () => ({
          DSH_TELEMETRY_DISABLED: "1",
          DCODE_ZCODE_IMPORT_TOKEN: this.importBridgeToken,
          ...(process.platform === "win32"
            ? { TEMP: this.runtimeTempDir, TMP: this.runtimeTempDir }
            : {}),
        }),
      });
      this.controller.on("status", () => this.emit("status", this.health()));
    }
    this.generation += 1;
    await this.controller.start();
    const response = await fetch(this.controller.status.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    this.cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    if (response.status !== 303 || !this.cookie) {
      await this.controller.stop();
      throw new Error("DeepSeek Harness authentication failed. Restart Runtime or open logs.");
    }
    this.origin = new URL(this.controller.status.url).origin;
    this.emit("status", this.health());
    return this.health();
  }

  async stop() {
    await this.starting?.catch(() => {});
    this.cookie = "";
    await this.controller?.stop();
    this.lastError = undefined;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async request(path, options = {}) {
    await this.start();
    try {
      return await fetch(new URL(path, this.origin), {
        ...options,
        headers: { "content-type": "application/json", ...options.headers, cookie: this.cookie },
        signal: options.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error("DeepSeek Harness is not responding. Restart Runtime or open logs.", {
        cause: error,
      });
    }
  }
}
