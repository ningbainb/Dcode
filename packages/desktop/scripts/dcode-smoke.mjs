import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright-core';
import { createFixture } from '../../dsh-runtime/test/fixture.mjs';

const desktop = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(desktop, '../../../..');
const data = resolve(process.env.DCODE_UI_TEST_ROOT || join(workspaceRoot, '.data/ui-smoke'));
const { workspace, server } = await createFixture(data);
await mkdir(join(data, 'home'), { recursive: true });
await writeFile(join(workspace, 'output.txt'), 'baseline\n');
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=DCode Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture baseline']]) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 && !result.stdout.includes('nothing to commit')) throw new Error(result.stderr);
}
const errors = [];
async function capture(page, name) {
  const client = await page.context().newCDPSession(page);
  try {
    const { data: png } = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(data, name), Buffer.from(png, 'base64'));
  } finally { await client.detach(); }
}
let app;
try {
  console.log('[smoke] Launching Electron');
  const inheritedEnv = { ...process.env };
  // Electron 按变量是否存在切换 Node 模式，设为空字符串仍会禁用桌面启动。
  delete inheritedEnv.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: process.env.DCODE_TEST_EXECUTABLE || resolve(desktop, '../../node_modules/electron/dist/electron.exe'),
    args: process.env.DCODE_TEST_EXECUTABLE ? [] : [desktop],
    cwd: workspaceRoot, timeout: 120000,
    env: { ...inheritedEnv,
      DCODE_DATA_DIR: data, DCODE_NODE_PATH: process.env.DCODE_TEST_EXECUTABLE ? '' : join(workspaceRoot, '.tools/node_modules/node-win-x64/bin/node.exe'),
      ZCODE_DATA_BASE_DIR: data, ZCODE_DESKTOP_HOME_DIR: join(data, 'home'),
      ZCODE_DESKTOP_USER_DATA_DIR: join(data, 'electron'),
      ZCODE_DESKTOP_SESSION_DATA_DIR: join(data, 'electron/session'),
      ZCODE_DESKTOP_APPLICATION_NAME: 'DCode Smoke', DSH_TELEMETRY_DISABLED: '1',
      TEMP: join(workspaceRoot, '.cache/tmp'), TMP: join(workspaceRoot, '.cache/tmp'),
    },
  });
  app.process().stderr.on('data', chunk => errors.push(chunk.toString()));
  const page = await app.firstWindow({ timeout: 120000 });
  console.log('[smoke] Main window created');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await capture(page, '01-startup.png');
  const chat = page.locator('[data-testid="dcode-chat"]:visible');
  await chat.waitFor({ timeout: 180000 });
  await page.waitForFunction(() => document.body.classList.contains('zcode-startup-ready'));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    BrowserWindow.getAllWindows()[0].webContents.send('zcode:open-workspace');
  }, workspace);
  await chat.getByText(workspace, { exact: true }).waitFor({ timeout: 30000 });
  console.log('[smoke] Test workspace opened');
  await chat.getByRole('status').filter({ hasText: 'Connected' }).waitFor({ timeout: 180000 });
  await chat.getByLabel('Model', { exact: true }).selectOption('dcode-fixture/dcode-fixture');
  await chat.getByLabel('Message', { exact: true }).fill('Read input.txt, write and edit output.txt, then execute the verification command.');
  await capture(page, '01-ready.png');
  await writeFile(join(data, 'interaction.json'), JSON.stringify(await page.evaluate(() => {
    const button = document.querySelector('[data-testid="dcode-chat"] button[type="submit"]');
    const textarea = document.querySelector('[data-testid="dcode-chat"] textarea');
    return { buttonDisabled: button?.disabled, buttonRect: button?.getBoundingClientRect().toJSON(),
      textareaValue: textarea?.value, viewport: { width: innerWidth, height: innerHeight }, bodyClass: document.body.className };
  }), null, 2));
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  console.log('[smoke] Message sent');
  const deadline = Date.now() + 180000;
  while (!(await chat.getByTestId('dcode-messages').innerText()).includes('DCode streaming complete.') || await chat.getByRole('button', { name: 'Stop', exact: true }).isVisible()) {
    const allow = chat.getByRole('button', { name: 'Allow once', exact: true });
    if (await allow.isVisible()) await allow.click();
    if (Date.now() > deadline) throw new Error(`Desktop agent timed out: ${await chat.innerText()}`);
    await page.waitForTimeout(300);
  }
  assert.ok((await chat.innerText()).includes('DCODE_SHELL_OK'));
  assert.ok((await chat.innerText()).includes('DCode input'));
  assert.equal(await readFile(join(workspace, 'output.txt'), 'utf8'), 'edited version\n');
  await capture(page, '02-tools.png');
  const savedSession = await chat.getByLabel('Session History', { exact: true }).inputValue();
  await chat.getByRole('button', { name: 'New Session', exact: true }).click();
  await chat.getByText('AI Coding Workspace', { exact: true }).waitFor();
  await chat.getByLabel('Session History', { exact: true }).selectOption(savedSession);
  await chat.getByTestId('dcode-messages').getByText('DCODE_SHELL_OK', { exact: false }).last().waitFor();
  await chat.getByRole('button', { name: 'Restart Runtime', exact: true }).click();
  await page.waitForFunction(() => {
    const panel = [...document.querySelectorAll('[data-testid="dcode-chat"]')].find(element => element.getBoundingClientRect().height > 0);
    return panel && [...panel.querySelectorAll('button')].some(button => button.textContent === 'Restart Runtime' && !button.disabled);
  }, null, { timeout: 120000 });
  assert.ok((await chat.getByTestId('dcode-messages').innerText()).includes('DCODE_SHELL_OK'));
  await chat.getByLabel('Message', { exact: true }).fill('DCODE_CANCEL_TEST');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await chat.getByTestId('dcode-messages').getByText('Waiting 0.', { exact: false }).waitFor({ timeout: 30000 });
  await chat.getByRole('button', { name: 'Stop', exact: true }).click();
  await chat.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 30000 });
  console.log('[smoke] Session history, runtime restart and Stop verified');
  await chat.getByRole('button', { name: 'View Diff', exact: true }).click();
  await page.getByText('output.txt', { exact: true }).last().waitFor({ timeout: 30000 });
  await page.getByText('output.txt', { exact: true }).last().click();
  await page.waitForTimeout(2000);
  await capture(page, '03-diff.png');
  await writeFile(join(data, 'result.json'), JSON.stringify({ passed: true, desktop: true, fixtureModel: true,
    toolOutputVisible: true, fileEdited: true, historyRestored: true, runtimeRestart: true, cancellation: true,
    diffOpened: true, title: await page.title() }, null, 2));
  console.log('PASS: Desktop opened workspace, used DSH fixture model, displayed tool output and opened Git review.');
} finally {
  if (app) {
    for (const [index, page] of app.windows().entries()) {
      await capture(page, `final-${index}.png`).catch(() => {});
      await writeFile(join(data, `final-${index}.txt`), await page.locator('body').innerText().catch(() => 'Window unavailable'));
    }
    await app.close().catch(error => errors.push(error.message));
  }
  await writeFile(join(data, 'desktop-errors.log'), errors.join('\n'));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
