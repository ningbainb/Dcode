import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import YAML from "yaml";

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["browser", "windows_gui"]);
const FILE_NAME = "dsh-mcp-servers.json";
const EMPTY = "[]\n";

function filePath(dataDir) {
  return join(dataDir, FILE_NAME);
}

function revision(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function envRefs(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Environment references must be a name-to-name object.");
  if (Object.keys(value).length > 32) throw new Error("Too many environment references.");
  const result = {};
  for (const [childName, sourceName] of Object.entries(value)) {
    if (!ENV_NAME.test(childName) || typeof sourceName !== "string" || !ENV_NAME.test(sourceName))
      throw new Error("Environment references must contain valid variable names.");
    result[childName] = sourceName;
  }
  return result;
}

export function validateMcpServers(value, { checkEnvironment = false } = {}) {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Add at most 32 MCP servers.");
  const names = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid MCP server entry.");
    const serverName = String(entry.serverName ?? "").trim();
    if (!NAME.test(serverName) || RESERVED.has(serverName) || names.has(serverName))
      throw new Error("MCP server names must be unique, valid and not reserved.");
    names.add(serverName);
    const enabled = entry.enabled === true;
    if (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
      throw new Error("MCP enabled state must be a boolean.");
    if (entry.transport === "stdio") {
      const command = String(entry.command ?? "").trim();
      const args = entry.args ?? [];
      const cwd = String(entry.cwd ?? "").trim();
      if (!command || command.length > 1024) throw new Error("Enter an MCP command.");
      if (
        !Array.isArray(args) ||
        args.length > 64 ||
        args.some((arg) => typeof arg !== "string" || arg.length > 2048)
      )
        throw new Error("MCP arguments must be a short string list.");
      if (cwd && (!isAbsolute(cwd) || cwd.length > 1024))
        throw new Error("MCP working directory must be an absolute path.");
      const refs = envRefs(entry.envRefs);
      if (enabled && checkEnvironment) {
        for (const variable of Object.values(refs))
          if (!process.env[variable])
            throw new Error(
              `Set ${variable} in the Dcode environment before enabling this server.`,
            );
      }
      return { serverName, enabled, transport: "stdio", command, args, cwd, envRefs: refs };
    }
    if (entry.transport === "streamable-http") {
      let url;
      try {
        url = new URL(String(entry.url ?? ""));
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hash ||
          url.search
        )
          throw new Error();
      } catch {
        throw new Error("Enter an HTTP(S) MCP URL without credentials or query parameters.");
      }
      const bearerTokenEnv = String(entry.bearerTokenEnv ?? "").trim();
      if (bearerTokenEnv && !ENV_NAME.test(bearerTokenEnv))
        throw new Error("Bearer token must reference a valid environment variable name.");
      if (enabled && checkEnvironment && bearerTokenEnv && !process.env[bearerTokenEnv])
        throw new Error(
          `Set ${bearerTokenEnv} in the Dcode environment before enabling this server.`,
        );
      return { serverName, enabled, transport: "streamable-http", url: url.href, bearerTokenEnv };
    }
    throw new Error("Choose stdio or Streamable HTTP for the MCP server.");
  });
}

export async function readMcpServerSettings(dataDir) {
  let raw;
  try {
    raw = await readFile(filePath(dataDir), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    raw = EMPTY;
  }
  if (raw.length > 1024 * 1024) throw new Error("Dcode MCP settings file is too large.");
  return { revision: revision(raw), servers: validateMcpServers(JSON.parse(raw)) };
}

export async function writeMcpServerSettings(dataDir, servers, { checkEnvironment = true } = {}) {
  const normalized = validateMcpServers(servers, { checkEnvironment });
  await mkdir(dataDir, { recursive: true });
  const target = filePath(dataDir);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
  await rename(temporary, target);
  return readMcpServerSettings(dataDir);
}

function envScalar(variable) {
  const scalar = new YAML.Scalar(`process.env.${variable}`);
  scalar.tag = "!!js";
  return scalar;
}

export function mcpServerRows(servers) {
  return validateMcpServers(servers)
    .filter((server) => server.enabled)
    .map((server) => {
      const config =
        server.transport === "stdio"
          ? {
              serverName: server.serverName,
              transport: "stdio",
              command: server.command,
              args: server.args,
              ...(server.cwd ? { cwd: server.cwd } : {}),
              ...(Object.keys(server.envRefs).length
                ? {
                    env: Object.fromEntries(
                      Object.entries(server.envRefs).map(([key, variable]) => [
                        key,
                        envScalar(variable),
                      ]),
                    ),
                  }
                : {}),
            }
          : {
              serverName: server.serverName,
              transport: "streamable-http",
              url: server.url,
              ...(server.bearerTokenEnv
                ? {
                    headers: {
                      Authorization: (() => {
                        const scalar = new YAML.Scalar(
                          `\`Bearer \${process.env.${server.bearerTokenEnv}}\``,
                        );
                        scalar.tag = "!!js";
                        return scalar;
                      })(),
                    },
                  }
                : {}),
            };
      return {
        id: `dcode-mcp-custom-${server.serverName}`,
        name: "@deepseek-ai/dsh-mcp-client",
        config,
      };
    });
}
