import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { buildZcodeNativeSeed } from "../src/zcode-native-seed.mjs";

const outputBase = resolve(import.meta.dirname, "../../../../../.data");
await mkdir(outputBase, { recursive: true });
const root = await mkdtemp(join(outputBase, "dcode-native-import-"));
const workspace = join(root, "project");
const source = join(root, "zcode.sqlite");
await mkdir(workspace);
const db = new DatabaseSync(source);
db.exec(`create table session(id text, title text, directory text, parent_id text, time_created integer, time_updated integer);
  create table message(id text, session_id text, sequence integer, time_created integer, data text);
  create table part(id text, message_id text, session_id text, sequence integer, time_created integer, data text);`);
db.prepare("insert into session values (?, ?, ?, null, 1, 4)").run(
  "s1",
  "ZCode native task",
  workspace,
);
for (const [index, role, data, parts] of [
  [0, "user", {}, [{ type: "text", text: "Inspect the old plan" }]],
  [
    1,
    "assistant",
    {},
    [
      { type: "text", text: "I read the project" },
      {
        type: "tool",
        tool: "read",
        callID: "source-call-1",
        state: {
          status: "completed",
          input: { file_path: "plan.txt" },
          output: "The plan is green",
        },
      },
    ],
  ],
  [
    2,
    "assistant",
    { summary: { body: "The prior decision was to keep the green plan." } },
    [{ type: "compaction" }],
  ],
]) {
  const messageId = `m${index}`;
  db.prepare("insert into message values (?, 's1', ?, ?, ?)").run(
    messageId,
    index,
    index + 1,
    JSON.stringify({ role, ...data }),
  );
  for (const [partIndex, part] of parts.entries()) {
    db.prepare("insert into part values (?, ?, 's1', ?, ?, ?)").run(
      `p${index}-${partIndex}`,
      messageId,
      partIndex,
      index + 1,
      JSON.stringify(part),
    );
  }
}
db.close();

const requests = [];
const model = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(
    `data: ${JSON.stringify({
      id: "native-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "native-test",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "Native history received." },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id: "native-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "native-test",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const backend = new DshBackend({ dataDir: join(root, "dcode"), zcodeDbPath: source });
const events = [];
backend.on("event", (event) => events.push(event));
let passed = false;
try {
  const imported = await backend.importZcodeSessions(["s1"]);
  assert.equal(imported[0].status, "imported");
  const archive = (await backend.listSessions(workspace)).find(
    (session) => session.source === "zcode",
  );
  assert.ok(archive);
  const seed = buildZcodeNativeSeed(await backend.zcodeImport.readArchive(archive.id));
  const unauthorized = await fetch(
    new URL("/api/dcode/zcode-session-import", backend.lifecycle.origin),
    {
      method: "POST",
      headers: { cookie: backend.lifecycle.cookie, "content-type": "application/json" },
      body: JSON.stringify({ cwd: workspace, events: seed.events }),
      redirect: "manual",
    },
  );
  assert.equal(unauthorized.status, 403, "a DSH cookie alone must not authorize native imports");
  const native = await backend.continueImportedZcodeSession(archive.id, workspace);
  assert.ok(native.id.startsWith("dcode-zcode-"));
  assert.equal(requests.length, 0, "native creation must not call a model");
  let snapshot = await backend.resumeSession(native.id);
  assert.match(JSON.stringify(snapshot), /The plan is green/);
  assert.match(JSON.stringify(snapshot), /prior decision was to keep the green plan/);
  await backend.restart();
  snapshot = await backend.resumeSession(native.id);
  assert.match(JSON.stringify(snapshot), /The plan is green/);
  assert.ok((await backend.listSessions(workspace)).some((session) => session.id === native.id));
  await backend.configureProvider({
    provider: "native-test",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${model.address().port}/v1`,
    model: "native-test",
    apiKey: "local-fixture-key",
  });
  await backend.sendMessage(native.id, "What did we decide?", {
    provider: "native-test",
    model: "native-test",
  });
  const deadline = Date.now() + 60_000;
  while (
    !events.some((event) => event.sessionId === native.id && event.data?.event?.type === "turn/end")
  ) {
    if (Date.now() > deadline) throw new Error("Imported session did not finish the next turn.");
    await delay(100);
  }
  assert.equal(requests.length, 1);
  const sent = JSON.stringify(requests[0].messages);
  assert.match(sent, /Inspect the old plan/);
  assert.match(sent, /source-call-1/);
  assert.match(sent, /The plan is green/);
  assert.match(sent, /prior decision was to keep the green plan/);
  passed = true;
  console.log("Native ZCode import, restart and next-model-request: OK");
} catch (error) {
  console.error("Native import test data:", root);
  console.error(
    await readFile(join(root, "dcode", "logs", "dsh-runtime.log"), "utf8").catch(
      () => "No DSH log",
    ),
  );
  throw error;
} finally {
  await backend.stop();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
  if (passed && !relative(outputBase, root).startsWith(".."))
    await rm(root, { recursive: true, force: true });
}
