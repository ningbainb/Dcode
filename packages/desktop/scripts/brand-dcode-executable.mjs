import { createRequire } from 'node:module';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// Reuse electron-builder's pinned PE resource editor, without signing helpers.
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const { NtExecutable, NtExecutableResource, Data, Resource } = builderRequire('resedit');
const { computeData } = builderRequire('./out/asar/integrity.js');

export async function brandDcodeExecutable(executablePath) {
  const executable = NtExecutable.from(await readFile(executablePath));
  const resources = NtExecutableResource.from(executable);
  const icon = Data.IconFile.from(await readFile(resolve(import.meta.dirname, '../build/icon.ico')));
  const appVersion = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../package.json'), 'utf8')).version;
  const windowsVersion = `${appVersion}.0`.split('.').map(part => Number.parseInt(part, 10) || 0).slice(0, 4).join('.');
  const groups = resources.entries.filter(entry => entry.type === 14);
  for (const group of groups) Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries, group.id, group.lang, icon.icons.map(item => item.data),
  );
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    version.setFileVersion(...windowsVersion.split('.').map(Number));
    version.setProductVersion(...windowsVersion.split('.').map(Number));
    for (const language of version.getAllLanguagesForStringValues()) version.setStringValues(language, {
      FileDescription: 'Dcode AI Coding Workspace', ProductName: 'Dcode', CompanyName: 'Dcode',
      InternalName: 'Dcode', OriginalFilename: 'Dcode.exe',
    });
    version.outputToResourceEntries(resources.entries);
  }
  // afterPack 可能补齐依赖并重封 app.asar，必须同步最终归档的完整性资源。
  const integrity = resources.entries.find(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  if (integrity) {
    const resourcesPath = resolve(dirname(executablePath), 'resources');
    const hashes = await computeData({ resourcesPath, resourcesRelativePath: 'resources', resourcesDestinationPath: resourcesPath, extraResourceMatchers: [] });
    integrity.bin = Buffer.from(JSON.stringify(Object.entries(hashes).map(([file, hash]) => ({ file: win32.normalize(file), alg: hash.algorithm, value: hash.hash }))));
  }
  resources.outputResource(executable);
  const temporary = `${executablePath}.brand-tmp`;
  await writeFile(temporary, Buffer.from(executable.generate()));
  await rename(temporary, executablePath);
  console.log(`Dcode Windows resources applied: ${executablePath}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await brandDcodeExecutable(resolve(process.argv[2]));
}
