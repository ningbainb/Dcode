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
const output = join(workspace, ".data/dsh-zcode-import-ui", randomUUID());
const harness = join(repo, ".cache/dsh-zcode-import-ui");
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
import { DcodeOnboarding } from '@/dsh/DcodeOnboarding';
import { ZcodeSessionImportSection } from '@/dsh/ZcodeSessionImportSection';
import { DshChatPanel } from '@/dsh/DshChatPanel';
import { DshSessionList } from '@/dsh/DshSessionList';
import { ServiceProvider } from '@/hooks/useServices';
import { PlatformProvider } from '@/hooks/usePlatform';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
let imported=false;
const calls:string[]=[];
(window as any).__importCalls=calls;
const path='E:/dcode/project';
const candidate={sourceId:'old-1',title:'Previous design discussion',workspacePath:path,updatedAt:Date.now(),messageCount:2};
const archive={id:'zcode-import:old-1',title:candidate.title,workspacePath:path,updatedAt:Date.now(),continuation:{omittedMessages:2,degradedAttachments:1},transcript:[
  {id:'m1',role:'user',createdAt:1,text:'Please keep the old layout',tools:[]},
  {id:'m2',role:'assistant',createdAt:2,text:'I can retain the layout.',tools:[{id:'t1',name:'Bash',status:'completed',title:'Check project',input:'pwd',output:'/project'}]}
]};
const dshService={
  onEvent:()=>({dispose(){}}),start:async()=>({state:'ready',generation:1}),health:async()=>({state:'ready',generation:1}),
  listModels:async()=>[],listSessions:async()=>imported?[{id:archive.id,title:archive.title,workspacePath:path,source:'zcode'}]:[],
  listZcodeImportCandidates:async()=>[{...candidate,imported}],
  importZcodeSessions:async(ids:string[])=>{calls.push('import:'+ids.join(','));imported=true;return ids.map(sourceId=>({sourceId,status:'imported'}))},
  readImportedZcodeSession:async()=>archive,
  continueImportedZcodeSession:async()=>{calls.push('continue');return {id:'native-1',title:'New Session',workspacePath:path}},
};
function Harness(){
  const [view,setView]=React.useState('chat');const [selected,setSelected]=React.useState<string|null>(null);
  const [revision,setRevision]=React.useState(0);
  React.useEffect(()=>{const fn=()=>setRevision(x=>x+1);window.addEventListener('dcode:zcode-sessions-imported',fn);return()=>window.removeEventListener('dcode:zcode-sessions-imported',fn)},[]);
  const sessions=revision&&imported?[{id:archive.id,title:archive.title,workspacePath:path,source:'zcode'}]:[];
  return <DcodeOnboarding><div className="flex h-screen flex-col bg-background text-foreground">
    <nav className="flex gap-2 border-b border-border p-2"><button onClick={()=>setView('chat')}>会话</button><button onClick={()=>setView('settings')}>设置</button></nav>
    {view==='settings'?<div className="mx-auto w-full max-w-3xl p-6"><ZcodeSessionImportSection/></div>:<div className="flex min-h-0 flex-1">
      <aside className="w-60 border-r border-border"><DshSessionList sessions={sessions as any} selectedId={selected} loading={false} error={null} onSelect={setSelected}/></aside>
      <div className="min-w-0 flex-1">{selected?.startsWith('zcode-import:')&&<DshChatPanel workspacePath={path} selectedSessionId={selected} onSessionCreated={id=>{calls.push('selected:'+id);setSelected(null)}} onRefreshSessions={()=>{}} onRefreshGit={()=>{}} onOpenDiff={()=>{}}/>}</div>
    </div>}
  </div></DcodeOnboarding>;
}
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><PlatformProvider platform={{} as any}><ServiceProvider services={{dshService} as any}><TooltipProvider><Harness/></TooltipProvider></ServiceProvider></PlatformProvider></ZCodeIntlProvider>);
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
  `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(output, "electron"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1100,height:850});w.loadURL(${JSON.stringify(server.resolvedUrls.local[0])});});`,
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
  page.on("pageerror", (error) => console.error("[zcode-import-ui]", error.message));
  await page.getByTestId("zcode-import-onboarding").waitFor({ timeout: 120000 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "导入所选会话" }).click();
  await page.getByTestId("zcode-import-onboarding").waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.__importCalls), ["import:old-1"]);
  await page.getByTestId("dsh-session-item").click();
  await page.getByText("Please keep the old layout").waitFor();
  assert.equal(await page.getByTestId("zcode-imported-chat").count(), 1);
  await page.getByText(/上下文预算省略 2 条消息/).waitFor();
  await page.getByText("Bash · Check project · completed").click();
  await page.getByText("/project").waitFor();
  await page.getByRole("button", { name: "在 DCode 中继续" }).click();
  await page.waitForFunction(() => window.__importCalls.includes("continue"));
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByTestId("zcode-session-import").waitFor();
  assert.equal(await page.getByText("已导入", { exact: true }).count(), 1);
  console.log("ZCode import onboarding, archive reader, continue and settings smoke: OK");
} finally {
  await app?.close();
  await server.close();
}
