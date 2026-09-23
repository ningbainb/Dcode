import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join, parse } from "node:path";
import { grantWindowsWorkspaceOwnerRight } from "../src/windows-workspace-acl.mjs";

const root = resolve(import.meta.dirname, "../../../.cache/windows-workspace-acl");

test("repair uses exact native arguments for only the selected directory", async () => {
  const directory = join(root, "unit-project");
  await mkdir(directory, { recursive: true });
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '"user","S-1-5-21-123-456-789-1001"\n' };
  };
  const result = await grantWindowsWorkspaceOwnerRight(directory, { platform: "win32", run });
  assert.equal(result, directory);
  assert.deepEqual(calls, [
    { command: "whoami.exe", args: ["/user", "/fo", "csv", "/nh"] },
    { command: "icacls.exe", args: [directory, "/grant", "*S-1-5-21-123-456-789-1001:(OI)(CI)(WO)"] },
  ]);
});

test("repair rejects drive roots and never invokes ACL tools", async () => {
  const calls = [];
  await assert.rejects(
    grantWindowsWorkspaceOwnerRight(parse(root).root, {
      platform: "win32",
      run: async (...args) => calls.push(args),
    }),
    /drive root/,
  );
  assert.equal(calls.length, 0);
});

test("actual Windows repair makes the official workspace-write sandbox runnable", { skip: process.platform !== "win32" }, async () => {
  const { AclSandbox, workspaceWriteSid } = await import("@deepseek-ai/dsh-sandbox-windows-acl");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "real-project-"));
  await grantWindowsWorkspaceOwnerRight(directory);
  const sandbox = new AclSandbox({
    writableDirs: [directory],
    tempDir: null,
    writeSid: workspaceWriteSid(directory),
    mode: "workspace-write",
  });
  try {
    await sandbox.init();
    const result = await sandbox.spawn({ command: "cmd.exe", args: ["/c", "echo", "DCODE_ACL_OK"], cwd: directory }).wait();
    assert.equal(result.exitCode, 0);
    assert.match(String(result.stdout), /DCODE_ACL_OK/);
  } finally {
    sandbox.dispose();
  }
});
