import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { extractFile } from '@electron/asar';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const artifactDir = resolve(root, `artifacts/v${version}`);
const installerName = `Dcode-Setup-${version}-x64.exe`;
const installerPath = resolve(artifactDir, installerName);
const manifest = parseYaml(await readFile(resolve(artifactDir, 'latest.yml'), 'utf8'));
const appUpdate = parseYaml(await readFile(resolve(artifactDir, 'win-unpacked/resources/app-update.yml'), 'utf8'));
const packageInfo = JSON.parse(extractFile(resolve(artifactDir, 'win-unpacked/resources/app.asar'), 'package.json').toString());
const installerStat = await stat(installerPath);
const blockmapStat = await stat(`${installerPath}.blockmap`);
const hash = createHash('sha512');
for await (const chunk of createReadStream(installerPath)) hash.update(chunk);
const sha512 = hash.digest('base64');

assert.equal(manifest.version, version);
assert.equal(manifest.path, installerName);
assert.equal(manifest.sha512, sha512);
assert.deepEqual(manifest.files.map(({ url, sha512: checksum, size }) => ({ url, checksum, size })), [
  { url: installerName, checksum: sha512, size: installerStat.size },
]);
assert.ok(blockmapStat.size > 0);
assert.deepEqual({ provider: appUpdate.provider, owner: appUpdate.owner, repo: appUpdate.repo }, {
  provider: 'github', owner: 'ningbainb', repo: 'Dcode',
});
assert.equal(packageInfo.version, version);
assert.equal(packageInfo.name, 'dcode-desktop');

const pinnedNode = /node\s*=\s*"([^"]+)"/.exec(await readFile(resolve(root, 'mise.toml'), 'utf8'))?.[1];
assert.ok(pinnedNode, 'mise.toml must pin Node');
const bundledNode = spawnSync(resolve(artifactDir, 'win-unpacked/resources/dsh-runtime/node.exe'), ['--version'], {
  encoding: 'utf8', windowsHide: true,
});
assert.equal(bundledNode.status, 0, bundledNode.stderr);
assert.equal(bundledNode.stdout.trim(), `v${pinnedNode}`);

console.log(JSON.stringify({ version, installer: installerPath, bytes: installerStat.size, sha512,
  blockmapBytes: blockmapStat.size, provider: `${appUpdate.owner}/${appUpdate.repo}`, node: bundledNode.stdout.trim() }, null, 2));
