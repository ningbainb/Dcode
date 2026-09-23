import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import config from '../electron-builder.dcode.mjs';
import { brandDcodeExecutable } from './brand-dcode-executable.mjs';
import { verifyPackagedRenderer } from './verify-dcode-renderer.mjs';
import { verifyDcodeRuntime } from './verify-dcode-runtime.mjs';

const root = resolve(import.meta.dirname, '../../..');
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const expected = resolve(root, 'artifacts', `v${version}`, 'win-unpacked');
const unpacked = resolve(process.argv[2] ?? expected);
assert.equal(unpacked.toLowerCase(), expected.toLowerCase(), 'Only the current Dcode release directory can be prepared');

const publish = config.publish;
assert.deepEqual({ provider: publish.provider, owner: publish.owner, repo: publish.repo }, {
  provider: 'github', owner: 'ningbainb', repo: 'Dcode',
});
const updateConfig = {
  owner: publish.owner,
  repo: publish.repo,
  provider: publish.provider,
  updaterCacheDirName: `${config.extraMetadata.name}-updater`,
};
await writeFile(resolve(unpacked, 'resources', 'app-update.yml'), stringifyYaml(updateConfig));

// electron-builder's --prepackaged path skips its onAfterPack update-config hook.
// The Windows installer manifest and executable resource hashes must include
// the metadata before NSIS reads the verified unpacked directory.
const installManifestPath = resolve(unpacked, '.zcode-install-manifest');
const entries = new Set((await readFile(installManifestPath, 'utf8')).split(/\r?\n/).filter(Boolean));
entries.add('resources\\app-update.yml');
await writeFile(installManifestPath, `${[...entries].sort().join('\r\n')}\r\n`, 'utf8');
await brandDcodeExecutable(resolve(unpacked, 'Dcode.exe'));
verifyPackagedRenderer(resolve(unpacked, 'resources', 'app.asar'));
verifyDcodeRuntime(resolve(unpacked, 'resources', 'dsh-runtime'));
console.log(`Dcode prepackaged update config verified: ${version} ${publish.owner}/${publish.repo}`);
