import base from './electron-builder.config.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { collectRuntimeModuleClosureEntries } from './scripts/runtime-dependency-closure.mjs';
import { brandDcodeExecutable } from './scripts/brand-dcode-executable.mjs';
import { verifyPackagedRenderer } from './scripts/verify-dcode-renderer.mjs';
import { verifyDcodeRuntime } from './scripts/verify-dcode-runtime.mjs';

const desktop = import.meta.dirname;
const metadata = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'));
const appVersion = JSON.parse(readFileSync(resolve(desktop, '../../package.json'), 'utf8')).version;
const externalRoots = Object.entries(metadata.dependencies)
  .filter(([name, version]) => !version.startsWith('workspace:') && !name.startsWith('@lydell/node-pty-linux-'))
  .map(([name]) => name);
const externalClosure = collectRuntimeModuleClosureEntries(externalRoots, [desktop, resolve(desktop, '../..')]);
const missing = externalClosure.filter(entry => !entry.sourceModulePath);
if (missing.length) throw new Error(`Missing desktop dependencies: ${missing.map(entry => entry.moduleName).join(', ')}`);

export default {
  ...base,
  appId: 'com.dcode.desktop',
  productName: 'Dcode',
  extraMetadata: { ...base.extraMetadata, name: 'dcode-desktop', author: { name: 'Dcode' }, homepage: null, version: appVersion, zcodeProductFlavor: 'production' },
  directories: { ...base.directories, output: resolve(desktop, `../../artifacts/v${appVersion}`) },
  // UI/services 已内联，不能再遍历其整棵依赖树并重复打入独立部署的 DSH。
  files: [...base.files, '!node_modules/**/*',
    ...externalClosure.map(entry => `node_modules/${entry.moduleName}/**/*`),
    ...base.files.filter(pattern => typeof pattern === 'string' && pattern.startsWith('!')),
    '!node_modules/@dcode/**', '!node_modules/@deepseek-ai/**'],
  extraResources: [
    ...base.extraResources,
    { from: 'dcode-runtime-v2', to: 'dsh-runtime', filter: ['**/*'] },
    // extraResources 默认过滤嵌套 node_modules，必须以它自身为复制根。
    { from: 'dcode-runtime-v2/node_modules', to: 'dsh-runtime/node_modules', filter: ['**/*'] },
    { from: '../../LICENSE', to: 'ZCode-LICENSE' },
    { from: '../../NOTICE.DCode.md', to: 'NOTICE.DCode.md' },
  ],
  protocols: [{ name: 'Dcode', schemes: ['dcode'] }],
  win: { ...base.win, target: ['nsis'], artifactName: 'Dcode-Setup-${version}-${arch}.${ext}', signAndEditExecutable: false },
  publish: { provider: 'github', owner: 'ningbainb', repo: 'Dcode' },
  afterPack: async context => {
    await base.afterPack(context);
    if (context.electronPlatformName === 'win32') await brandDcodeExecutable(resolve(context.appOutDir, 'Dcode.exe'));
    verifyPackagedRenderer(resolve(context.appOutDir, 'resources/app.asar'));
    verifyDcodeRuntime(resolve(context.appOutDir, 'resources/dsh-runtime'));
  },
};
