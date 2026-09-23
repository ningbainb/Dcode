import test from "node:test";
import assert from "node:assert/strict";
import { resolveZcodeCommandPrompt } from "./zcodeCommandPrompt.ts";

const command = (overrides = {}) => ({
  name: "/review",
  prompt: "Review $1 and $ARGUMENTS",
  enabled: true,
  source: "user",
  scope: "project",
  ...overrides,
});

test("expands a selected ZCode command and preserves quoted positional arguments", () => {
  const result = resolveZcodeCommandPrompt('/review "src/my file.ts" carefully', [command()]);
  assert.match(result, /Run custom command \/review/);
  assert.match(result, /Command source: project\/user/);
  assert.match(result, /Review src\/my file\.ts and "src\/my file\.ts" carefully/);
});

test("appends unused arguments while keeping an unrelated slash message literal", () => {
  assert.match(
    resolveZcodeCommandPrompt("/review module", [command({ prompt: "Audit the change" })]),
    /Audit the change\n\nUser arguments:\nmodule/,
  );
  assert.equal(resolveZcodeCommandPrompt("/unknown module", [command()]), "/unknown module");
  assert.equal(resolveZcodeCommandPrompt("/review-more", [command()]), "/review-more");
});

test("disabled commands and disabled plugins never become model prompts", () => {
  assert.throws(
    () => resolveZcodeCommandPrompt("/review", [command({ enabled: false })]),
    /disabled/i,
  );
  assert.throws(
    () =>
      resolveZcodeCommandPrompt("/review", [command({ source: "plugin", pluginEnabled: false })]),
    /disabled/i,
  );
});

test("rejects dynamic shell expansion and empty templates", () => {
  assert.throws(
    () => resolveZcodeCommandPrompt("/review", [command({ prompt: "!`pwd`" })]),
    /shell/i,
  );
  assert.throws(() => resolveZcodeCommandPrompt("/review", [command({ prompt: "  " })]), /empty/i);
});
