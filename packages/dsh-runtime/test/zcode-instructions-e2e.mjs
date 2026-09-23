import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = resolve(process.env.DCODE_TEST_ROOT || resolve(import.meta.dirname, "../../../../.data/dsh-zcode-instructions-e2e"));
const userHome = join(root, "home");
await mkdir(join(userHome, ".zcode"), { recursive: true });
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = userHome;
process.env.USERPROFILE = userHome;
const instructions = join(userHome, ".zcode", "AGENTS.md");
await writeFile(instructions, "DCODE_ZCODE_GLOBAL_INSTRUCTION_FIRST\n");
const { workspace, server, requests } = await createFixture(root, { writeSettings: false });
const backend = new DshBackend({ dataDir: root });

async function waitForRequest(marker) {
  const deadline = Date.now() + 60000;
  let request;
  while (!(request = requests.find((item) => (item.tools?.length ?? 0) > 0 &&
    JSON.stringify(item).includes(marker)))) {
    if (Date.now() > deadline) throw new Error(`DSH did not request model turn ${marker}.`);
    await delay(100);
  }
  return JSON.stringify(request);
}

try {
  await backend.start();
  const draft = { id: "dcode-instructions-fixture", name: "Instructions Fixture",
    api: "openai-completions", baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "synthetic-local-test-key", models: [{ id: "dcode-fixture", name: "Instructions Fixture",
      contextWindow: 100000, maxTokens: 4096, input: ["text"] }] };
  for (let attempt = 0; attempt < 5; attempt++) {
    const providers = await backend.listProviderSettings();
    try { await backend.saveProvider(draft, providers.revision); break; }
    catch (error) {
      if ((error.code !== "settings/conflict" && !String(error).includes("Provider settings changed")) || attempt === 4)
        throw error;
      await delay(1000);
    }
  }
  const model = (await backend.listModels()).find((item) => item.provider === draft.id);
  assert.ok(model);
  const first = await backend.createSession(workspace, model);
  await backend.sendMessage(first.id, "DCODE_SECOND_SESSION FIRST", model);
  assert.match(await waitForRequest("DCODE_SECOND_SESSION FIRST"), /DCODE_ZCODE_GLOBAL_INSTRUCTION_FIRST/);
  await writeFile(instructions, "DCODE_ZCODE_GLOBAL_INSTRUCTION_REVISED\n");
  await backend.sendMessage(first.id, "DCODE_SECOND_SESSION SECOND", model);
  const next = await waitForRequest("DCODE_SECOND_SESSION SECOND");
  assert.match(next, /DCODE_ZCODE_GLOBAL_INSTRUCTION_REVISED/);
  assert.match(next, /Updated instructions from: \$DSH_HOME\/AGENTS\.md/);
  await unlink(instructions);
  await backend.sendMessage(first.id, "DCODE_SECOND_SESSION THIRD", model);
  const removed = await waitForRequest("DCODE_SECOND_SESSION THIRD");
  assert.match(removed, /Instructions removed: \$DSH_HOME\/AGENTS\.md/);
  console.log("PASS: native DSH model context includes updated ZCode global instructions");
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
}
