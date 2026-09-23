import assert from "node:assert/strict";
import test from "node:test";
import { resolveDcodeRuntimeDeploy } from "./runtime-deploy-path.mjs";

test("physical DSH runtime deployments are isolated by operating system and CPU", () => {
  const targets = ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64"];
  const deployments = targets.map((key) => {
    const [platform, arch] = key.split("-");
    return resolveDcodeRuntimeDeploy({ platform, arch });
  });
  assert.equal(new Set(deployments.map((item) => item.target)).size, targets.length);
  for (const [index, deployment] of deployments.entries()) {
    assert.match(deployment.directoryName, new RegExp(targets[index]));
    assert.ok(deployment.deployRelativePath.endsWith(deployment.directoryName));
  }
  assert.equal(resolveDcodeRuntimeDeploy().directoryName,
    resolveDcodeRuntimeDeploy({ platform: process.platform, arch: process.arch }).directoryName);
  assert.throws(() => resolveDcodeRuntimeDeploy({ platform: "freebsd", arch: "x64" }),
    /Unsupported Dcode runtime target/);
});
