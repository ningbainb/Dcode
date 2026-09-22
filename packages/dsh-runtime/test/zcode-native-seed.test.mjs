import test from "node:test";
import assert from "node:assert/strict";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { buildZcodeNativeSeed } from "../src/zcode-native-seed.mjs";

function archive(rows) {
  return {
    id: "zcode-import:s1",
    title: "Imported task",
    sourceRows: {
      messages: rows.map((row, index) => ({
        id: `m${index}`,
        createdAt: index + 1,
        data: JSON.stringify(row.message),
      })),
      parts: rows.flatMap((row, index) =>
        row.parts.map((part, partIndex) => ({
          id: `p${index}-${partIndex}`,
          messageId: `m${index}`,
          data: JSON.stringify(part),
        })),
      ),
    },
  };
}

test("ZCode text, compaction and completed tools become valid native DSH history", () => {
  const source = archive([
    { message: { role: "user" }, parts: [{ type: "text", text: "Inspect project" }] },
    {
      message: { role: "assistant", modelID: "glm-test" },
      parts: [
        { type: "text", text: "Reading files" },
        {
          type: "tool",
          tool: "read",
          callID: "call-1",
          state: { status: "completed", input: { path: "a.txt" }, output: "file contents" },
        },
        { type: "text", text: "The file contains a plan." },
      ],
    },
    {
      message: { role: "assistant", summary: { body: "Plan: edit a.txt next." } },
      parts: [{ type: "compaction", compactBoundary: { summarizedMessageCount: 2 } }],
    },
  ]);
  const result = buildZcodeNativeSeed(source);
  assert.equal(result.omittedMessages, 0);
  assert.equal(result.degradedAttachments, 0);
  const session = Session.create(SessionId("import-zcode-test"), result.events);
  const history = session.deriveMessages();
  assert.deepEqual(
    history.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.ok(
    history[1].content.some((block) => block.type === "tool-call" && block.id === "call-1"),
  );
  assert.ok(
    history[2].content.some(
      (block) => block.type === "tool-result" && block.toolCallId === "call-1",
    ),
  );
  assert.ok(JSON.stringify(history).includes("Plan: edit a.txt next."));
  assert.equal(result.events.at(-1).type, "turn/end");
});

test("incomplete tools get an interrupted result and attachments are disclosed", () => {
  const source = archive([
    {
      message: { role: "user" },
      parts: [
        { type: "text", text: "Review this" },
        { type: "file", name: "image.png" },
      ],
    },
    {
      message: { role: "assistant" },
      parts: [
        {
          type: "tool",
          tool: "Bash",
          callID: "lost",
          state: { status: "running", input: { command: "pwd" } },
        },
      ],
    },
  ]);
  const result = buildZcodeNativeSeed(source);
  assert.equal(result.degradedAttachments, 1);
  const history = Session.create(
    SessionId("import-zcode-interrupted"),
    result.events,
  ).deriveMessages();
  assert.ok(JSON.stringify(history).includes("attachment"));
  assert.ok(history.at(-1).content.some((block) => block.type === "tool-result" && block.isError));
});

test("bounded seed keeps an opening anchor, summary and recent turn", () => {
  const rows = [
    { message: { role: "user" }, parts: [{ type: "text", text: "ORIGINAL OBJECTIVE" }] },
    ...Array.from({ length: 12 }, (_, index) => ({
      message: { role: index % 2 ? "assistant" : "user" },
      parts: [{ type: "text", text: `filler-${index} ` + "x".repeat(150) }],
    })),
    {
      message: { role: "assistant", summary: { body: "COMPACTED DECISION" } },
      parts: [{ type: "compaction" }],
    },
    { message: { role: "user" }, parts: [{ type: "text", text: "LATEST REQUEST" }] },
  ];
  const result = buildZcodeNativeSeed(archive(rows), { maxChars: 700 });
  const content = JSON.stringify(
    Session.create(SessionId("import-zcode-bounded"), result.events).deriveMessages(),
  );
  assert.ok(result.omittedMessages > 0);
  assert.match(content, /ORIGINAL OBJECTIVE/);
  assert.match(content, /COMPACTED DECISION/);
  assert.match(content, /LATEST REQUEST/);
});
