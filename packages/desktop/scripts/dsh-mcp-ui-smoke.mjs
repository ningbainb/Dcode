import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { _electron } from "playwright-core";

const repo = resolve(import.meta.dirname, "../../..");
const workspace = resolve(repo, "../..");
const output = join(workspace, ".data/dsh-mcp-ui");
const harness = join(repo, ".cache/dsh-mcp-ui");
await mkdir(output, { recursive: true });
await mkdir(harness, { recursive: true });
const require = createRequire(import.meta.url);
await writeFile(
  join(harness, "index.html"),
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  join(harness, "entry.tsx"),
  `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { DshMcpSettings } from '@/dsh/DshMcpSettings';
import { ServiceProvider } from '@/hooks/useServices';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
let revision=0; let servers:any[]=[]; const calls:string[]=[];
(window as any).__mcpCalls=calls;
const dshService={
  listMcpServers:async()=>({revision:String(revision),servers:structuredClone(servers)}),
  updateMcpServers:async(next:any[],expected:string)=>{
    if(expected!==String(revision))throw Error('stale');
    servers=structuredClone(next); revision++;
    calls.push(servers.map((s:any)=>s.serverName+':'+s.transport+':'+s.enabled).join(','));
    return {revision:String(revision),servers:structuredClone(servers)};
  },
};
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><ServiceProvider services={{dshService} as any}><TooltipProvider>
<div className="min-h-screen bg-background p-8 text-foreground"><main className="mx-auto max-w-5xl"><DshMcpSettings/></main></div>
</TooltipProvider></ServiceProvider></ZCodeIntlProvider>);
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
  `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(output, "electron"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1200,height:900});w.loadURL(${JSON.stringify(server.resolvedUrls.local[0])});});`,
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
  page.on("pageerror", (error) => console.error("[dsh-mcp-ui]", error.message));
  await page.getByTestId("dsh-mcp-settings").waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "添加服务器" }).click();
  await page.getByRole("textbox", { name: "服务器名称" }).fill("local_tools");
  await page.getByLabel("启动命令").fill("node");
  await page.getByLabel("命令参数（每行一个）").fill("server.mjs");
  await page
    .getByLabel("环境变量映射（每行 CHILD_NAME=SYSTEM_NAME）")
    .fill("API_TOKEN=LOCAL_TEST_TOKEN");
  await page.getByRole("button", { name: "保存到 DSH" }).click();
  await page.waitForFunction(() => window.__mcpCalls.includes("local_tools:stdio:false"));
  await page.getByRole("switch", { name: "local_tools 已停用" }).click();
  await page.waitForFunction(() => window.__mcpCalls.includes("local_tools:stdio:true"));
  await page.getByRole("button", { name: "添加服务器" }).click();
  await page.getByRole("textbox", { name: "服务器名称" }).fill("local_http");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Streamable HTTP" }).click();
  await page.getByLabel("MCP 地址").fill("http://127.0.0.1:8765/mcp");
  await page.getByLabel("Bearer Token 环境变量名（可选）").fill("LOCAL_TEST_TOKEN");
  await page.getByRole("button", { name: "保存到 DSH" }).click();
  await page.waitForFunction(() =>
    window.__mcpCalls.some((call) => call.includes("local_http:streamable-http:false")),
  );
  assert.equal(await page.getByTestId("dsh-mcp-nav-item").count(), 2);
  assert.equal(await page.getByText("ZCode Agent", { exact: true }).count(), 0);
  await page.screenshot({ path: join(output, "dsh-mcp-settings.png"), fullPage: true });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByRole("button", { name: "删除服务器" }).click();
  await page.waitForFunction(() => window.__mcpCalls.at(-1) === "local_tools:stdio:true");
  console.log(
    `PASS: DSH MCP stdio, HTTP, toggle and delete UI. Screenshot: ${join(output, "dsh-mcp-settings.png")}`,
  );
} finally {
  await app?.close();
  await server.close();
}
