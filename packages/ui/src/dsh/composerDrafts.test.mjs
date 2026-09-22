import test from "node:test";
import assert from "node:assert/strict";
import { clearDraftIfUnchanged, draftScopeKey, promoteDraftToSession } from "./composerDrafts.ts";

test("draft scope separates workspaces, sessions and the new-conversation draft", () => {
  const a = draftScopeKey("E:/one", "session-a");
  const b = draftScopeKey("E:/one", "session-b");
  const fresh = draftScopeKey("E:/one", null);
  const otherProject = draftScopeKey("E:/two", "session-a");
  assert.equal(new Set([a, b, fresh, otherProject]).size, 4);
});

test("first send promotes the draft, failure retains it and acceptance clears only exact text", () => {
  const fresh = draftScopeKey("E:/one", null);
  const created = draftScopeKey("E:/one", "session-new");
  const other = draftScopeKey("E:/one", "session-b");
  const promoted = promoteDraftToSession({ [fresh]: "original", [other]: "other" }, fresh, created);
  assert.equal(promoted[created], "original");
  assert.equal(promoted[fresh], undefined);
  assert.equal(clearDraftIfUnchanged(promoted, created, "changed")[created], "original");
  assert.equal(clearDraftIfUnchanged(promoted, created, "original")[created], undefined);
  assert.equal(clearDraftIfUnchanged(promoted, created, "original")[other], "other");
});
