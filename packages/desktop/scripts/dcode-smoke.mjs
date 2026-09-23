import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright-core';
import { createFixture } from '../../dsh-runtime/test/fixture.mjs';

const desktop = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(desktop, '../../../..');
const data = resolve(process.env.DCODE_UI_TEST_ROOT || join(workspaceRoot, '.data/ui-smoke'));
const { workspace, server, requests } = await createFixture(data);
await mkdir(join(data, 'home'), { recursive: true });
const userMcpConfigPath = join(data, 'home', '.zcode', 'cli', 'config.json');
await mkdir(join(data, 'home', '.zcode', 'cli'), { recursive: true });
const userMcpConfig = { mcp: { servers: {
  imported_tool: { type: 'stdio', command: 'node', args: ['fixture-server.js'] },
  inline_secret: { type: 'stdio', command: 'node', env: { API_KEY: 'synthetic-secret' } },
} } };
await writeFile(userMcpConfigPath, JSON.stringify(userMcpConfig));
const commandPath = join(workspace, '.zcode', 'commands', 'review.md');
await mkdir(join(workspace, '.zcode', 'commands'), { recursive: true });
await writeFile(commandPath, '---\ndescription: Review a target\n---\n\nDCODE_CUSTOM_COMMAND_MARKER Review $1 and $ARGUMENTS\n');
await writeFile(join(workspace, 'output.txt'), 'baseline\n');
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=DCode Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture baseline']]) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 && !result.stdout.includes('nothing to commit')) throw new Error(result.stderr);
}
const errors = [];
async function waitForWorkspace(chat, path) {
  const indicator = chat.getByTestId('dsh-current-workspace');
  await indicator.getByText(basename(path), { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await indicator.getAttribute('title'), path);
}
function explorerMenus() {
  return ['Directory', 'Drive'].flatMap(kind => ['ZCode.OpenInZCode', 'DCode.OpenInDCode'].map(name => {
    const result = spawnSync('reg.exe', ['query', `HKCU\\Software\\Classes\\${kind}\\shell\\${name}`, '/s'], { encoding: 'utf8', windowsHide: true });
    return { status: result.status, output: result.stdout };
  }));
}
const originalMenus = explorerMenus();
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
  const launchOptions = {
    executablePath: process.env.DCODE_TEST_EXECUTABLE || resolve(desktop, '../../node_modules/electron/dist/electron.exe'),
    args: process.env.DCODE_TEST_EXECUTABLE ? [] : [desktop],
    cwd: workspaceRoot, timeout: 120000,
    env: { ...inheritedEnv,
      DCODE_DATA_DIR: data, DCODE_NODE_PATH: process.env.DCODE_TEST_EXECUTABLE ? '' : join(workspaceRoot, '.tools/node_modules/node-win-x64/bin/node.exe'),
      // 首次安装的会话导入会扫描 os.homedir()；烟测必须隔离真实用户的 ZCode 历史。
      USERPROFILE: join(data, 'home'), HOME: join(data, 'home'),
      ZCODE_DATA_BASE_DIR: data, ZCODE_DESKTOP_HOME_DIR: join(data, 'home'),
      ZCODE_DESKTOP_USER_DATA_DIR: join(data, 'electron'),
      ZCODE_DESKTOP_SESSION_DATA_DIR: join(data, 'electron/session'),
      ZCODE_DESKTOP_APPLICATION_NAME: 'DCode Smoke', DSH_TELEMETRY_DISABLED: '1',
      TEMP: join(workspaceRoot, '.cache/tmp'), TMP: join(workspaceRoot, '.cache/tmp'),
    },
  };
  app = await _electron.launch(launchOptions);
  app.process().stderr.on('data', chunk => errors.push(chunk.toString()));
  let page = await app.firstWindow({ timeout: 120000 });
  console.log('[smoke] Main window created');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded', { timeout: 120000 });
  await capture(page, '01-startup.png');
  let chat = page.locator('[data-testid="dcode-chat"]:visible');
  await chat.waitFor({ timeout: 180000 });
  await page.waitForFunction(() => document.body.classList.contains('zcode-startup-ready'));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    BrowserWindow.getAllWindows()[0].webContents.send('zcode:open-workspace');
  }, workspace);
  await waitForWorkspace(chat, workspace);
  await capture(page, '01-workspace.png');
  console.log('[smoke] Test workspace opened');
  await chat.getByRole('status').filter({ hasText: /Ready|就绪/ }).waitFor({ timeout: 300000 });
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: /^(Model settings|模型设置)$/ }).click();
  const modelSettings = page.getByTestId('dsh-model-settings');
  await modelSettings.getByTestId('dsh-provider-nav-add').click();
  const providerCatalog = modelSettings.getByTestId('dsh-provider-catalog');
  await providerCatalog.waitFor();
  await providerCatalog.getByRole('textbox', { name: /^(Search providers|搜索供应商)$/ }).fill('OpenAI');
  await providerCatalog.getByRole('button', { name: /^OpenAI/ }).waitFor();
  assert.equal(await providerCatalog.getByRole('button', { name: /ZCode|Z\.ai|BigModel|Start Plan/i }).count(), 0);
  await providerCatalog.getByRole('textbox', { name: /^(Search providers|搜索供应商)$/ }).clear();
  await modelSettings.getByRole('button', { name: /^(Custom provider|自定义供应商)$/ }).click();
  await modelSettings.getByLabel(/^(Display name|显示名称)$/).first().fill('DCode UI Fixture');
  await modelSettings.getByLabel(/^(Provider ID|供应商 ID)$/).fill('desktop-ui-fixture');
  await modelSettings.getByLabel(/^(Base URL|接口地址)$/).fill(`http://127.0.0.1:${server.address().port}/v1`);
  await modelSettings.getByLabel(/^(Model ID|模型 ID)$/).fill('dcode-fixture');
  await modelSettings.getByTestId('model-provider-api-key-input').fill('synthetic-local-test-key');
  if (process.env.DCODE_TEST_IMAGES === '1') {
    const advanced = modelSettings.getByTestId('dsh-model-advanced').first();
    await advanced.locator('summary').click();
    await advanced.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Declare explicitly|手动声明/ }).click();
    await advanced.getByRole('checkbox', { name: /Images|图片/ }).click();
  }
  await modelSettings.getByRole('button', { name: /^(Save to DSH|保存到 DSH)$/ }).click();
  await modelSettings.getByText(/已保存到 DSH|Saved to DSH/).waitFor({ timeout: 30000 });
  assert.equal(await modelSettings.getByTestId('model-provider-api-key-input').inputValue(), '');
  await capture(page, '05-dsh-model-providers.png');
  await page.getByRole('button', { name: /^MCP (servers|服务器)$/i }).click();
  const mcpSettings = page.getByTestId('dsh-mcp-settings');
  await mcpSettings.waitFor();
  await mcpSettings.getByRole('button', { name: /^(Import from ZCode|从 ZCode 导入)$/ }).click();
  await mcpSettings.getByText(/已导入 1 个停用的服务器，跳过 1 个|Imported 1 disabled servers; skipped 1/).waitFor({ timeout: 120000 });
  await mcpSettings.getByTestId('dsh-mcp-nav-item').filter({ hasText: 'imported_tool' }).waitFor();
  assert.equal(await mcpSettings.getByTestId('dsh-mcp-nav-item').filter({ hasText: 'inline_secret' }).count(), 0);
  assert.equal(await readFile(userMcpConfigPath, 'utf8'), JSON.stringify(userMcpConfig));
  assert.doesNotMatch(await readFile(join(data, 'dsh-mcp-servers.json'), 'utf8'), /synthetic-secret/);
  await capture(page, 'mcp-settings.png');
  await page.getByTestId('settings-back-button').click();
  await modelSettings.waitFor({ state: 'hidden' });
  await chat.getByTestId('dsh-model-select').selectOption('desktop-ui-fixture/dcode-fixture');
  await chat.getByTestId('dsh-message-input').fill('Read input.txt, write and edit output.txt, then execute the verification command.');
  await capture(page, '01-ready.png');
  await writeFile(join(data, 'interaction.json'), JSON.stringify(await page.evaluate(() => {
    const button = document.querySelector('[data-testid="dcode-chat"] button[type="submit"]');
    const textarea = document.querySelector('[data-testid="dcode-chat"] textarea');
    return { buttonDisabled: button?.disabled, buttonRect: button?.getBoundingClientRect().toJSON(),
      textareaValue: textarea?.value, viewport: { width: innerWidth, height: innerHeight }, bodyClass: document.body.className };
  }), null, 2));
  await chat.getByTestId('dsh-send').click();
  console.log('[smoke] Message sent');
  const aclRepairScenario = process.env.DCODE_TEST_ACL_REPAIR === '1';
  if (aclRepairScenario) {
    assert.equal(process.env.DSH_PERMISSION_MODE, undefined, 'ACL repair must run with the default sandbox');
    const repair = chat.getByTestId('dsh-windows-acl-repair');
    await repair.getByRole('button', { name: /Repair permissions|修复权限/ }).waitFor({ timeout: 180000 });
    assert.match(await chat.getByTestId('dcode-messages').innerText(), /SetNamedSecurityInfoW failed \(Win32 5\)/);
    await repair.getByRole('button', { name: /Repair permissions|修复权限/ }).click();
    await repair.getByText(/Workspace permission repaired|已为当前项目补充所需权限/).waitFor({ timeout: 30000 });
    await chat.getByTestId('dsh-stop').waitFor({ state: 'hidden', timeout: 120000 });
    await page.getByTestId('conversation-new-task').click();
    await chat.getByTestId('dsh-empty-state').waitFor();
    await chat.getByTestId('dsh-message-input').fill('Read input.txt, write and edit output.txt, then execute the verification command.');
    await chat.getByTestId('dsh-send').click();
    console.log('[smoke] Windows ACL repaired; retrying in a new DSH session');
  }
  const deadline = Date.now() + 180000;
  while (!(await chat.getByTestId('dcode-messages').innerText()).includes('DCode streaming complete.') || await chat.getByTestId('dsh-stop').isVisible()) {
    const allow = chat.getByRole('button', { name: /Allow once|允许一次/ });
    if (await allow.isVisible()) await allow.click();
    if (Date.now() > deadline) throw new Error(`Desktop agent timed out: ${await chat.innerText()}`);
    await page.waitForTimeout(300);
  }
  assert.ok((await chat.innerText()).includes('DCODE_SHELL_OK'));
  if (aclRepairScenario) {
    const shellRow = chat.getByTestId('dcode-messages').locator('[data-testid="dsh-tool-row"][data-tool-name="pwsh"]').last();
    assert.match(await shellRow.getAttribute('aria-label'), /Done|已完成/);
    await shellRow.click();
    assert.match(await shellRow.locator('xpath=..').locator('pre').last().innerText(), /DCODE_SHELL_OK/);
  }
  await capture(page, '02-activity-compact.png');
  await chat.getByTestId('dcode-messages').locator('[data-testid="dsh-tool-row"][data-tool-name="read"]').first().click();
  assert.ok((await chat.innerText()).includes('DCode input'));
  assert.ok(!(await chat.getByTestId('dcode-messages').innerText()).includes('<available_skills>'), 'internal skill catalogs must not render as user messages');
  assert.equal(await readFile(join(workspace, 'output.txt'), 'utf8'), 'edited version\n');
  await chat.getByTestId('dsh-message-input').fill('/review "src/my file.ts" carefully');
  await chat.getByTestId('dsh-send').click();
  const commandDeadline = Date.now() + 30000;
  while (!requests.some(request => JSON.stringify(request.messages).includes('DCODE_CUSTOM_COMMAND_MARKER Review src/my file.ts and \\"src/my file.ts\\" carefully'))) {
    if (Date.now() > commandDeadline) throw new Error('ZCode command was not expanded into the DSH model request');
    await page.waitForTimeout(100);
  }
  await chat.getByTestId('dsh-stop').waitFor({ state: 'hidden', timeout: 30000 });
  if (process.env.DCODE_TEST_IMAGES === '1') {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      chat.getByTestId('dsh-add-images').click(),
    ]);
    await chooser.setFiles(resolve(desktop, '../../docs/assets/dcode-icon.png'));
    await chat.getByTestId('dsh-image-drafts').getByText('dcode-icon.png').waitFor();
    await capture(page, '06-image-draft.png');
    await chat.getByTestId('dsh-send').click();
    const image = chat.getByTestId('dsh-message-images').last().getByRole('button', { name: 'dcode-icon.png' });
    await image.waitFor({ timeout: 30000 });
    await image.click();
    const preview = page.getByRole('dialog', { name: 'dcode-icon.png' });
    await preview.getByRole('img', { name: 'dcode-icon.png' }).waitFor();
    assert.match(await preview.getByRole('img', { name: 'dcode-icon.png' }).getAttribute('src'), /^data:image\/png;base64,/);
    await capture(page, '07-image-preview.png');
    await preview.getByRole('button', { name: /Close image|关闭图片/ }).click();
    await chat.getByTestId('dsh-stop').waitFor({ state: 'hidden', timeout: 30000 });
  }
  if (process.env.DCODE_TEST_FILES === '1') {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      chat.getByTestId('dsh-add-files').click(),
    ]);
    await chooser.setFiles(join(workspace, 'output.txt'));
    await chat.getByTestId('dsh-file-drafts').getByText('output.txt').waitFor();
    await capture(page, '08-file-draft.png');
    await chat.getByTestId('dsh-send').click();
    await chat.getByTestId('dsh-message-files').last().getByText('output.txt').waitFor({ timeout: 30000 });
    await capture(page, '09-file-message.png');
    await chat.getByTestId('dsh-stop').waitFor({ state: 'hidden', timeout: 30000 });
  }
  await writeFile(userMcpConfigPath, JSON.stringify({ ...userMcpConfig, command: { [commandPath]: { enable: false } } }));
  await chat.getByTestId('dsh-message-input').fill('/review blocked');
  await chat.getByTestId('dsh-send').click();
  await chat.getByText('Custom command /review is disabled.').waitFor({ timeout: 30000 });
  assert.equal(await chat.getByTestId('dsh-message-input').inputValue(), '/review blocked');
  assert.ok(!requests.some(request => JSON.stringify(request.messages).includes('DCODE_CUSTOM_COMMAND_MARKER Review blocked')));
  await capture(page, '02-tools.png');
  const sessionList = page.getByTestId('dsh-session-list');
  await sessionList.getByTestId('dsh-session-item').first().waitFor({ timeout: 30000 });
  const savedSession = await sessionList.locator('[data-testid="dsh-session-item"][aria-current="page"]').getAttribute('data-session-id');
  assert.ok(savedSession, 'first DSH session should be selected in the sidebar');
  await page.getByTestId('conversation-new-task').click();
  await chat.getByTestId('dsh-empty-state').waitFor();
  await chat.getByTestId('dsh-message-input').fill('DCODE_SECOND_SESSION');
  await chat.getByTestId('dsh-send').click();
  await chat.getByTestId('dcode-messages').getByText('DCODE_SECOND_SESSION_REPLY', { exact: false }).waitFor({ timeout: 30000 });
  const secondSession = await sessionList.locator('[data-testid="dsh-session-item"][aria-current="page"]').getAttribute('data-session-id');
  assert.ok(secondSession && secondSession !== savedSession, 'new task should create one distinct DSH session');
  await sessionList.locator(`[data-session-id="${savedSession}"]`).click();
  await chat.getByTestId('dcode-messages').getByText('DCODE_SHELL_OK', { exact: false }).last().waitFor();
  assert.ok(!(await chat.getByTestId('dcode-messages').innerText()).includes('DCODE_SECOND_SESSION_REPLY'));
  const secondWorkspace = join(data, 'project-two');
  await mkdir(secondWorkspace, { recursive: true });
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    BrowserWindow.getAllWindows()[0].webContents.send('zcode:open-workspace');
  }, secondWorkspace);
  await waitForWorkspace(chat, secondWorkspace);
  await chat.getByTestId('dsh-empty-state').waitFor();
  assert.equal(await sessionList.getByTestId('dsh-session-item').count(), 0, 'other project must not show first project sessions');
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    BrowserWindow.getAllWindows()[0].webContents.send('zcode:open-workspace');
  }, workspace);
  await waitForWorkspace(chat, workspace);
  await chat.getByTestId('dcode-messages').getByText('DCODE_SHELL_OK', { exact: false }).last().waitFor();
  assert.equal(await sessionList.locator('[data-testid="dsh-session-item"][aria-current="page"]').getAttribute('data-session-id'), savedSession);
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: /^(Model settings|模型设置)$/ }).click();
  await page.getByText(/^(Runtime diagnostics|运行时诊断)$/).click();
  await page.getByRole('button', { name: /^(Restart Runtime|重启运行时)$/ }).click();
  await page.getByText(/^(Runtime restarted\.|运行时已重启。)$/).waitFor({ timeout: 120000 });
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('dsh-model-settings').waitFor({ state: 'hidden' });
  assert.ok((await chat.getByTestId('dcode-messages').innerText()).includes('DCODE_SHELL_OK'));
  await chat.getByTestId('dsh-message-input').fill('DCODE_CANCEL_TEST');
  await chat.getByTestId('dsh-send').click();
  await chat.getByTestId('dcode-messages').getByText('Waiting 0.', { exact: false }).waitFor({ timeout: 30000 });
  await chat.getByTestId('dsh-stop').click();
  await chat.getByTestId('dsh-send').waitFor({ timeout: 30000 });
  await chat.getByTestId('dsh-message-input').fill('Continue after the stopped response and confirm the result.');
  await chat.getByTestId('dsh-send').click();
  const continuationDeadline = Date.now() + 30000;
  while (await chat.getByTestId('dcode-messages').getByText('DCode streaming complete.', { exact: true }).count() < 2 || await chat.getByTestId('dsh-stop').isVisible()) {
    if (Date.now() > continuationDeadline) throw new Error('Could not continue conversation after Stop');
    await page.waitForTimeout(100);
  }
  console.log('[smoke] Session history, runtime restart and Stop verified');
  await app.close();
  app = await _electron.launch(launchOptions);
  app.process().stderr.on('data', chunk => errors.push(chunk.toString()));
  page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  chat = page.locator('[data-testid="dcode-chat"]:visible');
  await chat.waitFor({ timeout: 180000 });
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    BrowserWindow.getAllWindows()[0].webContents.send('zcode:open-workspace');
  }, workspace);
  await waitForWorkspace(chat, workspace);
  await chat.getByTestId('dcode-messages').getByText('DCODE_SHELL_OK', { exact: false }).last().waitFor({ timeout: 30000 });
  assert.equal(await page.getByTestId('dsh-session-list').locator('[data-testid="dsh-session-item"][aria-current="page"]').getAttribute('data-session-id'), savedSession);
  assert.ok(!(await chat.getByTestId('dcode-messages').innerText()).includes('DCODE_SECOND_SESSION_REPLY'));
  await chat.getByTestId('dsh-view-changes').click();
  await page.getByText('output.txt', { exact: true }).last().waitFor({ timeout: 30000 });
  await page.getByText('output.txt', { exact: true }).last().click();
  await page.waitForTimeout(2000);
  await capture(page, '03-diff.png');
  await page.locator('[data-testid="terminal-toggle"]:visible').click();
  const terminalInput = page.locator('.xterm-helper-textarea:visible').last();
  await terminalInput.waitFor({ timeout: 30000 });
  await terminalInput.focus();
  const terminalMarker = `DCODE_TERMINAL_OK_${Date.now()}`;
  await page.keyboard.insertText(`echo ${terminalMarker} > dcode-terminal-smoke.txt`);
  await page.keyboard.press('Enter');
  const terminalDeadline = Date.now() + 30000;
  while (!(await readFile(join(workspace, 'dcode-terminal-smoke.txt'), 'utf8').catch(() => '')).replaceAll('\0', '').includes(terminalMarker)) {
    if (Date.now() > terminalDeadline) throw new Error('Native workspace terminal did not execute the verification command');
    await page.waitForTimeout(100);
  }
  await capture(page, '04-terminal.png');
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: /^(General|常规)$/ }).click();
  await page.getByRole('switch', { name: /^(Automatically download and install updates|自动下载并安装更新)$/ }).waitFor();
  const skillsSettings = page.getByRole('button', { name: /^(Skills|技能)$/ });
  const commandsSettings = page.getByRole('button', { name: /^(Commands|命令)$/ });
  await skillsSettings.click();
  await page.getByTestId('plugin-settings-scope-trigger').waitFor();
  await page.locator('[data-independent-capability-count="true"]').getByText(/^(Skills|技能)$/).waitFor();
  assert.equal(await page.getByText(/此页设置尚未接入|These settings are not connected/).count(), 0);
  await commandsSettings.click();
  await page.getByTestId('plugin-settings-scope-trigger').waitFor();
  await page.locator('[data-independent-capability-count="true"]').getByText(/^(Commands|命令)$/).waitFor();
  assert.equal(await page.getByText(/此页设置尚未接入|These settings are not connected/).count(), 0);
  await page.getByRole('button', { name: /^(Subagents|子智能体)$/ }).click();
  const subagentsSettings = page.getByTestId('dsh-subagent-settings');
  assert.equal(await page.getByText(/此页设置尚未接入|These settings are not connected/).count(), 0);
  const delegationDepth = subagentsSettings.getByRole('combobox', { name: /^(Maximum delegation depth|最大委派层级)$/ });
  await delegationDepth.click();
  await page.getByRole('option', { name: /^(Off|关闭)$/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="dsh-subagent-settings"] [role="combobox"]')?.textContent?.includes('关闭') || document.querySelector('[data-testid="dsh-subagent-settings"] [role="combobox"]')?.textContent?.includes('Off'));
  await delegationDepth.click();
  await page.getByRole('option', { name: /^(1 level \(direct children\)|1 层（直接子智能体）)$/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="dsh-subagent-settings"] [role="combobox"]')?.textContent?.includes('直接子智能体') || document.querySelector('[data-testid="dsh-subagent-settings"] [role="combobox"]')?.textContent?.includes('direct children'));
  await capture(page, '05-dsh-subagent-settings.png');
  await page.getByRole('button', { name: /^(Cloud backup|云备份)$/ }).click();
  await page.getByRole('button', { name: /^(Sign in with browser|浏览器登录)$/ }).waitFor();
  assert.equal(await page.getByRole('switch').isChecked(), false);
  await capture(page, '05-cloud-backup-settings.png');
  // “导入 ZCode 会话”需要保留来源名称；这里检查旧产品的外部入口没有回流。
  assert.doesNotMatch(await page.locator('body').innerText(), /zcode\.z\.ai|zcode\.zhipuai\.cn/i);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="workspace-help-menu-trigger"]:visible').last().click();
  const menuText = await page.getByRole('menu').innerText();
  assert.doesNotMatch(menuText, /feedback|community|update|反馈|社区|更新/i);
  await capture(page, '06-help-menu.png');
  const nativeLabels = await app.evaluate(({ Menu }) => {
    const flatten = items => items.flatMap(item => [item.label, ...(item.submenu ? flatten(item.submenu.items) : [])]);
    return flatten(Menu.getApplicationMenu()?.items ?? []).join('\n');
  });
  assert.doesNotMatch(nativeLabels, /zcode|feedback|community|what.s new|反馈|社区|更新日志/i);
  // 开发态不注册发布更新菜单；打包态才验证 GitHub 更新入口。
  if (process.env.DCODE_TEST_EXECUTABLE) assert.match(nativeLabels, /check for updates|检查更新/i);
  const aboutWindowPromise = app.waitForEvent('window');
  await page.getByRole('menuitem', { name: /About|关于/ }).click();
  const about = await aboutWindowPromise;
  await about.waitForLoadState();
  assert.match(await about.locator('body').innerText(), /Dcode/);
  assert.doesNotMatch(await about.locator('body').innerText(), /ZCode/);
  assert.match(await about.locator('img').getAttribute('src'), /^data:image\/png;base64,/);
  await capture(about, '06-about-brand.png');
  await about.getByRole('button').click();
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, resourcesPath: process.resourcesPath }));
  assert.deepEqual(explorerMenus(), originalMenus, 'Desktop startup must not modify Explorer registration');
  if (process.env.DCODE_TEST_EXECUTABLE) {
    assert.equal(identity.packaged, true);
    const profile = JSON.parse(await readFile(join(data, 'dsh/profiles/dcode/package.json'), 'utf8'));
    assert.ok(Object.values(profile.dependencies).every(value => value.includes('/resources/dsh-runtime/')));
    assert.equal(spawnSync(join(identity.resourcesPath, 'dsh-runtime/node.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), 'v24.14.0');
  }
  assert.ok(!errors.join('\n').includes('zcode-agent.subscribeSessionsIndexV4 FAIL'),
    'Local DSH workspaces must not subscribe to the unavailable legacy agent index');
  await writeFile(join(data, 'result.json'), JSON.stringify({ passed: true, desktop: true, fixtureModel: true,
    aclRepair: aclRepairScenario,
    toolOutputVisible: true, fileEdited: true, historyRestored: true, projectSwitchIsolated: true, appRestartRestored: true, runtimeRestart: true, cancellation: true, continuation: true,
    explorerMenuUnchanged: true, providerSettingsUI: true, cloudBackupSettingsUI: true, customCommandBridge: true, brandingUI: true, upstreamEntrypointsRemoved: true, nativeTerminal: true, packaged: identity.packaged, diffOpened: true, title: await page.title() }, null, 2));
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
  await writeFile(join(data, 'fixture-requests.json'), JSON.stringify(requests, null, 2));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
