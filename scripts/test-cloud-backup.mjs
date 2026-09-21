import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const workspace = resolve(import.meta.dirname, "../../..");
const output = resolve(workspace, ".cache/cloud-backup-tests.mjs");
await mkdir(resolve(workspace, ".cache"), { recursive: true });
await build({
  entryPoints: ["packages/services/src/cloud-backup/cloudBackup.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  sourcemap: "inline",
});
const child = spawn(process.execPath, ["--test", output], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, DCODE_TEST_ROOT: resolve(workspace, ".data/cloud-backup-tests") },
});
child.on("exit", (code) => process.exit(code ?? 1));
