import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import test from "node:test";
import { DshBackend } from "../src/index.mjs";
import {
  SessionAnnotationStore,
  buildPromptWithSessionAnnotations,
} from "../src/session-annotations.mjs";

const root = resolve(import.meta.dirname, "../../../../../.data/session-annotation-tests");
await mkdir(root, { recursive: true });
const input = (messageId = "event:1") => ({
  messageId,
  role: "assistant",
  sourceText: "An original answer with a selected phrase.",
  selectedText: "selected phrase",
  startOffset: 26,
  comment: "Use the existing implementation.",
});

test("annotations persist, number monotonically and stay within their session", async () => {
  const dir = await mkdtemp(join(root, "store-"));
  try {
    const store = new SessionAnnotationStore(dir);
    const first = await store.create("session-A", input());
    const second = await store.create("session-A", { ...input(), comment: "A second note." });
    assert.equal(first.number, 1);
    assert.equal(second.number, 2);
    assert.equal(first.status, "pending");
    assert.equal((await new SessionAnnotationStore(dir).list("session-A")).length, 2);
    assert.deepEqual(await store.list("session-B"), []);
    await store.remove("session-A", first.id);
    assert.equal((await store.create("session-A", input("event:3"))).number, 3);
    await store.removeMessage("session-A", "event:1");
    assert.deepEqual(
      (await store.list("session-A")).map((item) => item.messageId),
      ["event:3"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editing and resolving updates the same annotation without losing its anchor", async () => {
  const dir = await mkdtemp(join(root, "edit-"));
  try {
    const store = new SessionAnnotationStore(dir);
    const item = await store.create("session", input());
    const edited = await store.update("session", item.id, {
      comment: "Reuse current APIs.",
      status: "resolved",
    });
    assert.equal(edited.id, item.id);
    assert.equal(edited.selectedText, item.selectedText);
    assert.equal(edited.comment, "Reuse current APIs.");
    assert.equal(edited.status, "resolved");
    assert.deepEqual(await store.selectForPrompt("session"), []);
    await assert.rejects(
      store.create("session", { ...input(), sourceText: "Changed" }),
      /message changed/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prompt receives quote and comment; rejected prompt keeps annotations pending", async () => {
  const dir = await mkdtemp(join(root, "prompt-"));
  try {
    const backend = new DshBackend({ dataDir: dir });
    const item = await backend.createSessionAnnotation("session", input());
    backend.start = async () => ({});
    backend.followers.set("session", () => {});
    let sentText = "";
    backend.transport.call = async (_endpoint, payload) => {
      sentText = payload.request.content[0].text;
      if (sentText.includes("fail admission")) throw new Error("rejected");
      return {};
    };
    await assert.rejects(backend.sendMessage("session", "fail admission"), /rejected/);
    assert.equal((await backend.listSessionAnnotations("session"))[0].status, "pending");
    await backend.sendMessage("session", "按照我的批注修改");
    assert.match(sentText, /Original message:[\s\S]*selected phrase/);
    assert.match(sentText, /Use the existing implementation/);
    assert.match(sentText, /按照我的批注修改/);
    assert.equal((await backend.listSessionAnnotations("session"))[0].status, "sent");
    assert.equal(buildPromptWithSessionAnnotations("Next", []), "Next");
    await backend.sendMessage("session", "Only this one", undefined, [item.id]);
    assert.match(sentText, /Annotation 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
