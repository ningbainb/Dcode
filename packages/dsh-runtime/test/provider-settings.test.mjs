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

test("DSH provider draft preserves supported model capabilities", () => {
  const result = validateProviderDraft({
    ...draft,
    models: [
      {
        ...draft.models[0],
        input: ["text", "image"],
        reasoningEfforts: { off: null, low: "low", high: "high" },
      },
      { ...draft.models[1], reasoningEfforts: false },
    ],
  });
  assert.deepEqual(result.models[0].input, ["text", "image"]);
  assert.deepEqual(result.models[0].reasoningEfforts, { off: null, low: "low", high: "high" });
  assert.equal(result.models[1].reasoningEfforts, false);
});

test("DSH provider draft rejects unsupported capability claims", () => {
  for (const patch of [
    { input: ["image"] },
    { input: ["text", "video"] },
    { reasoningEfforts: { off: null } },
    { reasoningEfforts: { medium: "" } },
    { reasoningEfforts: { extreme: "extreme" } },
  ]) {
    assert.throws(
      () =>
        validateProviderDraft({
          ...draft,
          models: [{ ...draft.models[0], ...patch }],
        }),
      /modalities|reasoning/,
    );
  }
});
