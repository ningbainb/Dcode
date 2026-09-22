import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { writeAgentPluginSettings, windowsGuiExecutable } from "../src/agent-plugins.mjs";
import { createFixture } from "./fixture.mjs";

if (!process.env.DCODE_TEST_ROOT) {
  throw new Error("Set DCODE_TEST_ROOT to a Dcode data directory with Windows GUI MCP installed.");
}
const root = resolve(process.env.DCODE_TEST_ROOT);
await mkdir(root, { recursive: true });
assert.ok(existsSync(windowsGuiExecutable(root)), "Windows GUI MCP must already be installed");
const { workspace, server, requests, commands } = await createFixture(root);
commands.splice(0, commands.length, ["mcp__windows_gui__list_windows", { visible_only: true }]);
await writeAgentPluginSettings(root, { browser: false, windowsGui: true });
const backend = new DshBackend({ dataDir: root });
const events = [];
backend.on("event", (event) => {
  events.push(event);
  if (event.type === "approval")
    void backend.respondApproval(event.sessionId, event.data.requestId, true);
});
try {
  await backend.start();
  await backend.configureProvider({
    provider: "dcode-settings-fixture",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    model: "dcode-fixture",
    apiKey: "synthetic-local-test-key",
  });
  const model = (await backend.listModels()).find(
    (item) => item.provider === "dcode-settings-fixture",
  );
  assert.ok(model);
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  await backend.sendMessage(session.id, "List visible desktop windows.", model);
  const deadline = Date.now() + 120000;
  while (!events.some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > deadline)
      throw new Error("Windows GUI MCP turn did not finish within 120 seconds");
    await delay(100);
  }
  const result = events
    .filter((event) => event.data?.event?.type === "tool/result")
    .flatMap((event) => event.data.event.data.message.content)
    .find((block) => block.type === "tool-result");
  assert.ok(
    requests.some((request) =>
      request.tools?.some((tool) => tool.function?.name === "mcp__windows_gui__list_windows"),
    ),
    "DSH must advertise the installed Windows GUI MCP tool",
  );
  assert.ok(result && !result.isError, JSON.stringify(result));
  assert.match(JSON.stringify(result), /windows/);
  await writeFile(
    join(root, "windows-gui-mcp-result.json"),
    JSON.stringify({ passed: true, tool: "mcp__windows_gui__list_windows" }, null, 2),
  );
  console.log("PASS: DSH discovered and called Windows GUI MCP to list windows.");
} catch (error) {
  await writeFile(
    join(root, "windows-gui-mcp-failure-events.json"),
    JSON.stringify(events, null, 2),
  );
  throw error;
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
