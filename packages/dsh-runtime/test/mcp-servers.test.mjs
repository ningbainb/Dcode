import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DshBackend } from "../src/index.mjs";
import {
  readMcpServerSettings,
  validateMcpServers,
  writeMcpServerSettings,
} from "../src/mcp-servers.mjs";
import { writeManagedMcpPatch } from "../src/agent-plugins.mjs";

const root = resolve(import.meta.dirname, "../../../.cache");

async function fixture() {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(join(root, "dsh-mcp-test-"));
  const profileDir = join(dataDir, "profile");
  await mkdir(profileDir);
  return { dataDir, profileDir };
}

const stdio = {
  serverName: "local_tools",
  enabled: true,
  transport: "stdio",
  command: "node",
  args: ["server.mjs"],
  cwd: "",
  envRefs: { API_TOKEN: "DCODE_MCP_TEST_TOKEN" },
};

test("custom MCP settings preserve user patch and store only variable references", async () => {
  process.env.DCODE_MCP_TEST_TOKEN = "synthetic-secret-for-test";
  const { dataDir, profileDir } = await fixture();
  await writeFile(
    join(profileDir, "cordis.patch.yml"),
    "- id: unrelated-user-row\n  disabled: true\n",
  );
  const initial = await readMcpServerSettings(dataDir);
  const saved = await writeMcpServerSettings(dataDir, [
    stdio,
    {
      serverName: "local_http",
      enabled: true,
      transport: "streamable-http",
      url: "http://127.0.0.1:8765/mcp",
      bearerTokenEnv: "DCODE_MCP_TEST_TOKEN",
    },
  ]);
  assert.notEqual(saved.revision, initial.revision);
  await writeManagedMcpPatch(profileDir, dataDir, "node-test");
  const first = await readFile(join(profileDir, "cordis.patch.yml"), "utf8");
  await writeManagedMcpPatch(profileDir, dataDir, "node-test");
  assert.equal(await readFile(join(profileDir, "cordis.patch.yml"), "utf8"), first);
  assert.match(first, /unrelated-user-row/);
  assert.match(first, /dcode-mcp-custom-local_tools/);
  assert.match(first, /!!js process\.env\.DCODE_MCP_TEST_TOKEN/);
  assert.match(first, /!!js ['"]?`Bearer \$\{process\.env\.DCODE_MCP_TEST_TOKEN\}`/);
  assert.ok(!first.includes("synthetic-secret-for-test"));
  assert.ok(
    !(await readFile(join(dataDir, "dsh-mcp-servers.json"), "utf8")).includes(
      "synthetic-secret-for-test",
    ),
  );
  assert.deepEqual((await readMcpServerSettings(dataDir)).servers, saved.servers);
});

test("MCP server validation rejects duplicate names, reserved names and unsafe input", () => {
  assert.throws(() => validateMcpServers([stdio, stdio]), /unique/);
  assert.throws(() => validateMcpServers([{ ...stdio, serverName: "browser" }]), /reserved/);
  assert.throws(
    () => validateMcpServers([{ ...stdio, envRefs: { TOKEN: "TOKEN;evil" } }]),
    /variable names/,
  );
  assert.throws(() => validateMcpServers([{ ...stdio, cwd: "relative" }]), /absolute/);
  assert.throws(
    () =>
      validateMcpServers([
        {
          serverName: "http",
          enabled: true,
          transport: "streamable-http",
          url: "https://user:pass@example.com/mcp",
        },
      ]),
    /without credentials/,
  );
  assert.throws(
    () =>
      validateMcpServers([
        {
          serverName: "http",
          enabled: true,
          transport: "streamable-http",
          url: "https://example.com/mcp?token=secret",
        },
      ]),
    /without credentials/,
  );
});

test("backend rejects stale writes and restores prior MCP state after restart failure", async () => {
  process.env.DCODE_MCP_TEST_TOKEN = "synthetic-secret-for-test";
  const { dataDir } = await fixture();
  const backend = new DshBackend({ dataDir });
  let restarts = 0;
  backend.restart = async () => ({ state: "ready", generation: ++restarts });
  const initial = await backend.listMcpServers();
  const saved = await backend.updateMcpServers([stdio], initial.revision);
  assert.equal(saved.servers.length, 1);
  assert.equal(restarts, 1);
  await assert.rejects(backend.updateMcpServers([], initial.revision), /changed/);
  backend.restart = async () => {
    restarts++;
    throw new Error("restart failed");
  };
  await assert.rejects(backend.updateMcpServers([], saved.revision), /restart failed/);
  assert.deepEqual((await backend.listMcpServers()).servers, saved.servers);
  assert.equal(restarts, 3);
});
