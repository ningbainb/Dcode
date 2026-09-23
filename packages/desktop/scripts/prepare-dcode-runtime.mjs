import { spawn } from "node:child_process";
import { copyFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const desktop = resolve(import.meta.dirname, "..");
const root = resolve(desktop, "../..");
const target = resolve(desktop, "dcode-runtime-v3");
const readyMarker = resolve(target, ".dcode-deploy-ready");
if (!existsSync(readyMarker)) {
  await new Promise((resolveRun, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(
      command,
      [
        "--config.inject-workspace-packages=true",
        "--filter",
        "@dcode/dsh-runtime",
        "deploy",
        "--prod",
        "packages/desktop/dcode-runtime-v3",
      ],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
        windowsHide: true,
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`Runtime deploy exited ${code}`)),
    );
  });
  await writeFile(readyMarker, "agent-plugins-skills-runtime-v3\n");
}
for (const directory of ["src", "vendor"]) {
  await cp(resolve(root, "packages/dsh-runtime", directory), resolve(target, directory), {
    recursive: true,
  });
}
// Keep a physical Node runtime outside app.asar: DSH's profile resolver and native
// modules operate on real directories and must not depend on the user's Node install.
const executable = process.env.DCODE_NODE_PATH || process.execPath;
await copyFile(executable, resolve(target, process.platform === "win32" ? "node.exe" : "node"));
const license = await fetch("https://raw.githubusercontent.com/nodejs/node/v24.14.0/LICENSE");
if (!license.ok) throw new Error(`Node license download failed: ${license.status}`);
await writeFile(resolve(target, "NODE-LICENSE"), await license.text());
console.log(`DCode runtime prepared: ${target}`);
