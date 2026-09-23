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
const output = join(workspace, ".data/dsh-conversation-ui", randomUUID());
const harness = join(repo, ".cache/dsh-conversation-ui");
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
import { DshChatPanel } from '@/dsh/DshChatPanel';
import { DshChatFontSettings } from '@/dsh/DshChatFontSettings';
import { DshSessionList } from '@/dsh/DshSessionList';
import { ServiceProvider } from '@/hooks/useServices';
import { PlatformProvider } from '@/hooks/usePlatform';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
const records=[
 {type:'event',event:{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Please review the current design.'}]}}},
 {type:'event',event:{seq:2,type:'assistant/message',data:{message:{content:[{type:'text',text:'Use the existing API and keep the interface simple.'}]}}}}
];
let annotations=JSON.parse(localStorage.getItem('dcode-test-annotations')||'[]');
let settings=JSON.parse(localStorage.getItem('dcode-test-settings')||'{"dcodeChatFontSize":null,"dcodeChatFontFamily":"default"}');
const calls:string[]=[];
(window as any).__conversationCalls=calls;
let commandEnabled=true;
(window as any).__setCommandEnabled=(value:boolean)=>{commandEnabled=value};
let releaseQueued:(()=>void)|null=null;
(window as any).__releaseQueued=()=>releaseQueued?.();
let releaseCreate:(()=>void)|null=null;
(window as any).__releaseCreate=()=>releaseCreate?.();
const persist=()=>localStorage.setItem('dcode-test-annotations',JSON.stringify(annotations));
const dshService={
 onEvent:()=>({dispose(){}}), start:async()=>({state:'ready',generation:1}), health:async()=>({state:'ready',generation:1}),
 listModels:async()=>[{provider:'fixture',model:'model',label:'Fixture'}],
 createSession:async()=>{calls.push('create:start');await new Promise<void>((resolve)=>{releaseCreate=resolve});return {id:'session-new',title:'New Session',workspacePath:'E:/dcode/project'}},
 resumeSession:async(id:string)=>({type:'snapshot',records:id==='session-b'?[{type:'event',event:{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'B question'}]}}},{type:'event',event:{seq:2,type:'assistant/message',data:{message:{content:[{type:'text',text:'B answer'}]}}}},{type:'event',event:{seq:3,type:'turn/start',data:{}}}]:records}), listSessionAnnotations:async(id:string)=>id==='session-a'?structuredClone(annotations):[],
 createSessionAnnotation:async(sessionId:string,input:any)=>{const item={...input,id:crypto.randomUUID(),sessionId,number:annotations.length+1,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};annotations.push(item);persist();calls.push('annotate:'+input.messageId);return item},
 updateSessionAnnotation:async(_sessionId:string,id:string,patch:any)=>{const item=annotations.find((entry:any)=>entry.id===id);Object.assign(item,patch);persist();calls.push('update');return item},
 deleteSessionAnnotation:async(_sessionId:string,id:string)=>{annotations=annotations.filter((entry:any)=>entry.id!==id);persist();calls.push('delete');return true},
 cancel:async(id:string)=>{calls.push('cancel:'+id)},
 sendMessage:async(id:string,text:string,_model:any,ids?:string[])=>{calls.push('send:'+id+':'+text+':'+String(ids));if(id==='session-b')await new Promise<void>((resolve)=>{releaseQueued=resolve});else{annotations=annotations.map((item:any)=>({...item,status:'sent'}));persist()}},
};
const settingService={get:async()=>({...settings,recentProjects:[],locale:'zh-CN'}),update:async(patch:any)=>{settings={...settings,...patch};localStorage.setItem('dcode-test-settings',JSON.stringify(settings));calls.push('font:'+String(settings.dcodeChatFontSize))}};
const commandsService={list:async({workspacePath}:any)=>{calls.push('commands:'+workspacePath);return {commands:[{name:'/review',prompt:'Review $1 and $ARGUMENTS',enabled:commandEnabled,source:'user',scope:'project'}]}}};
const services={dshService,settingService,commandsService,broadcastService:{send:async()=>{}}} as any;
function Harness(){const [view,setView]=React.useState('chat');const [session,setSession]=React.useState<string|null>('session-a');return <div className="flex h-screen flex-col bg-background text-foreground"><nav className="flex gap-2 border-b border-border p-2"><button onClick={()=>setView('chat')}>会话</button><button onClick={()=>setView('settings')}>外观</button><button onClick={()=>setSession(null)}>新建</button></nav>{view==='chat'?<div className="flex min-h-0 flex-1"><aside className="w-44 border-r border-border"><DshSessionList sessions={[{id:'session-a',title:'Alpha task'},{id:'session-b',title:'Beta task'}] as any} selectedId={session} loading={false} error={null} onSelect={setSession}/></aside><div className="min-w-0 flex-1"><DshChatPanel workspacePath="E:/dcode/project" selectedSessionId={session} onSessionCreated={setSession} onRefreshSessions={()=>{}} onRefreshGit={()=>{}} onOpenDiff={()=>{}}/></div></div>:<div className="mx-auto w-full max-w-4xl p-6"><DshChatFontSettings/></div>}</div>}
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><PlatformProvider platform={{} as any}><ServiceProvider services={services}><TooltipProvider><Harness/></TooltipProvider></ServiceProvider></PlatformProvider></ZCodeIntlProvider>);
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
  page.on("pageerror", (error) => console.error("[conversation-ui] renderer:", error.message));
  const assistant = page.locator('[data-testid="dsh-annotated-event:2"] p').first();
  await assistant.waitFor({ timeout: 120000 });
  assert.equal(await page.getByTestId("dsh-copy-event:2").count(), 1);
  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="dsh-annotated-event:2"] p');
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "添加批注" }).click();
  await page.getByRole("textbox", { name: "批注意见" }).fill("复用当前接口。");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.waitForFunction(() => window.__conversationCalls.includes("annotate:event:2"));
  assert.match(await page.getByTestId("dsh-attached-annotations").textContent(), /已附加 1 条批注/);
  await page.getByRole("button", { name: /批注 1:/ }).click();
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("textbox", { name: "编辑批注" }).fill("优先复用当前接口。");
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("button", { name: "×" }).click();
  const composerFont = await page
    .getByTestId("dsh-message-input")
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("combobox", { name: "消息字号" }).click();
  await page.getByRole("option", { name: "15 px" }).click();
  await page.waitForFunction(() => window.__conversationCalls.includes("font:15"));
  await page.getByRole("button", { name: "会话", exact: true }).click();
  assert.equal(
    await page
      .locator('[data-testid="dsh-annotated-event:2"] .dsh-chat-copy')
      .evaluate((el) => getComputedStyle(el).fontSize),
    "15px",
  );
  assert.equal(
    await page.getByTestId("dsh-message-input").evaluate((el) => getComputedStyle(el).fontSize),
    composerFont,
  );
  await page.getByTestId("dsh-message-input").fill("按照我的批注修改");
  await page.getByTestId("dsh-send").click();
  await page.waitForFunction(() =>
    window.__conversationCalls.some((value) => value.startsWith("send:session-a:按照我的批注修改")),
  );
  await page.getByTestId("dsh-message-input").fill('/review "src/my file.ts" carefully');
  await page.getByTestId("dsh-send").click();
  await page.waitForFunction(() =>
    window.__conversationCalls.some(
      (value) =>
        value.includes("send:session-a:Run custom command /review.") &&
        value.includes('Review src/my file.ts and "src/my file.ts" carefully'),
    ),
  );
  await page.evaluate(() => window.__setCommandEnabled(false));
  await page.getByTestId("dsh-message-input").fill("/review blocked");
  await page.getByTestId("dsh-send").click();
  await page.getByText("Custom command /review is disabled.").waitFor();
  assert.equal(await page.getByTestId("dsh-message-input").inputValue(), "/review blocked");
  assert.equal(
    await page.evaluate(() =>
      window.__conversationCalls.some(
        (value) =>
          value.includes("send:session-a:Run custom command /review.") && value.includes("blocked"),
      ),
    ),
    false,
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await assistant.waitFor({ timeout: 120000 });
  assert.equal(
    await page
      .locator('[data-testid="dsh-annotated-event:2"] .dsh-chat-copy')
      .evaluate((el) => getComputedStyle(el).fontSize),
    "15px",
  );
  assert.equal(await page.getByRole("button", { name: /批注 1:/ }).count(), 1);
  assert.equal((await page.getByRole("button", { name: /批注 1:/ }).textContent()).trim(), "1");
  assert.equal(await page.evaluate(() => CSS.highlights.has("dcode-session-annotation")), true);
  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="dsh-annotated-event:1"] p');
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "添加批注" }).click();
  await page.getByRole("textbox", { name: "批注意见" }).fill("保留原有交互。");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /批注 2:/ }).count(), 1);
  assert.match(await page.getByTestId("dsh-attached-annotations").textContent(), /已附加 1 条批注/);
  await page.getByRole("button", { name: /批注 2:/ }).click();
  await page.getByRole("button", { name: "删除" }).click();
  assert.equal(await page.getByRole("button", { name: /批注 2:/ }).count(), 0);
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("button", { name: "恢复默认" }).click();
  await page.waitForFunction(() => window.__conversationCalls.includes("font:null"));
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="消息字号"]')?.textContent?.includes("跟随默认"),
  );
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: /批注 1:/ }).click();
  assert.equal(await page.getByRole("dialog", { name: "批注 1" }).count(), 1);
  await page.getByRole("button", { name: "Beta task" }).click();
  await page.getByRole("button", { name: "Alpha task" }).click();
  assert.equal(await page.getByRole("dialog", { name: "批注 1" }).count(), 0);
  await page.getByRole("searchbox", { name: "搜索会话" }).fill("beta");
  assert.equal(await page.getByTestId("dsh-session-item").count(), 1);
  assert.match(await page.getByTestId("dsh-session-item").textContent(), /Beta task/);
  await page.getByRole("searchbox", { name: "搜索会话" }).fill("");
  assert.equal(await page.getByTestId("dsh-session-item").count(), 2);
  await page.getByTestId("dsh-message-input").fill("A 的未发送草稿");
  await page.getByRole("button", { name: "Beta task" }).click();
  await page.getByTestId("dsh-stop").waitFor();
  assert.equal(await page.getByTestId("dsh-message-input").inputValue(), "");
  await page.getByTestId("dsh-message-input").fill("B 的后续消息");
  await page.getByTestId("dsh-message-input").press("Escape");
  await page.waitForFunction(() => window.__conversationCalls.includes("cancel:session-b"));
  assert.match(await page.getByTestId("dsh-send").textContent(), /排队发送/);
  await page.getByTestId("dsh-send").click();
  await page.waitForFunction(() =>
    window.__conversationCalls.some((value) => value.startsWith("send:session-b:B 的后续消息")),
  );
  await page.getByRole("button", { name: "Alpha task" }).click();
  assert.equal(await page.getByTestId("dsh-message-input").inputValue(), "A 的未发送草稿");
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByTestId("dsh-message-input").fill("新会话首条消息");
  await page.getByTestId("dsh-send").click();
  await page.waitForFunction(() => window.__conversationCalls.includes("create:start"));
  await page.getByRole("button", { name: "Alpha task" }).click();
  await page.evaluate(() => window.__releaseCreate());
  await page.waitForFunction(() =>
    window.__conversationCalls.some((value) => value.startsWith("send:session-new:新会话首条消息")),
  );
  assert.equal(
    await page.getByRole("button", { name: "Alpha task" }).getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.getByTestId("dsh-message-input").inputValue(), "A 的未发送草稿");
  await page.evaluate(() => window.__releaseQueued());
  await page.getByRole("button", { name: "Beta task" }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="dsh-message-input"]')?.value === "",
  );
  await page.getByRole("button", { name: "Alpha task" }).click();
  assert.equal(await page.getByTestId("dsh-message-input").inputValue(), "A 的未发送草稿");
  await page.screenshot({ path: join(output, "dsh-conversation.png"), fullPage: true });
  console.log(
    `PASS: annotations, font persistence, custom commands, session search, scoped drafts, busy follow-up and cancel. Screenshot: ${join(output, "dsh-conversation.png")}`,
  );
} finally {
  await app?.close();
  await server.close();
}
