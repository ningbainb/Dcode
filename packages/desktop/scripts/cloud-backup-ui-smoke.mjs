import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { _electron } from "playwright-core";

const repo = resolve(import.meta.dirname, "../../..");
const workspace = resolve(repo, "../..");
const output = join(workspace, ".data/cloud-backup-ui", randomUUID());
const harness = join(repo, ".cache/cloud-backup-ui");
await mkdir(output, { recursive: true });
await mkdir(harness, { recursive: true });
await mkdir(join(output, "electron"), { recursive: true });
console.log("[backup-ui] Building isolated test host");
const backendFile = join(harness, "backend.mjs");
await build({
  stdin: {
    contents: `export { createCloudBackupService } from './packages/services/src/cloud-backup/cloudBackupService.ts'; export { runGit } from './packages/services/src/cloud-backup/backupProcess.ts';`,
    resolveDir: repo,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: backendFile,
});
const { createCloudBackupService, runGit } = await import(pathToFileURL(backendFile).href);
const project = join(output, "project"),
  remote = join(output, "remote.git");
await mkdir(project);
await writeFile(join(project, "hello.txt"), "original\n");
await writeFile(join(project, ".env"), "LOCAL_ONLY=fixture\n");
await runGit(["init", project]);
await runGit(["-C", project, "add", "."]);
await runGit([
  "-C",
  project,
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "-m",
  "Baseline",
]);
await runGit(["init", "--bare", remote]);
const backend = createCloudBackupService({
  supported: true,
  dataRoot: join(output, "data"),
  schedule: false,
  github: {
    async login() {
      return "fixture";
    },
    async disconnect() {},
    async repositories() {
      return [];
    },
    async ensureRepository() {},
    async upload(_repo, branch, sha, gitDir) {
      await runGit(["--git-dir", gitDir, "push", remote, `${sha}:refs/heads/${branch}`]);
    },
  },
});
const token = randomUUID();
await writeFile(
  join(harness, "index.html"),
  '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  join(harness, "entry.tsx"),
  `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { CloudBackupSection } from '@/settings/CloudBackupSection';
import { ServiceProvider } from '@/hooks/useServices'; import { PlatformProvider } from '@/hooks/usePlatform';
import { ZCodeIntlProvider } from '@/i18n/IntlProvider'; import '@/styles.css';
document.documentElement.className='dark theme-zai-dark';
const service=new Proxy({}, {get:(_,method)=>(...args)=>fetch('/__backup',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Token':${JSON.stringify(token)}},body:JSON.stringify({method,args})}).then(async response=>{const result=await response.json();if(result.error)throw new Error(result.error);return result.value;})});
const platform={selectDirectory:async()=>${JSON.stringify(output)},openExternal:()=>{}};
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><PlatformProvider platform={platform as any}><ServiceProvider services={{cloudBackupService:service} as any}><div className="h-screen overflow-y-auto bg-background text-foreground font-sans"><main className="mx-auto max-w-4xl p-8"><h1 className="mb-6 text-ui-xl font-semibold">云备份</h1><CloudBackupSection workspacePath={${JSON.stringify(project)}}/></main></div></ServiceProvider></PlatformProvider></ZCodeIntlProvider>);
`,
);
const require = createRequire(import.meta.url);
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
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "backup-test-rpc",
      configureServer(vite) {
        vite.middlewares.use("/__backup", async (request, response) => {
          if (request.method !== "POST" || request.headers["x-test-token"] !== token) {
            response.statusCode = 403;
            response.end();
            return;
          }
          try {
            let text = "";
            for await (const chunk of request) text += chunk;
            const { method, args } = JSON.parse(text);
            if (
              ![
                "status",
                "login",
                "cancelLogin",
                "disconnect",
                "repositories",
                "importRemote",
                "preview",
                "enable",
                "setEnabled",
                "backup",
                "diff",
                "restore",
              ].includes(method)
            )
              throw new Error("Unknown test method");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ value: await backend[method](...args) }));
          } catch (error) {
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: error.message }));
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } },
});
await server.listen();
console.log("[backup-ui] Preview server ready");
const main = join(harness, "main.cjs");
await writeFile(
  main,
  `const {app,BrowserWindow}=require(${JSON.stringify(require.resolve("electron"))}); app.setPath('userData',${JSON.stringify(join(output, "electron"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1120,height:1000});w.loadURL(${JSON.stringify(server.resolvedUrls.local[0])});});`,
);
// In Electron main, require('electron') must resolve the built-in module, not its npm launcher.
await writeFile(
  main,
  (await readFile(main, "utf8")).replace(
    `require(${JSON.stringify(require.resolve("electron"))})`,
    "require('electron')",
  ),
);
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: join(repo, "node_modules/electron/dist/electron.exe"),
    args: [main],
    env,
    timeout: 180000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("[backup-ui] renderer:", error.message));
  console.log("[backup-ui] Window ready");
  await page.getByRole("button", { name: "浏览器登录", exact: true }).waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await page.getByText("GitHub · fixture", { exact: true }).waitFor();
  await page.getByRole("button", { name: "预览备份内容", exact: true }).click();
  await page.getByTestId("cloud-backup-preview").waitFor();
  await page.screenshot({ path: join(output, "01-preview-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "开启并首次备份", exact: true }).click();
  await page.getByText("云端已确认", { exact: false }).waitFor({ timeout: 60000 });
  await writeFile(join(project, "hello.txt"), "changed by fixture\n");
  await page.getByRole("button", { name: "立即备份", exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter((button) => button.textContent === "恢复副本")
        .length === 2,
  );
  await page.getByRole("button", { name: "Diff", exact: true }).first().click();
  await page.getByText("快照变更", { exact: true }).waitFor();
  assert.ok((await page.locator("body").innerText()).includes("+changed by fixture"));
  await page.getByRole("button", { name: "恢复副本", exact: true }).first().click();
  await page.getByText("已恢复至：", { exact: false }).waitFor();
  const restored = (await page.getByText("已恢复至：", { exact: false }).innerText())
    .replace("已恢复至：", "")
    .trim();
  assert.equal(await readFile(join(restored, "hello.txt"), "utf8"), "changed by fixture\n");
  await page.getByRole("switch", { name: "自动云备份", exact: true }).click();
  await page.getByText("已关闭", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "02-snapshots-dark.png"), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.className = "theme-zai-light";
  });
  await page.screenshot({ path: join(output, "03-snapshots-light.png"), fullPage: true });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        realGit: true,
        fixtureGithub: true,
        preview: true,
        upload: true,
        diff: true,
        restore: true,
        pause: true,
        themes: ["light", "dark"],
      },
      null,
      2,
    ),
  );
  console.log(`PASS: cloud backup UI with real Git and a local bare remote. Evidence: ${output}`);
} finally {
  if (app) {
    const page = app.windows()[0];
    if (page)
      await writeFile(
        join(output, "final.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "Window unavailable"),
      );
    await app.close();
  }
  await backend.dispose();
  await server.close();
}
