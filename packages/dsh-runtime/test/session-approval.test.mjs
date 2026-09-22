import test from "node:test";
import assert from "node:assert/strict";
import { DshBackend } from "../src/index.mjs";

test("resuming a session restores only its own pending approval", async () => {
  const backend = new DshBackend({ dataDir: "test-only" });
  backend.start = async () => ({ state: "ready", generation: 1 });
  backend.transport.open = async (_method, { request }, onFrame) => {
    onFrame({ type: "snapshot", records: [], sessionId: request.address.sessionId });
    return () => {};
  };
  backend.pendingApprovals.set("approval-a", {
    agentId: "session-a",
    request: { reason: "Edit a file" },
  });

  const a = await backend.resumeSession("session-a");
  const b = await backend.resumeSession("session-b");
  assert.deepEqual(a.pendingApproval, { reason: "Edit a file", requestId: "approval-a" });
  assert.equal(b.pendingApproval, undefined);
});
