import { randomUUID, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";

export const name = "dcode-zcode-session-import";
export const inject = ["agents", "agentPresets", "sessions", "webServer", "workspaceRegistry"];

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

function authorized(req) {
  const expected = process.env.DCODE_ZCODE_IMPORT_TOKEN;
  const received = req.headers["x-dcode-import-token"];
  if (typeof expected !== "string" || !expected || typeof received !== "string") return false;
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new RangeError("Imported session is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function createImportedSession(ctx, input) {
  if (
    !input ||
    typeof input.cwd !== "string" ||
    !Array.isArray(input.events) ||
    input.events.length === 0 ||
    input.events.length > 10000
  )
    throw new TypeError("Invalid ZCode import seed.");
  const cwd = await realpath(input.cwd);
  if (!(await stat(cwd)).isDirectory()) throw new Error("The original workspace is unavailable.");
  const sessionId = `dcode-zcode-${randomUUID()}`;
  // DSH validates the complete balanced seed and owns its durable session log.
  // No prompt is sent here: imported tool calls are historical, never rerun.
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd },
    seed: input.events,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx);
    },
  });
  try {
    const session = ctx.sessions.get(sessionId);
    if (!session) throw new Error("DSH did not publish the imported session.");
    await ctx.sessions.flush(session);
    const workspace = await ctx.workspaceRegistry.create(cwd);
    await workspace.attachSession(sessionId);
  } catch (error) {
    await handle.dispose();
    throw error;
  }
  return { sessionId, cwd };
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/api/dcode/zcode-session-import",
        handler: async (req, res) => {
          if (req.method !== "POST") {
            res.writeHead(405, { allow: "POST" });
            res.end();
            return;
          }
          if (!authorized(req)) {
            res.writeHead(403);
            res.end();
            return;
          }
          try {
            const imported = await createImportedSession(ctx, await readRequest(req));
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...imported }));
          } catch (error) {
            res.writeHead(error instanceof RangeError ? 413 : 400, {
              "content-type": "application/json",
            });
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        },
      }),
    "webserver /api/dcode/zcode-session-import",
  );
}
