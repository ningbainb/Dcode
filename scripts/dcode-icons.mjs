import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, '../../.tools/dsh-sdk/package.json'));
const sharp = require('sharp');
const svg = await readFile(resolve(root, 'packages/ui/src/assets/dcode-logo.svg'));
const png = await sharp(svg).resize(256, 256).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
for (const name of ['icon.ico', 'icon_installer.ico']) {
  await writeFile(resolve(root, 'packages/desktop/build', name), Buffer.concat([ico, png]));
}
await writeFile(resolve(root, 'packages/desktop/build/icon.png'), png);
await writeFile(resolve(root, 'packages/desktop/build/icon_windows.png'), png);
console.log('DCode Windows icon generated from the DCode SVG.');
