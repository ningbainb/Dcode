import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProviderDraft } from "../src/provider-settings.mjs";

const draft = {
  id: "local-gateway",
  name: "Local Gateway",
  api: "openai-completions",
  baseURL: "http://127.0.0.1:4321/v1",
  apiKey: "",
  models: [
    { id: "first", name: "First", contextWindow: 32000, maxTokens: 4096 },
    { id: "second", name: "Second", contextWindow: 64000, maxTokens: 8192 },
  ],
};

test("DSH provider draft accepts editable multiple-model local gateways", () => {
  assert.equal(validateProviderDraft(draft).models.length, 2);
  assert.equal(validateProviderDraft(draft).baseURL, "http://127.0.0.1:4321/v1");
});

test("DSH provider draft rejects duplicate models and embedded credentials", () => {
  assert.throws(
    () => validateProviderDraft({ ...draft, models: [draft.models[0], draft.models[0]] }),
    /unique/,
  );
  assert.throws(
    () => validateProviderDraft({ ...draft, baseURL: "https://user:secret@example.com/v1" }),
    /endpoint/,
  );
});
