import assert from "node:assert/strict";
import test from "node:test";
import { needsWindowsAclRepair } from "./windowsAclRepair.ts";

const failure = (text) => [{ id: "tool:1", kind: "tool", state: "output-error", text }];

test("offers repair only for the selected project ACL failure", () => {
  const rows = failure(
    "Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(E:\\code\\project)",
  );
  assert.equal(needsWindowsAclRepair(rows, "e:/code/project"), true);
  assert.equal(needsWindowsAclRepair(rows, "E:\\code\\other"), false);
  assert.equal(needsWindowsAclRepair(failure("Error: access denied"), "E:\\code\\project"), false);
  assert.equal(
    needsWindowsAclRepair([{ ...rows[0], state: "output-available" }], "E:\\code\\project"),
    false,
  );
});
