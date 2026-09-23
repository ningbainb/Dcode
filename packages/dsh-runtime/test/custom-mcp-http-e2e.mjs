import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = process.env.DCODE_TEST_ROOT
  ? resolve(process.env.DCODE_TEST_ROOT)
  : resolve(import.meta.dirname, "../../../.cache/custom-mcp-http-e2e");
await mkdir(root, { recursive: true });
const { workspace, server: modelServer, requests, commands } = await createFixture(root);
commands.splice(0, commands.length, ["mcp__local_http__echo", { message: "hello" }]);
process.env.DCODE_MCP_HTTP_TOKEN = "synthetic-http-mcp-token";
const app = createMcpExpressApp();
let authorizedCalls = 0;
app.post("/mcp", async (request, response) => {
  if (request.headers.authorization !== "Bearer synthetic-http-mcp-token") {
    response.status(401).end();
    return;
  }
  authorizedCalls++;
  const mcp = new McpServer({ name: "dcode-http-fixture", version: "1.0.0" });
  mcp.registerTool(
    "echo",
    { description: "Echo a Dcode HTTP MCP fixture value", inputSchema: { message: z.string() } },
    async ({ message }) => ({ content: [{ type: "text", text: `MCP_HTTP_OK:${message}` }] }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  await transport.handleRequest(request, response, request.body);
});
app.get("/mcp", (_request, response) => response.status(405).end());
const mcpServer = await new Promise((done) => {
  const listening = app.listen(0, "127.0.0.1", () => done(listening));
});
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
        serverName: "local_http",
        enabled: true,
        transport: "streamable-http",
        url: `http://127.0.0.1:${mcpServer.address().port}/mcp`,
        bearerTokenEnv: "DCODE_MCP_HTTP_TOKEN",
      },
    ],
    initial.revision,
  );
  await backend.configureProvider({
    provider: "dcode-mcp-http-fixture",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${modelServer.address().port}/v1`,
    model: "dcode-fixture",
    apiKey: "synthetic-local-test-key",
  });
  const model = (await backend.listModels()).find(
    (item) => item.provider === "dcode-mcp-http-fixture",
  );
  assert.ok(model);
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  await backend.sendMessage(session.id, "Call the local_http echo MCP tool with hello.", model);
  const deadline = Date.now() + 120000;
  while (!events.some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > deadline) throw new Error("HTTP MCP turn did not finish within 120 seconds");
    await delay(100);
  }
  assert.ok(authorizedCalls > 0, "DSH must send the environment-backed Bearer token");
  assert.ok(
    requests.some((request) =>
      request.tools?.some((tool) => tool.function?.name === "mcp__local_http__echo"),
    ),
    "DSH must advertise the HTTP MCP tool",
  );
  assert.match(
    JSON.stringify(events.filter((event) => event.data?.event?.type === "tool/result")),
    /MCP_HTTP_OK:hello/,
  );
  console.log("PASS: DSH discovered and called an authenticated custom HTTP MCP server.");
} finally {
  await backend.stop();
  modelServer.closeAllConnections();
  mcpServer.closeAllConnections();
  await Promise.all([
    new Promise((done) => modelServer.close(done)),
    new Promise((done) => mcpServer.close(done)),
  ]);
}
