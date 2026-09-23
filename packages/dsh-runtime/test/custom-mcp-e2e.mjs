import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = process.env.DCODE_TEST_ROOT
  ? resolve(process.env.DCODE_TEST_ROOT)
  : resolve(import.meta.dirname, "../../../.cache/custom-mcp-e2e");
await mkdir(root, { recursive: true });
const { workspace, server, requests, commands } = await createFixture(root);
commands.splice(0, commands.length, ["mcp__local_tools__echo", { message: "hello" }]);
process.env.DCODE_MCP_TEST_TOKEN = "synthetic-local-mcp-token";
const backend = new DshBackend({ dataDir: root });
const events = [];
backend.on("event", (event) => {
  events.push(event);
  if (event.type === "approval")
    void backend.respondApproval(event.sessionId, event.data.requestId, true);
});
try {
  const initial = await backend.listMcpServers();
  await backend.updateMcpServers(
    [
      {
        serverName: "local_tools",
        enabled: true,
        transport: "stdio",
        command: process.execPath,
        args: [resolve(import.meta.dirname, "fixtures/mcp-echo.mjs")],
        cwd: "",
        envRefs: { MCP_CHILD_TOKEN: "DCODE_MCP_TEST_TOKEN" },
      },
    ],
    initial.revision,
  );
  await backend.configureProvider({
    provider: "dcode-mcp-fixture",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    model: "dcode-fixture",
    apiKey: "synthetic-local-test-key",
  });
  const model = (await backend.listModels()).find((item) => item.provider === "dcode-mcp-fixture");
  assert.ok(model);
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  await backend.sendMessage(session.id, "Call the local_tools echo MCP tool with hello.", model);
  const deadline = Date.now() + 120000;
  while (!events.some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > deadline) throw new Error("Custom MCP turn did not finish within 120 seconds");
    await delay(100);
  }
  assert.ok(
    requests.some((request) =>
      request.tools?.some((tool) => tool.function?.name === "mcp__local_tools__echo"),
    ),
    "DSH must advertise the custom MCP tool",
  );
  const results = events.filter((event) => event.data?.event?.type === "tool/result");
  assert.match(JSON.stringify(results), /MCP_ECHO_OK:hello:synthetic-local-mcp-token/);
  await writeFile(
    join(root, "custom-mcp-result.json"),
    JSON.stringify({ passed: true, tool: "mcp__local_tools__echo" }, null, 2),
  );
  console.log("PASS: DSH discovered and called a Dcode-managed custom MCP server.");
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
