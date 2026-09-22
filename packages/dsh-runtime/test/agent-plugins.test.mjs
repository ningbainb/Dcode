import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import YAML from "yaml";
import { DshBackend } from "../src/index.mjs";
import {
  assertAgentPluginId,
  getAgentPluginStatus,
  readAgentPluginSettings,
  writeAgentPluginSettings,
  writeManagedMcpPatch,
} from "../src/agent-plugins.mjs";

async function fixture(callback) {
  const root = await mkdtemp(resolve(import.meta.dirname, "../../../../.dcode-agent-plugins-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  try {
    await callback(root, profile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Agent plugins default off and invalid IDs fail closed", async () => {
  await fixture(async (root) => {
    assert.deepEqual(await readAgentPluginSettings(root), { browser: false, windowsGui: false });
    assert.equal((await getAgentPluginStatus(root)).browser.enabled, false);
    assert.throws(() => assertAgentPluginId("unknown"), /Unknown/);
  });
});

test("managed MCP patch is idempotent and preserves user rows", async () => {
  await fixture(async (root, profile) => {
    const patch = join(profile, "cordis.patch.yml");
    await writeFile(patch, "- id: custom-row\n  disabled: true\n");
    await writeAgentPluginSettings(root, { browser: true, windowsGui: false });
    await writeManagedMcpPatch(profile, root, "node-test");
    const first = await readFile(patch, "utf8");
    await writeManagedMcpPatch(profile, root, "node-test");
    assert.equal(await readFile(patch, "utf8"), first);
    const rows = YAML.parse(first);
    assert.equal(rows[0].id, "custom-row");
    assert.equal(rows[1].insert.length, 1);
    assert.equal(rows[1].insert[0].config.serverName, "browser");
    assert.equal(rows[1].insert[0].config.command, "node-test");
    await writeAgentPluginSettings(root, { browser: false, windowsGui: false });
    await writeManagedMcpPatch(profile, root, "node-test");
    assert.deepEqual(YAML.parse(await readFile(patch, "utf8")), [
      { id: "custom-row", disabled: true },
    ]);
  });
});

test("missing desktop runtime does not advertise Windows control", async () => {
  await fixture(async (root) => {
    await writeAgentPluginSettings(root, { browser: false, windowsGui: false });
    assert.equal((await getAgentPluginStatus(root)).windowsGui.available, false);
  });
});

test("backend persists enabled state and rolls it back if DSH restart fails", async () => {
  await fixture(async (root) => {
    const backend = new DshBackend({ dataDir: root });
    let restarts = 0;
    backend.restart = async () => {
      restarts += 1;
      return { state: "ready", generation: restarts };
    };
    const enabled = await backend.setAgentPluginEnabled("browser", true);
    assert.equal(enabled.browser.enabled, true);
    assert.equal(restarts, 1);
    backend.restart = async () => {
      restarts += 1;
      throw new Error("restart failed");
    };
    await assert.rejects(backend.setAgentPluginEnabled("browser", false), /restart failed/);
    assert.equal((await backend.getAgentPlugins()).browser.enabled, true);
    assert.equal(restarts, 3, "one failed restart plus best-effort recovery");
  });
});
