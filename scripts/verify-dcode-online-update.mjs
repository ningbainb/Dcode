import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const oldVersion = process.env.DCODE_UPDATE_FROM_VERSION || '0.2.5';
const expectedVersion = process.env.DCODE_UPDATE_TO_VERSION || '0.2.6';
const executable = resolve(root, `artifacts/v${oldVersion}/win-unpacked/Dcode.exe`);
const data = resolve(process.env.DCODE_UPDATE_TEST_ROOT || join(root, `../../.data/update-${oldVersion}-${expectedVersion}`));
const home = join(data, 'home');
const appData = join(data, 'appdata');
const localAppData = join(data, 'localappdata');
await Promise.all([home, appData, localAppData].map((path) => mkdir(path, { recursive: true })));
if (process.env.DCODE_UPDATE_SEED_CACHE === '1') {
  const pending = join(localAppData, 'dcode-desktop-updater', 'pending');
  const fileName = `Dcode-Setup-${expectedVersion}-x64.exe`;
  const releaseDir = resolve(root, `artifacts/v${expectedVersion}`);
  const manifest = await readFile(join(releaseDir, 'latest.yml'), 'utf8');
  const sha512 = /^sha512:\s*(\S+)$/m.exec(manifest)?.[1];
  assert.ok(sha512);
  await mkdir(pending, { recursive: true });
  await copyFile(join(releaseDir, fileName), join(pending, fileName));
  await writeFile(join(pending, 'update-info.json'), JSON.stringify({
    fileName, sha512, isAdminRightsRequired: false,
  }));
  console.log(`SEEDED: ${fileName}`);
}
async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const environment = { ...process.env,
  DCODE_DATA_DIR: data,
  ZCODE_DATA_BASE_DIR: data,
  ZCODE_DESKTOP_USER_DATA_DIR: join(data, 'electron'),
  ZCODE_DESKTOP_HOME_DIR: home,
  USERPROFILE: home,
  HOME: home,
  APPDATA: appData,
  LOCALAPPDATA: localAppData,
};
delete environment.ELECTRON_RUN_AS_NODE;

let electron;
try {
  electron = await _electron.launch({ executablePath: executable, cwd: root, env: environment, timeout: 120000 });
  const page = await electron.firstWindow({ timeout: 120000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.body.classList.contains('zcode-startup-ready'), null,
    { timeout: 180000 });
  await page.evaluate(() => {
    window.__dcodeUpdateResults = [];
    window.__dcodeUpdateStates = [];
    window.zcode.onUpdateCheckResult((value) => window.__dcodeUpdateResults.push(value));
    window.zcode.onUpdateStateChanged((value) => window.__dcodeUpdateStates.push(value));
  });
  const appVersion = await electron.evaluate(({ app }) => app.getVersion());
  assert.equal(appVersion, oldVersion);
  // Use the same desktop command as Dcode's custom Help menu.
  await page.evaluate(() => window.zcode.executeDesktopCommand('checkForUpdates'));
  await page.waitForFunction((version) => window.__dcodeUpdateStates.some((value) =>
    value.kind === 'update-available' && value.version === version), expectedVersion, { timeout: 180000 });
  console.log(`DISCOVERED: ${oldVersion} -> ${expectedVersion}`);
  await page.evaluate(() => window.zcode.downloadUpdate());
  await page.waitForFunction((version) => window.__dcodeUpdateStates.some((value) =>
    value.kind === 'update-downloaded' && value.version === version), expectedVersion, { timeout: 1200000 });
  const states = await page.evaluate(() => window.__dcodeUpdateStates.map((value) =>
    ({ kind: value.kind, version: value.version, progress: value.progress })));
  const expectedHash = await sha256File(resolve(root, `artifacts/v${expectedVersion}/Dcode-Setup-${expectedVersion}-x64.exe`));
  const files = await readdir(data, { recursive: true, withFileTypes: true });
  const installers = files.filter((entry) => entry.isFile() && entry.name.endsWith('.exe'));
  const hashes = await Promise.all(installers.map(async (entry) => {
    const path = resolve(entry.parentPath, entry.name);
    return { path, hash: await sha256File(path) };
  }));
  assert.ok(hashes.some((entry) => entry.hash === expectedHash), 'Downloaded installer hash differs from release asset.');
  console.log(JSON.stringify({ appVersion, expectedVersion, states, downloadedHash: expectedHash }, null, 2));
  const appUpdate = await readFile(resolve(root, `artifacts/v${oldVersion}/win-unpacked/resources/app-update.yml`), 'utf8');
  assert.match(appUpdate, /repo: Dcode/);
} finally {
  await electron?.close();
}
