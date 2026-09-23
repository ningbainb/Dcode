import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "dcode-mcp-fixture", version: "1.0.0" });
server.registerTool(
  "echo",
  {
    description: "Echo a synthetic Dcode MCP fixture value",
    inputSchema: { message: z.string() },
  },
  async ({ message }) => ({
    content: [
      { type: "text", text: `MCP_ECHO_OK:${message}:${process.env.MCP_CHILD_TOKEN ?? "missing"}` },
    ],
  }),
);
await server.connect(new StdioServerTransport());
