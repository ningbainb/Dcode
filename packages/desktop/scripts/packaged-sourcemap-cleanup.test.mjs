import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { stripSourceMappingUrlCommentsInDirectory } from './packaged-sourcemap-cleanup.mjs';

test('stripping a packaged hardlink leaves the runtime source untouched', () => {
  const workspace = resolve(import.meta.dirname, '../../..');
  const dataDir = join(workspace, '.data');
  mkdirSync(dataDir, { recursive: true });
  const root = mkdtempSync(join(dataDir, 'sourcemap-hardlink-'));
  assert.ok(root.startsWith(`${dataDir}${sep}`));
  try {
    const source = join(root, 'runtime.js');
    const packagedDir = join(root, 'resources');
    mkdirSync(packagedDir);
    const packaged = join(packagedDir, 'runtime.js');
    const original = 'export const ready = true;\n//# sourceMappingURL=runtime.js.map\n';
    writeFileSync(source, original);
    linkSync(source, packaged);

    assert.deepEqual(stripSourceMappingUrlCommentsInDirectory(packagedDir), {
      filesChanged: 1,
      referencesRemoved: 1,
    });
    assert.equal(readFileSync(source, 'utf8'), original);
    assert.equal(readFileSync(packaged, 'utf8'), 'export const ready = true;\n');
    assert.equal(existsSync(join(packagedDir, 'runtime.js.map')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
