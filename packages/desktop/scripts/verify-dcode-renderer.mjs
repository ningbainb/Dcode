import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(path));
    else result.push(path);
  }
  return result;
}

export async function recordRendererManifest(outDirectory) {
  const renderer = join(outDirectory, 'renderer');
  const paths = (await filesIn(renderer)).filter(path => !path.endsWith('.map'));
  const known = new Set(paths.map(path => relative(renderer, path).replaceAll('\\', '/')));
  assert.ok(known.has('index.html'), 'Build the desktop renderer before packaging');
  for (const path of paths.filter(path => path.endsWith('.html'))) {
    const html = await readFile(path, 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"?]+)/g)) {
      assert.ok(known.has(match[1]), `Incomplete renderer: ${match[1]}`);
    }
  }
  const manifest = { files: [...known].sort() };
  await mkdir(join(outDirectory, 'metadata'), { recursive: true });
  await writeFile(join(outDirectory, 'metadata/dcode-renderer-manifest.json'), JSON.stringify(manifest));
  console.log(`DCode renderer manifest: ${manifest.files.length} files`);
}

export function verifyPackagedRenderer(archive) {
  const entries = new Set(listPackage(archive).map(path => path.replaceAll('\\', '/').replace(/^\//, '')));
  const manifest = JSON.parse(extractFile(archive, normalize('out/metadata/dcode-renderer-manifest.json')).toString());
  for (const path of manifest.files) assert.ok(entries.has(`out/renderer/${path}`), `Missing packaged renderer resource: ${path}`);
  console.log(`DCode packaged renderer verified: ${manifest.files.length} files`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === '--archive') verifyPackagedRenderer(resolve(process.argv[3]));
  else await recordRendererManifest(resolve(process.argv[2] || join(import.meta.dirname, '../out')));
}
