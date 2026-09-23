import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = resolve(process.env.DCODE_TEST_ROOT || resolve(import.meta.dirname, "../../../../.data/dsh-image-prompt-e2e"));
await mkdir(root, { recursive: true });
const { workspace, server } = await createFixture(root, { writeSettings: false });
const backend = new DshBackend({ dataDir: root });
const events = [];
backend.on("event", (event) => events.push(event));

try {
  await backend.start();
  const draft = { id: "dcode-image-fixture", name: "Image Fixture",
    api: "openai-completions", baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "synthetic-local-test-key", models: [{ id: "dcode-fixture", name: "Image Fixture",
      contextWindow: 100000, maxTokens: 4096, input: ["text", "image"] }] };
  for (let attempt = 0; attempt < 5; attempt++) {
    const providers = await backend.listProviderSettings();
    try {
      await backend.saveProvider(draft, providers.revision);
      break;
    } catch (error) {
      if ((error.code !== "settings/conflict" && !String(error).includes("Provider settings changed")) || attempt === 4)
        throw error;
      await delay(1000);
    }
  }
  const model = (await backend.listModels()).find((item) => item.provider === "dcode-image-fixture");
  assert.ok(model);
  const session = await backend.createSession(workspace, model);
  await backend.resumeSession(session.id);
  await assert.rejects(
    () => backend.sendMessage(session.id, "", model, undefined,
      [{ mediaType: "image/png", data: "not base64", name: "bad.png" }]),
    /base64/,
  );
  const png = await readFile(resolve(import.meta.dirname, "../../../docs/assets/dcode-icon.png"));
  await backend.sendMessage(session.id, "Describe this icon.", model, undefined,
    [{ mediaType: "image/png", data: png.toString("base64"), name: "dcode-icon.png" }]);
  const deadline = Date.now() + 60000;
  let attachment;
  while (!attachment) {
    const message = events.find((event) => event.data?.event?.type === "user/message")?.data.event.data;
    attachment = message?.content?.find((part) => part.type === "image")?.attachment;
    if (Date.now() > deadline) throw new Error("DSH did not persist the image prompt.");
    await delay(100);
  }
  assert.equal(attachment.name, "dcode-icon.png");
  const recovered = await backend.readImageAttachment(session.id, attachment.attachmentId);
  assert.equal(recovered.attachment.attachmentId, attachment.attachmentId);
  assert.deepEqual(Buffer.from(recovered.data, "base64").subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  console.log(`PASS: DSH stored and read image attachment ${attachment.attachmentId}`);
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
