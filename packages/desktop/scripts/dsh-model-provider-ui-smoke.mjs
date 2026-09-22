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
const output = join(workspace, ".data/dsh-model-provider-ui", randomUUID());
const harness = join(repo, ".cache/dsh-model-provider-ui");
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
import { DshSettings } from '@/dsh/DshSettings';
import { ServiceProvider } from '@/hooks/useServices';
import { PlatformProvider } from '@/hooks/usePlatform';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
let revision=0;
let providers=[{id:'deepseek-official',name:'DeepSeek',api:'native',baseURL:'',models:[{id:'deepseek-flash',name:'DeepSeek Flash',contextWindow:1000000,maxTokens:256000}],hasApiKey:false,builtIn:true}];
const calls:string[]=[];(window as any).__providerCalls=calls;
const dshService={
  listProviderSettings:async()=>({revision,writable:true,providers:structuredClone(providers)}),
  saveProvider:async(draft:any,expected:number,creating:boolean)=>{if(expected!==revision)throw Error('stale');calls.push('save:'+draft.id+':'+draft.models.map((model:any)=>model.id).join(',')+':'+creating);providers=[...providers.filter(p=>p.id!==draft.id),{...draft,hasApiKey:!!draft.apiKey,builtIn:false}];revision++},
  deleteProvider:async(id:string,expected:number)=>{if(expected!==revision)throw Error('stale');calls.push('delete:'+id);providers=providers.filter(p=>p.id!==id);revision++},
  restart:async()=>({state:'ready',generation:2}),getLogsPath:async()=>'/tmp/dsh.log',
};
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><PlatformProvider platform={{} as any}><ServiceProvider services={{dshService} as any}><TooltipProvider>
<div className="min-h-screen bg-background p-8 text-foreground"><main className="mx-auto max-w-5xl"><DshSettings/></main></div>
</TooltipProvider></ServiceProvider></PlatformProvider></ZCodeIntlProvider>);
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
  page.on("pageerror", (error) => console.error("[dsh-provider-ui]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("[dsh-provider-ui] console:", message.text());
  });
  try {
    await page.getByTestId("dsh-provider-nav-item").waitFor({ timeout: 120000 });
  } catch (error) {
    await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
    console.error("[dsh-provider-ui] title:", await page.title());
    console.error(
      "[dsh-provider-ui] body:",
      (await page.locator("body").innerText()).slice(0, 1500),
    );
    throw error;
  }
  assert.equal(await page.getByTestId("dsh-provider-nav-item").count(), 1);
  assert.equal(await page.getByText("Z.ai", { exact: true }).count(), 0);
  await page.getByText("deepseek-flash", { exact: true }).waitFor();
  await page.getByRole("button", { name: "添加供应商" }).click();
  await page.getByRole("textbox", { name: "搜索供应商" }).fill("openai");
  assert.equal(
    await page
      .getByTestId("dsh-provider-catalog")
      .getByRole("button", { name: "Anthropic" })
      .count(),
    0,
  );
  await page.getByTestId("dsh-provider-catalog").getByRole("button", { name: "OpenAI" }).click();
  await page.getByLabel("模型 ID").fill("first-model");
  await page.getByRole("button", { name: "添加模型" }).click();
  await page.getByLabel("模型 ID").nth(1).fill("second-model");
  await page.getByRole("button", { name: "下移模型 1" }).click();
  await page.getByRole("button", { name: "保存到 DSH" }).click();
  await page.waitForFunction(() =>
    window.__providerCalls.includes("save:openai:second-model,first-model:true"),
  );
  await page.getByTestId("dsh-provider-nav-item").filter({ hasText: "OpenAI" }).waitFor();
  await page.screenshot({ path: join(output, "dsh-model-provider-settings.png"), fullPage: true });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByRole("button", { name: "删除供应商" }).click();
  await page.waitForFunction(() => window.__providerCalls.includes("delete:openai"));
  assert.equal(await page.getByTestId("dsh-provider-nav-item").count(), 1);
  console.log(
    `DSH provider settings add, multi-model, delete UI: OK. Screenshot: ${join(output, "dsh-model-provider-settings.png")}`,
  );
} finally {
  await app?.close();
  await server.close();
}
