import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = resolve(process.env.DCODE_TEST_ROOT || resolve(import.meta.dirname, "../../../../.data/dsh-file-upload-e2e"));
await mkdir(root, { recursive: true });
const { workspace, server, requests } = await createFixture(root, { writeSettings: false, fileReadPrompt: true });
const backend = new DshBackend({ dataDir: root });
const events = [];
backend.on("event", (event) => events.push(event));

try {
  await backend.start();
  const provider = { id: "dcode-file-fixture", name: "File Fixture",
    api: "openai-completions", baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "synthetic-local-test-key", models: [{ id: "dcode-fixture", name: "File Fixture",
      contextWindow: 100000, maxTokens: 4096, input: ["text"] }] };
  for (let attempt = 0; attempt < 5; attempt++) {
    const settings = await backend.listProviderSettings();
    try { await backend.saveProvider(provider, settings.revision); break; }
    catch (error) {
      if ((error.code !== "settings/conflict" && !String(error).includes("Provider settings changed")) || attempt === 4)
        throw error;
      await delay(1000);
    }
  }
  const model = (await backend.listModels()).find((item) => item.provider === provider.id);
  assert.ok(model);
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  const data = Buffer.from("Dcode file-upload receipt fixture\n", "utf8").toString("base64");
  await assert.rejects(() => backend.sendMessage(session.id, "", model, undefined, undefined,
    [{ data: "not base64", name: "bad.txt" }]), /base64/);
  await backend.sendMessage(session.id, "", model, undefined, undefined,
    [{ data, name: "fixture.txt" }]);
  const deadline = Date.now() + 60000;
  let file;
  while (!file) {
    const message = events.find((event) => event.data?.event?.type === "user/message")?.data.event.data;
    file = message?.content?.find((part) => part.type === "file")?.attachment;
    if (Date.now() > deadline) throw new Error("DSH did not commit the uploaded file reference.");
    await delay(100);
  }
  assert.equal(file.name, "fixture.txt");
  assert.equal(file.bytes, Buffer.from(data, "base64").byteLength);
  const modelDeadline = Date.now() + 30000;
  while (requests.length === 0) {
    if (Date.now() > modelDeadline) throw new Error("DSH did not send the file prompt to the model.");
    await delay(100);
  }
  assert.match(JSON.stringify(requests), /fixture\.txt/);
  const toolDeadline = Date.now() + 60000;
  while (!events.some((event) => event.data?.event?.type === "tool/result" &&
    JSON.stringify(event.data.event.data).includes("Dcode file-upload receipt fixture"))) {
    if (Date.now() > toolDeadline) throw new Error("DSH read tool did not return the uploaded file bytes.");
    await delay(100);
  }
  console.log(`PASS: DSH accepted a file-only prompt ${file.attachmentId}`);
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
