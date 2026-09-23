import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";
import dshManifest from "@deepseek-ai/dsh/package.json" with { type: "json" };
const root = process.env.DCODE_TEST_ROOT
  ? resolve(process.env.DCODE_TEST_ROOT)
  : resolve(import.meta.dirname, "../../../../../.data/agent-e2e");
const { workspace, server, requests, commands } = await createFixture(root);
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
  const models = await backend.listModels();
  const model = models.find((item) => item.provider === "dcode-settings-fixture");
  assert.ok(model, "fixture is returned by real DSH model catalog");
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  await backend.sendMessage(
    session.id,
    "Read input.txt, write and edit output.txt, then execute the verification command.",
    model,
  );
  const deadline = Date.now() + 120000;
  while (!events.some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > deadline) throw new Error("Agent did not finish within 120 seconds");
    await delay(100);
  }
  const terminal = events.find((event) => event.data?.event?.type === "turn/end").data.event;
  assert.equal(terminal.data.reason.kind, "completed", JSON.stringify(terminal));
  assert.equal((await readFile(join(workspace, "output.txt"), "utf8")).trim(), "edited version");
  assert.equal(
    events.filter((event) => event.data?.event?.type === "tool/call").length,
    commands.length,
  );
  const toolResults = events
    .filter((event) => event.data?.event?.type === "tool/result")
    .map((event) => event.data.event.data.message);
  assert.equal(toolResults.length, commands.length);
  assert.ok(
    toolResults.every((message) => !message.isError),
    "all coding tools must succeed",
  );
  assert.ok(
    JSON.stringify(toolResults).includes("DCode input"),
    "read/search must return project content",
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "assistant-stream" && event.data.frame?.chunk?.type === "text-delta",
    ),
  );
  assert.ok(JSON.stringify(events).includes("DCODE_SHELL_OK"));
  const beforeCancel = events.length;
  await backend.sendMessage(session.id, "DCODE_CANCEL_TEST: stream until stopped.", model);
  const cancelDeadline = Date.now() + 30000;
  while (
    !events
      .slice(beforeCancel)
      .some(
        (event) =>
          event.type === "assistant-stream" && event.data.frame?.chunk?.type === "text-delta",
      )
  ) {
    if (Date.now() > cancelDeadline) throw new Error("Cancellation test did not begin streaming");
    await delay(100);
  }
  await backend.cancel(session.id);
  while (!events.slice(beforeCancel).some((event) => event.data?.event?.type === "turn/end")) {
    if (Date.now() > cancelDeadline) throw new Error("Cancellation did not settle");
    await delay(100);
  }
  const cancelled = events
    .slice(beforeCancel)
    .find((event) => event.data?.event?.type === "turn/end");
  assert.notEqual(cancelled.data.event.data.reason.kind, "completed");
  // Terminate only the runtime process owned by this test's controller.
  const controller = backend.lifecycle.controller;
  const ownedChild = controller.child;
  const runtimePid = controller.runtimeProcessPids.get(ownedChild) || ownedChild.pid;
  assert.ok(Number.isInteger(runtimePid) && runtimePid > 0);
  process.kill(runtimePid, "SIGKILL");
  const crashDeadline = Date.now() + 30000;
  while ((await backend.health()).state === "ready") {
    if (Date.now() > crashDeadline) throw new Error("Unexpected runtime exit was not detected");
    await delay(100);
  }
  await backend.restart();
  const restored = await backend.resumeSession(session.id);
  assert.ok(JSON.stringify(restored).includes("DCode streaming complete."));
  assert.ok((await backend.listSessions(workspace)).some((item) => item.id === session.id));
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        passed: true,
        model: "local deterministic fixture",
        runtime: `official DSH ${dshManifest.version}`,
        tools: commands.map(([name]) => name),
        streaming: true,
        restartHistory: true,
        crashRecovery: true,
        cancellation: true,
        providerSettings: true,
        requests: requests.length,
        sessionId: session.id,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real DSH read/write/edit/pwsh, incremental stream, session restart/history (fixture model).",
  );
} catch (error) {
  await writeFile(join(root, "failure-events.json"), JSON.stringify(events, null, 2));
  throw error;
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
