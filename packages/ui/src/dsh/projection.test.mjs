import test from "node:test";
import assert from "node:assert/strict";
import { emptyProjection, projectFrame } from "./projection.ts";

const event = (seq, type, data) => ({ type: "event", event: { seq, type, data } });
test("streamed text is visible before commit and replaced without duplication", () => {
  let state = emptyProjection();
  for (const text of ["hello ", "world"])
    state = projectFrame(state, {
      type: "assistant-stream",
      frame: { type: "chunk", attemptId: "a", chunk: { type: "text-delta", text } },
    });
  assert.equal(state.rows[0].text, "hello world");
  assert.equal(state.busy, true);
  state = projectFrame(
    state,
    event(0, "assistant/message", {
      message: { content: [{ type: "text", text: "hello world" }] },
    }),
  );
  assert.equal(state.rows.length, 1);
  state = projectFrame(state, event(1, "turn/end", { reason: { kind: "completed" } }));
  assert.equal(state.busy, false);
});
test("history reconstructs tool output and ignores duplicate durable events", () => {
  const records = [
    event(0, "tool/call", { callId: "t", name: "pwsh", arguments: '{"command":"npm test"}' }),
    event(1, "tool/result", {
      message: {
        content: [
          { type: "tool-result", toolCallId: "t", content: [{ type: "text", text: "exit 0" }] },
        ],
      },
    }),
  ];
  const state = projectFrame(emptyProjection(), { type: "snapshot", records });
  assert.equal(state.rows[0].state, "output-available");
  assert.equal(state.rows[0].text, "exit 0");
  assert.deepEqual(projectFrame(state, records[0]), state);
});
test("model errors settle the busy state with a readable message", () => {
  const state = projectFrame(
    { ...emptyProjection(), busy: true },
    event(0, "turn/end", {
      reason: { kind: "error", error: { message: "Invalid API key" } },
    }),
  );
  assert.equal(state.busy, false);
  assert.equal(state.error, "Invalid API key");
});

test("reopening an active session preserves the compact streamed prefix", () => {
  const state = projectFrame(emptyProjection(), {
    type: "snapshot",
    records: [],
    assistantStream: {
      activeAttempt: {
        attemptId: "a",
        stream: [
          { type: "reasoning-chunks", texts: ["Check ", "files"] },
          { type: "text-chunks", texts: ["Hello ", "again"] },
        ],
      },
    },
  });
  assert.equal(state.rows[0].text, "Hello again");
  assert.equal(state.rows[0].thinking, "Check files");
  assert.equal(state.busy, true);
});

for (const kind of ["plugin", "skill-catalog"])
  test(`${kind} context is not presented as a human message`, () => {
    const state = projectFrame(
      emptyProjection(),
      event(0, "user/message", {
        source: { kind, plugin: "skills", form: "catalog" },
        content: [{ type: "text", text: "Internal skill catalog" }],
      }),
    );
    assert.equal(state.rows.length, 0);
    assert.equal(state.cursor, 0);
  });

test("conversation annotation context stays available to DSH but hidden in the user bubble", () => {
  const text = "按照批注修改\n\n# DCode conversation annotations\nThe Agent can read this block.";
  const state = projectFrame(
    emptyProjection(),
    event(1, "user/message", {
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  assert.equal(state.rows[0].text, "按照批注修改");
  assert.equal(state.rows[0].id, "event:1");
});
