import type { DshBackend } from "@dcode/dsh-runtime";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Emitter } from "@zcode/rpc";
import type { DshEvent, IDshService } from "./dsh.js";
import { getZCodeDataRootDir } from "../paths.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

export function createDshService(autoStart = false): IDshService {
  const events = new Emitter<DshEvent>();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedRoot = process.env.DCODE_RUNTIME_DIR || (resourcesPath ? join(resourcesPath, "dsh-runtime") : "");
  const packagedEntry = packagedRoot && join(packagedRoot, "src", "index.mjs");
  const backend: Promise<DshBackend> = (packagedEntry && existsSync(packagedEntry)
    ? import(pathToFileURL(packagedEntry).href)
    : import("@dcode/dsh-runtime")).then((module: typeof import("@dcode/dsh-runtime")) => {
      const executable = packagedRoot && join(packagedRoot, process.platform === "win32" ? "node.exe" : "node");
      const instance = new module.DshBackend({
        dataDir: process.env.DCODE_DATA_DIR || getZCodeDataRootDir(),
        executable: process.env.DCODE_NODE_PATH || (executable && existsSync(executable) ? executable : process.execPath),
      });
      instance.on("event", (event: DshEvent) => events.fire(event));
      return instance;
    });
  const service: IDshService = {
    onEvent: events.event,
    start: async () => (await backend).start(),
    stop: async () => (await backend).stop(),
    restart: async () => (await backend).restart(),
    health: async () => (await backend).health(),
    listModels: async () => (await backend).listModels(),
    configureProvider: async (config) => (await backend).configureProvider(config),
    listSessions: async (path) => (await backend).listSessions(path),
    createSession: async (path, model) => (await backend).createSession(path, model),
    resumeSession: async (id) => (await backend).resumeSession(id),
    sendMessage: async (id, text, model) => (await backend).sendMessage(id, text, model),
    cancel: async (id) => (await backend).cancel(id),
    respondApproval: async (id, requestId, approved) => (await backend).respondApproval(id, requestId, approved),
    getLogsPath: async () => (await backend).getLogsPath(),
  };
  if (autoStart) void service.start().catch((error: unknown) => {
    createServiceLogger("dcode-dsh").error("DeepSeek Harness startup failed", error);
  });
  return service;
}
