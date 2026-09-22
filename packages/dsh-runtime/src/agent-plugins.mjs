import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import YAML from "yaml";

const require = createRequire(import.meta.url);
const MARKER_START = "# Dcode managed MCP plugins begin";
const MARKER_END = "# Dcode managed MCP plugins end";
const WINDOWS_GUI_VERSION = "0.1.0";
const PLUGIN_IDS = ["browser", "windowsGui"];

export function browserCliPath() {
  return join(dirname(require.resolve("@playwright/mcp/package.json")), "cli.js");
}

export function windowsGuiExecutable(dataDir) {
  return join(dataDir, "extensions", "windows-gui-mcp", "Scripts", "windows-gui-mcp.exe");
}

function settingsPath(dataDir) {
  return join(dataDir, "dsh-agent-plugins.json");
}

export async function readAgentPluginSettings(dataDir) {
  let raw;
  try {
    raw = await readFile(settingsPath(dataDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { browser: false, windowsGui: false };
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.browser !== "boolean" || typeof parsed.windowsGui !== "boolean") {
    throw new Error("Dcode Agent plugin settings are invalid.");
  }
  return { browser: parsed.browser, windowsGui: parsed.windowsGui };
}

export async function writeAgentPluginSettings(dataDir, settings) {
  await mkdir(dataDir, { recursive: true });
  const path = settingsPath(dataDir);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(temporary, path);
}

export async function getAgentPluginStatus(dataDir) {
  const enabled = await readAgentPluginSettings(dataDir);
  let browserAvailable = false;
  try {
    browserAvailable = existsSync(browserCliPath());
  } catch {
    /* package is not deployed */
  }
  return {
    browser: { enabled: enabled.browser, available: process.platform === "win32" && browserAvailable },
    windowsGui: {
      enabled: enabled.windowsGui,
      available: process.platform === "win32" && existsSync(windowsGuiExecutable(dataDir)),
      supported: process.platform === "win32",
    },
  };
}

function managedRows(settings, dataDir, nodeExecutable) {
  const rows = [];
  if (settings.browser) {
    if (process.platform !== "win32")
      throw new Error("Dcode browser control currently requires Windows and Microsoft Edge.");
    if (!existsSync(browserCliPath())) throw new Error("Bundled Playwright MCP is missing.");
    rows.push({
      id: "dcode-mcp-browser",
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "browser",
        transport: "stdio",
        command: nodeExecutable,
        args: [
          browserCliPath(),
          "--browser",
          process.platform === "win32" ? "msedge" : "chromium",
          "--isolated",
          "--no-webmcp",
        ],
      },
    });
  }
  if (settings.windowsGui) {
    if (process.platform !== "win32")
      throw new Error("Windows desktop control is only available on Windows.");
    const command = windowsGuiExecutable(dataDir);
    if (!existsSync(command))
      throw new Error("Install Windows GUI MCP before enabling computer control.");
    rows.push({
      id: "dcode-mcp-windows-gui",
      name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "windows_gui", transport: "stdio", command },
    });
  }
  return rows;
}

export async function writeManagedMcpPatch(profileDir, dataDir, nodeExecutable) {
  const patchPath = join(profileDir, "cordis.patch.yml");
  const settings = await readAgentPluginSettings(dataDir);
  const rows = managedRows(settings, dataDir, nodeExecutable);
  let current;
  try {
    current = await readFile(patchPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    current = "[]\n";
  }
  const begin = current.indexOf(MARKER_START);
  const end = current.indexOf(MARKER_END);
  if (begin < 0 !== end < 0 || (begin >= 0 && end < begin)) {
    throw new Error("Dcode managed MCP section in the DSH profile is damaged.");
  }
  const withoutManaged =
    begin < 0
      ? current.trim()
      : `${current.slice(0, begin)}${current.slice(end + MARKER_END.length)}`.trim();
  const userPatch = withoutManaged === "[]" ? "" : withoutManaged;
  const managed = rows.length
    ? `${MARKER_START}\n${YAML.stringify([{ insert: rows }]).trimEnd()}\n${MARKER_END}`
    : "";
  const next = [userPatch, managed].filter(Boolean).join("\n\n") || "[]";
  if (`${next}\n` !== current) await writeFile(patchPath, `${next}\n`);
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk) => {
      output = `${output}${chunk}`.slice(-5000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} exited with ${code}: ${output.trim()}`));
    });
  });
}

export async function installWindowsGuiMcp(dataDir) {
  if (process.platform !== "win32")
    throw new Error("Windows desktop control is only available on Windows.");
  const version = await run(
    "py",
    ["-3", "-c", "import sys; print(sys.version_info.major, sys.version_info.minor)"],
    15000,
  );
  const [major, minor] = version.split(/\s+/).map(Number);
  if (major !== 3 || minor < 12) throw new Error("Python 3.12 or newer is required.");
  const environment = join(dataDir, "extensions", "windows-gui-mcp");
  await mkdir(dirname(environment), { recursive: true });
  const python = join(environment, "Scripts", "python.exe");
  if (!existsSync(python)) await run("py", ["-3", "-m", "venv", environment], 60000);
  await run(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--progress-bar",
      "off",
      `windows-gui-mcp[windows]==${WINDOWS_GUI_VERSION}`,
      // 0.1.0 使用 MCP 1.x 的 Server.list_tools 装饰器；MCP 2.x 已移除该接口。
      "mcp==1.30.0",
    ],
    600000,
  );
  const executable = windowsGuiExecutable(dataDir);
  await run(executable, ["--version"], 15000);
  return getAgentPluginStatus(dataDir);
}

export function assertAgentPluginId(id) {
  if (!PLUGIN_IDS.includes(id)) throw new Error("Unknown Dcode Agent plugin.");
}
