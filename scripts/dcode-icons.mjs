import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, '../../.tools/dsh-sdk/package.json'));
const sharp = require('sharp');
const original = await readFile(resolve(root, '../../branding/dcode-original.png'));
const pngs = new Map();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  pngs.set(size, await sharp(original).resize(size, size).png().toBuffer());
  for (const directory of ['packages/desktop/build/icons', 'public/logo/icons']) {
    await mkdir(resolve(root, directory), { recursive: true });
    await writeFile(resolve(root, directory, `${size}x${size}.png`), pngs.get(size));
  }
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = Buffer.alloc(6 + 16 * sizes.length);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(sizes.length, 4);
let offset = ico.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16, png = pngs.get(size);
  ico[entry] = size % 256; ico[entry + 1] = size % 256;
  ico.writeUInt16LE(1, entry + 4); ico.writeUInt16LE(32, entry + 6);
  ico.writeUInt32LE(png.length, entry + 8); ico.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
const icon = Buffer.concat([ico, ...sizes.map(size => pngs.get(size))]);
for (const file of ['packages/desktop/build/icon.ico', 'packages/desktop/build/icon_installer.ico', 'packages/desktop/build/tray_icon.ico', 'public/logo/icons/icon.ico']) await writeFile(resolve(root, file), icon);
const chunks = [];
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const png = pngs.get(size), header = Buffer.alloc(8);
  header.write(type); header.writeUInt32BE(png.length + 8, 4);
  chunks.push(header, png);
}
const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
for (const file of ['packages/desktop/build/icon.icns', 'packages/desktop/build/icon_installer.icns', 'public/logo/icons/icon.icns']) await writeFile(resolve(root, file), Buffer.concat([header, ...chunks]));
for (const file of ['packages/ui/src/assets/dcode-logo.png', 'packages/desktop/build/icon.png', 'packages/desktop/build/icon_installer.png', 'packages/desktop/build/icon_windows.png', 'packages/desktop/build/tray_icon.png', 'packages/desktop/build/icon_512x512.png', 'public/icon_512@2x.png']) await writeFile(resolve(root, file), pngs.get(512));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${pngs.get(512).toString('base64')}"/></svg>`;
for (const file of ['packages/ui/src/assets/dcode-logo.svg', 'packages/ui/src/assets/Z.svg']) await writeFile(resolve(root, file), svg);
console.log('Dcode application, installer, tray, PNG, ICO and ICNS assets generated from the supplied artwork.');

// DMG 背景也属于发行物身份；由同一 artwork 生成，避免平台切换后回退旧标识。
const dmg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="380"><rect width="540" height="380" fill="#f4f5f7"/><image x="222" y="24" width="96" height="96" href="data:image/png;base64,${pngs.get(128).toString('base64')}"/><text x="270" y="152" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="32" font-weight="600" fill="#252528">Dcode</text><path d="M220 224 Q270 194 316 224 M302 204 L319 226 L298 231" fill="none" stroke="#666" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
for (const [name, width] of [['dmg_background.png', 540], ['dmg_background@2x.png', 1080]]) await sharp(dmg).resize(width).png().toFile(resolve(root, 'packages/desktop/build', name));
