import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { writeAgentPluginSettings } from "../src/agent-plugins.mjs";
import { createFixture } from "./fixture.mjs";

const root = process.env.DCODE_TEST_ROOT
  ? resolve(process.env.DCODE_TEST_ROOT)
  : resolve(import.meta.dirname, "../../../../../.data/browser-mcp-e2e");
await mkdir(root, { recursive: true });
const page = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    "<!doctype html><title>Dcode browser integration</title><h1>Dcode browser integration</h1>",
  );
});
await new Promise((done) => page.listen(0, "127.0.0.1", done));
const { workspace, server, requests, commands } = await createFixture(root);
commands.splice(0, commands.length, [
  "mcp__browser__browser_navigate",
  {
    url: `http://127.0.0.1:${page.address().port}/`,
  },
]);
await writeAgentPluginSettings(root, { browser: true, windowsGui: false });
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
  await backend.sendMessage(
    session.id,
    "Navigate to the local Dcode browser integration test page.",
    model,
  );
  const deadline = Date.now() + 120000;
  while (!events.some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > deadline)
      throw new Error("Browser MCP turn did not finish within 120 seconds");
    await delay(100);
  }
  const result = events
    .filter((event) => event.data?.event?.type === "tool/result")
    .flatMap((event) => event.data.event.data.message.content)
    .find((block) => block.type === "tool-result");
  assert.ok(
    requests.some((request) =>
      request.tools?.some((tool) => tool.function?.name === "mcp__browser__browser_navigate"),
    ),
    "DSH must advertise the real Playwright MCP tool",
  );
  assert.ok(result && !result.isError, JSON.stringify(result));
  assert.match(JSON.stringify(result), /Dcode browser integration/);
  await writeFile(
    join(root, "browser-mcp-result.json"),
    JSON.stringify(
      {
        passed: true,
        tool: "mcp__browser__browser_navigate",
        runtime: "DSH 0.1.6-alpha.2",
        browser: "Microsoft Edge",
      },
      null,
      2,
    ),
  );
  console.log("PASS: DSH discovered and called Playwright MCP against a local page.");
} catch (error) {
  await writeFile(join(root, "browser-mcp-failure-events.json"), JSON.stringify(events, null, 2));
  throw error;
} finally {
  await backend.stop();
  server.closeAllConnections();
  page.closeAllConnections();
  await Promise.all([
    new Promise((done) => server.close(done)),
    new Promise((done) => page.close(done)),
  ]);
}
