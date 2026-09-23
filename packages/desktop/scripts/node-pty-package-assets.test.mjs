import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { shouldCopyNodePtyRuntimePath } from "./node-pty-package-assets.mjs";

test("hoisted node-pty copy keeps only the target prebuild and runtime files", () => {
  const root = join("E:", "workspace", "node_modules", "node-pty");
  const keep = [
    root,
    join(root, "lib", "index.js"),
    join(root, "prebuilds"),
    join(root, "prebuilds", "win32-x64", "pty.node"),
  ];
  const omit = [
    join(root, "build", "Release", "pty.node"),
    join(root, "bin", "win32-x64", "pty.node"),
    join(root, "prebuilds", "darwin-x64", "pty.node"),
    join(root, "prebuilds", "win32-arm64", "pty.node"),
  ];
  for (const path of keep) assert.equal(shouldCopyNodePtyRuntimePath(root, path, "win32-x64"), true);
  for (const path of omit) assert.equal(shouldCopyNodePtyRuntimePath(root, path, "win32-x64"), false);
});
