import { test } from "node:test";
import assert from "node:assert/strict";
import { isDcodeBlockedUpstreamUrl } from "../packages/shared/src/dcodeBrand.ts";
import { createQuickPickCommands } from "../packages/ui/src/quickpick/quickPickCommands.ts";
test("upstream product links blocked; GitHub backup and provider URLs remain usable", () => {
  for (const url of [
    "https://zcode.z.ai/docs",
    "https://ZCODE.Z.AI./feedback",
    "https://test.zcode.z.ai/login",
    "https://zcode.zhipuai.cn",
    "https://github.com/zai-org/ZCode/issues",
  ])
    assert.equal(isDcodeBlockedUpstreamUrl(url), true, url);
  for (const url of [
    "https://github.com/login/device",
    "https://github.com/me/backup",
    "https://api.deepseek.com",
    "https://example.com/project",
    "https://zcode.z.ai.example.com",
  ])
    assert.equal(isDcodeBlockedUpstreamUrl(url), false, url);
});
test("command palette removes upstream actions even when old capabilities are advertised", () => {
  const calls = [];
  const handlers = new Proxy({}, { get: (_, key) => () => calls.push(key) });
  for (const isLoggedIn of [true, false]) {
    const commands = createQuickPickCommands({
      allowOpenWorkspace: true,
      canOpenCommunity: true,
      isSidebarVisible: true,
      isLoggedIn,
      themeTarget: "dark",
      shortcuts: {},
      handlers,
    });
    assert.ok(commands.length > 5);
    for (const command of commands) {
      assert.doesNotMatch(command.id, /feedback|community|docs|login|logout/i);
      command.run();
    }
  }
  assert.ok(calls.includes("openWorkspace"));
  assert.ok(calls.includes("openSettings"));
  assert.ok(!calls.includes("openFeedback"));
});
