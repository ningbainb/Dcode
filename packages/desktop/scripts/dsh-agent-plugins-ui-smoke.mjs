import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { _electron } from "playwright-core";

const repo = resolve(import.meta.dirname, "../../..");
const workspace = resolve(repo, "../..");
const output = join(workspace, ".data/dsh-agent-plugins-ui", randomUUID());
const harness = join(repo, ".cache/dsh-agent-plugins-ui");
await mkdir(output, { recursive: true });
await mkdir(harness, { recursive: true });
const require = createRequire(import.meta.url);
await writeFile(
  join(harness, "index.html"),
  '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  join(harness, "entry.tsx"),
  `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { DshAgentPluginsSection } from '@/dsh/DshAgentPluginsSection';
import { ServiceProvider } from '@/hooks/useServices';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider';
import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
const calls: string[]=[];
let status={browser:{enabled:false,available:true},windowsGui:{enabled:false,available:false,supported:true}};
const dshService={
  getAgentPlugins:async()=>structuredClone(status),
  setAgentPluginEnabled:async(id:'browser'|'windowsGui',enabled:boolean)=>{calls.push(id+':'+enabled);status={...status,[id]:{...status[id],enabled}};return structuredClone(status)},
  installWindowsGuiPlugin:async()=>{calls.push('install');status={...status,windowsGui:{...status.windowsGui,available:true}};return structuredClone(status)}
};
(window as any).__pluginCalls=calls;
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><ServiceProvider services={{dshService} as any}>
<div className="min-h-screen bg-background p-8 text-foreground"><main className="mx-auto max-w-4xl"><h1 className="mb-6 text-ui-xl font-semibold">插件</h1><DshAgentPluginsSection isWindowsDesktop={true}/></main></div>
</ServiceProvider></ZCodeIntlProvider>);
`,
);
const server = await createServer({
  configFile: false,
  root: harness,
  cacheDir: join(harness, "vite-cache"),
  resolve: {
    alias: {
      "@": join(repo, "packages/ui/src"),
      react: resolve(require.resolve("react/package.json"), ".."),
      "react-dom": resolve(require.resolve("react-dom/package.json"), ".."),
    },
  },
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } },
});
await server.listen();
const main = join(harness, "main.cjs");
await writeFile(
  main,
  `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(output, "electron"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1120,height:850});w.loadURL(${JSON.stringify(server.resolvedUrls.local[0])});});`,
);
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: join(repo, "node_modules/electron/dist/electron.exe"),
    args: [main],
    env,
    timeout: 120000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("[agent-plugin-ui] renderer:", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("[agent-plugin-ui] console:", message.text());
  });
  const browser = page.getByRole("switch", { name: "浏览器控制" });
  const computer = page.getByRole("switch", { name: "电脑控制 · 实验性" });
  try { await browser.waitFor({ timeout: 120000 }); }
  catch (error) { await page.screenshot({ path: join(output, "failure.png") }); throw error; }
  assert.equal(await browser.isChecked(), false);
  assert.equal(await computer.isDisabled(), true);
  await browser.click();
  await page.waitForFunction(() => window.__pluginCalls.includes("browser:true"));
  assert.equal(await browser.isChecked(), true);
  await page.getByRole("button", { name: "安装运行组件" }).click();
  await page.waitForFunction(() => window.__pluginCalls.includes("install"));
  await computer.click();
  await page.waitForFunction(() => window.__pluginCalls.includes("windowsGui:true"));
  assert.equal(await computer.isChecked(), true);
  await page.screenshot({ path: join(output, "dsh-agent-plugins.png"), fullPage: true });
  console.log(
    `PASS: DSH Agent plugin settings toggles and install flow. Screenshot: ${join(output, "dsh-agent-plugins.png")}`,
  );
} finally {
  await app?.close();
  await server.close();
}
