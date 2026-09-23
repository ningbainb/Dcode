import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = resolve(import.meta.dirname, "../../../../.data");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(join(root, "dcode-subagents-e2e-"));
const { workspace, server, requests, commands } = await createFixture(dataDir);
commands.splice(0, commands.length, [
  "subagent",
  {
    description: "Verify DSH delegation depth",
    prompt: "DCODE_SUBAGENT_CHILD",
    run_in_background: false,
  },
]);
const backend = new DshBackend({ dataDir, executable: process.execPath });
const events = [];
backend.on("event", (event) => events.push(event));
async function waitForTurn(sessionId) {
  const deadline = Date.now() + 120000;
  while (
    !events.some((event) => event.sessionId === sessionId && event.data?.event?.type === "turn/end")
  ) {
    if (Date.now() > deadline)
      throw new Error("DSH subagent turn did not finish within 120 seconds");
    await delay(100);
  }
}
try {
  const original = await backend.listSubagentSettings();
  assert.equal(original.maxDepth, 1);
  assert.equal(original.writable, true);
  const disabled = await backend.updateSubagentSettings(0, original.revision);
  assert.equal(disabled.maxDepth, 0);
  const model = (await backend.listModels()).find((item) => item.provider === "dcode-fixture");
  assert.ok(model);
  const blockedSession = await backend.createSession(workspace, model);
  await backend.resumeSession(blockedSession.id);
  await backend.sendMessage(blockedSession.id, "DELEGATE_PARENT", model);
  await waitForTurn(blockedSession.id);
  const blockedResults = events.filter(
    (event) => event.sessionId === blockedSession.id && event.data?.event?.type === "tool/result",
  );
  const denied = blockedResults.some(
    (event) =>
      event.data.event.data?.message?.isError === true &&
      event.data.event.data?.message?.content?.some(
        (part) => part.type === "text" && part.text.includes("maxDepth 0"),
      ),
  );
  if (!denied)
    await writeFile(
      join(dataDir, "subagent-diagnostics.json"),
      JSON.stringify(
        { blockedResults, eventTypes: events.map((event) => event.data?.event?.type), requests },
        null,
        2,
      ),
    );
  assert.ok(
    denied,
    `Expected a blocked subagent tool result; diagnostics: ${join(dataDir, "subagent-diagnostics.json")}`,
  );
  assert.equal(
    requests.some((request) =>
      JSON.stringify(request.messages).includes("DCODE_SUBAGENT_CHILD_OK"),
    ),
    false,
  );
  await assert.rejects(backend.updateSubagentSettings(2, original.revision), /changed/i);
  await backend.restart();
  const persisted = await backend.listSubagentSettings();
  assert.equal(persisted.maxDepth, 0);
  const enabled = await backend.updateSubagentSettings(1, persisted.revision);
  assert.equal(enabled.maxDepth, 1);
  const allowedSession = await backend.createSession(workspace, model);
  await backend.resumeSession(allowedSession.id);
  await backend.sendMessage(allowedSession.id, "DELEGATE_PARENT", model);
  await waitForTurn(allowedSession.id);
  assert.ok(
    requests.some((request) =>
      request.messages?.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("DCODE_SUBAGENT_CHILD"),
      ),
    ),
    "The child model must receive the delegated prompt after depth is restored to 1.",
  );
  console.log("PASS: DSH subagent depth saved, revision checked and restored after restart.");
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
