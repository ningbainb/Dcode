import type { NativeMcpServerRecord } from "@zcode/shared";
import type { DshMcpServer } from "@zcode/services";

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const STDIO_KEYS = new Set(["type", "command", "args", "env", "enabled", "enable"]);
const HTTP_KEYS = new Set(["type", "url", "headers", "http_headers", "enabled", "enable"]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function toDshServer(record: NativeMcpServerRecord): DshMcpServer | null {
  if (record.scope !== "user" || !NAME.test(record.name)) return null;
  const config: Record<string, unknown> = record.config;
  const type = config.type;
  if (type === undefined || type === "stdio") {
    if (!hasOnlyKeys(config, STDIO_KEYS)) return null;
    if (
      typeof config.command !== "string" ||
      !config.command.trim() ||
      config.command.length > 1024
    )
      return null;
    if (
      config.args !== undefined &&
      (!Array.isArray(config.args) ||
        config.args.length > 64 ||
        !config.args.every((arg) => typeof arg === "string" && arg.length <= 2048))
    )
      return null;
    if (
      config.env !== undefined &&
      (typeof config.env !== "object" ||
        config.env === null ||
        Array.isArray(config.env) ||
        Object.keys(config.env).length > 0)
    )
      return null;
    return {
      serverName: record.name,
      enabled: false,
      transport: "stdio",
      command: config.command,
      args: (config.args as string[] | undefined) ?? [],
      cwd: "",
      envRefs: {},
    };
  }
  if (!["http", "streamableHttp", "streamable-http"].includes(String(type))) return null;
  if (!hasOnlyKeys(config, HTTP_KEYS)) return null;
  if (config.headers !== undefined || config.http_headers !== undefined) return null;
  if (typeof config.url !== "string") return null;
  let url: URL;
  try {
    url = new URL(String(config.url ?? ""));
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  return {
    serverName: record.name,
    enabled: false,
    transport: "streamable-http",
    url: url.href,
    bearerTokenEnv: "",
  };
}

export function prepareZcodeMcpImport(
  source: NativeMcpServerRecord[],
  existing: DshMcpServer[],
): { servers: DshMcpServer[]; imported: number; skipped: number } {
  const servers = [...existing];
  const names = new Set(existing.map((item) => item.serverName));
  names.add("browser");
  names.add("windows_gui");
  let imported = 0;
  let skipped = 0;
  for (const record of source) {
    const server = toDshServer(record);
    if (!server || names.has(server.serverName)) {
      skipped++;
      continue;
    }
    names.add(server.serverName);
    servers.push(server);
    imported++;
  }
  return { servers, imported, skipped };
}
