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
    import { readFileSync } from 'node:fs';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    await import(process.argv[1]);
    const require = createRequire(process.argv[1]);
    const root = fileURLToPath(new URL('../', process.argv[1]));
    const runtimeManifest = JSON.parse(readFileSync(new URL('../package.json', process.argv[1]), 'utf8'));
    for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-mcp-client']) {
      const actual = JSON.parse(readFileSync(require.resolve(name + '/package.json'), 'utf8'));
      assert.equal(actual.version, runtimeManifest.dependencies[name]?.split('(')[0], name + ' packaged version mismatch');
    }
    for (const name of ['ws', 'yaml', 'chokidar', '@deepseek-ai/dsh/lib/bin.js', '@deepseek-ai/dsh-base/package.json', '@deepseek-ai/dsh-web-app/package.json', '@deepseek-ai/dsh-mcp-client/package.json', '@playwright/mcp/package.json']) {
      assert.ok(require.resolve(name).startsWith(root), name + ' must resolve inside the packaged runtime');
    }
    assert.equal(JSON.parse(readFileSync(new URL('./package.json', pathToFileURL(require.resolve('chokidar'))), 'utf8')).version, '5.0.0');
    for (const name of ['@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) await import(pathToFileURL(require.resolve(name)).href);
    const bridge = await import(new URL('../vendor/dcode-zcode-session-import/index.mjs', process.argv[1]).href);
    assert.equal(bridge.name, 'dcode-zcode-session-import');
    const skills = await import(new URL('../vendor/dcode-zcode-skills/index.mjs', process.argv[1]).href);
    assert.equal(skills.name, 'dcode-zcode-skills');
    console.log('DCode physical runtime dependency verification passed');
  `,
      entry,
    ],
    // Windows cold starts can spend over a minute loading the DSH plugin manager
    // from the physical deployment tree. Keep the real import check, but allow
    // enough time for it to finish on a busy disk.
    { cwd: runtimeRoot, encoding: "utf8", windowsHide: true, timeout: 180000 },
  );
  if (result.status !== 0)
    throw new Error(`Packaged DSH cannot load: ${result.error?.message || result.stderr}`);
  console.log(result.stdout.trim());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyDcodeRuntime(resolve(process.argv[2]));
}
