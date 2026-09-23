import test from "node:test";
import assert from "node:assert/strict";
import { prepareZcodeMcpImport } from "./zcodeMcpImport.ts";

const source = (name, config, scope = "user") => ({
  source: "zcodeagentmcp",
  scope,
  name,
  config,
});

test("imports compatible user MCP entries disabled and preserves existing rows", () => {
  const existing = [
    {
      serverName: "existing",
      enabled: true,
      transport: "stdio",
      command: "ok",
      args: [],
      cwd: "",
      envRefs: {},
    },
  ];
  const result = prepareZcodeMcpImport(
    [
      source("tools", { type: "stdio", command: "node", args: ["server.js"] }),
      source("remote", { type: "streamableHttp", url: "https://example.com/mcp" }),
    ],
    existing,
  );
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.servers[0], existing[0]);
  assert.equal(result.servers[1].enabled, false);
  assert.deepEqual(result.servers[1].args, ["server.js"]);
  assert.equal(result.servers[2].transport, "streamable-http");
});

test("skips workspace, duplicate, credential-bearing and unsupported entries", () => {
  const result = prepareZcodeMcpImport(
    [
      source("local", { command: "node" }, "workspace"),
      source("browser", { command: "node" }),
      source("same", { command: "node" }),
      source("same", { command: "node" }),
      source("secret", { command: "node", env: { TOKEN: "literal-secret" } }),
      source("token_url", { type: "http", url: "https://example.com/mcp?token=secret" }),
      source("auth", {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "secret" },
      }),
      source("oauth", { type: "http", url: "https://example.com/mcp", oauth: {} }),
      source("legacy", { type: "sse", url: "https://example.com/sse" }),
      source("long_command", { command: "x".repeat(1025) }),
    ],
    [],
  );
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 9);
  assert.equal(result.servers[0].serverName, "same");
});
