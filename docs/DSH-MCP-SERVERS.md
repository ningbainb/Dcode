# Dcode MCP servers on DSH

## Product behavior

The local Dcode Desktop settings sidebar exposes MCP servers again, but the page
configures the DSH Agent. It does not open or write ZCode Agent's legacy MCP
store. Users can add, edit, enable, disable and remove a local stdio or
Streamable HTTP server. Built-in browser and Windows GUI entries remain managed
by the separate Plugins page. Remote and Web workspaces retain their existing
ZCode settings behavior.

Stdio configuration includes a stable server name, executable, arguments,
working directory and environment-variable references. HTTP configuration
includes a URL and an optional Bearer-token environment-variable reference.
The credential fields store only environment-variable names: each mapping names
an existing variable in the Dcode process environment. Literal command arguments
and URLs are persisted, so the UI warns against putting secrets there. HTTP
URLs with embedded credentials or query strings are rejected. The profile patch uses
DSH's `!!js process.env.NAME` syntax, so values resolve only at runtime. The
variable must be present when Dcode launches; changing system variables later
requires restarting the app. The config follows the
[official DSH MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md).
The UI warns that a missing variable or unreachable server may leave the plugin
configured but without discovered tools; runtime logs remain authoritative.

## Ownership and event order

`DshBackend` owns the versioned Dcode MCP server file in its data directory.
`IDshService` exposes typed list and mutation commands; the renderer owns
only an unsaved form. Mutations compare the current revision, validate names,
transport and limits, atomically write the new file, and restart DSH. A failed
restart rolls the file back and attempts one recovery restart. The existing
`writeManagedMcpPatch` combines built-in and user-managed rows in Dcode's marked
profile block, preserving patch content outside that block. IDs and server names
are unique; `browser` and `windows_gui` are reserved for built-in tools. One
mutation at a time is admitted per backend process.

```text
Settings form -> IDshService -> DshBackend revision check -> Dcode MCP file
                                                       -> DSH profile patch
                                                       -> runtime restart
                                                       -> tool discovery
```

Changing MCP configuration can interrupt an active turn. DSH owns actual tool
connection, permissions, execution and session history. Existing sessions use
the new tool set after restart; no second MCP registry or accepted queue is
created in the UI. A saved entry is not reported as connected solely because
its configuration was accepted.

## Acceptance

- The local Desktop MCP page lists only DSH-managed entries and keeps the
  ZCode Agent MCP store unchanged.
- Add both stdio and HTTP entries, edit, disable and remove them; a stale
  revision cannot overwrite another edit.
- Built-in browser and GUI rows coexist with custom rows without duplicate
  server names. Unmanaged profile patch rows remain unchanged.
- Environment values do not appear in the saved JSON, renderer view or profile
  patch. Missing variable names and malformed URLs are rejected.
- A local fixture MCP server is discoverable by a real DSH session, and its
  tool call completes. Desktop UI smoke covers the settings flow.
