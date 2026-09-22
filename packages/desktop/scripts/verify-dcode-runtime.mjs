import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyDcodeRuntime(runtimeRoot) {
  const executable = resolve(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
  const entry = pathToFileURL(resolve(runtimeRoot, "src/index.mjs")).href;
  const result = spawnSync(
    executable,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    await import(process.argv[1]);
    const require = createRequire(process.argv[1]);
    const root = fileURLToPath(new URL('../', process.argv[1]));
    for (const name of ['ws', 'yaml', '@deepseek-ai/dsh/lib/bin.js', '@deepseek-ai/dsh-base/package.json', '@deepseek-ai/dsh-web-app/package.json', '@deepseek-ai/dsh-mcp-client/package.json', '@playwright/mcp/package.json']) {
      assert.ok(require.resolve(name).startsWith(root), name + ' must resolve inside the packaged runtime');
    }
    for (const name of ['@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) await import(pathToFileURL(require.resolve(name)).href);
    const bridge = await import(new URL('../vendor/dcode-zcode-session-import/index.mjs', process.argv[1]).href);
    assert.equal(bridge.name, 'dcode-zcode-session-import');
    console.log('DCode physical runtime dependency verification passed');
  `,
      entry,
    ],
    { cwd: runtimeRoot, encoding: "utf8", windowsHide: true, timeout: 60000 },
  );
  if (result.status !== 0)
    throw new Error(`Packaged DSH cannot load: ${result.error?.message || result.stderr}`);
  console.log(result.stdout.trim());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyDcodeRuntime(resolve(process.argv[2]));
}
