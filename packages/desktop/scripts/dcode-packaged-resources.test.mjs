import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { resolveDcodePackagedResources } from "./dcode-packaged-resources.mjs";

test("Dcode afterPack locates platform resource directories", () => {
  const appOutDir = resolve("tmp", "dcode-package");
  const packager = { appInfo: { productFilename: "Dcode" } };
  assert.equal(resolveDcodePackagedResources({ electronPlatformName: "win32", appOutDir }),
    resolve(appOutDir, "resources"));
  assert.equal(resolveDcodePackagedResources({ electronPlatformName: "linux", appOutDir }),
    resolve(appOutDir, "resources"));
  assert.equal(resolveDcodePackagedResources({ electronPlatformName: "darwin", appOutDir, packager }),
    resolve(appOutDir, "Dcode.app", "Contents", "Resources"));
  assert.throws(() => resolveDcodePackagedResources({ electronPlatformName: "darwin", appOutDir }),
    /package name/);
});
