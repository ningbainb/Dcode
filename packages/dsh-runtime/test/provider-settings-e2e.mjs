import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DshBackend } from "../src/index.mjs";

const root = resolve(import.meta.dirname, "../../../../.data");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(join(root, "dcode-provider-e2e-"));
const backend = new DshBackend({ dataDir, executable: process.execPath });
try {
  await backend.start();
  const original = await backend.listProviderSettings();
  assert.ok(original.providers.some((provider) => provider.id === "deepseek-official"));
  assert.ok(!original.providers.some((provider) => provider.id.includes("zcode")));
  await backend.saveProvider(
    {
      id: "local-gateway",
      name: "Local Gateway",
      api: "openai-completions",
      baseURL: "http://127.0.0.1:4321/v1",
      apiKey: "synthetic-test-key",
      models: [
        {
          id: "first",
          name: "First",
          contextWindow: 32000,
          maxTokens: 4096,
          input: ["text", "image"],
          reasoningEfforts: { off: null, low: "low", high: "high" },
        },
        { id: "second", name: "Second", contextWindow: 64000, maxTokens: 8192 },
      ],
    },
    original.revision,
  );
  const created = await backend.listProviderSettings();
  assert.equal(
    created.providers.find((provider) => provider.id === "local-gateway")?.models.length,
    2,
  );
  assert.equal(
    created.providers.find((provider) => provider.id === "local-gateway")?.hasApiKey,
    true,
  );
  assert.deepEqual(
    created.providers.find((provider) => provider.id === "local-gateway")?.models[0]?.input,
    ["text", "image"],
  );
  assert.deepEqual(
    created.providers.find((provider) => provider.id === "local-gateway")?.models[0]
      ?.reasoningEfforts,
    { off: null, low: "low", high: "high" },
  );
  assert.ok(!JSON.stringify(created).includes("synthetic-test-key"));
  assert.ok(
    (await backend.listModels()).some(
      (model) => model.provider === "local-gateway" && model.model === "second",
    ),
  );
  await assert.rejects(backend.deleteProvider("local-gateway", original.revision), /changed/);
  await backend.saveProvider(
    {
      id: "local-gateway",
      name: "Renamed Gateway",
      api: "openai-completions",
      baseURL: "http://127.0.0.1:4321/v1",
      apiKey: "",
      models: [{ id: "second", name: "Second", contextWindow: 64000, maxTokens: 8192 }],
    },
    created.revision,
  );
  const edited = await backend.listProviderSettings();
  assert.equal(
    edited.providers.find((provider) => provider.id === "local-gateway")?.name,
    "Renamed Gateway",
  );
  assert.equal(
    edited.providers.find((provider) => provider.id === "local-gateway")?.models.length,
    1,
  );
  await backend.deleteProvider("local-gateway", edited.revision);
  const deleted = await backend.listProviderSettings();
  assert.ok(!deleted.providers.some((provider) => provider.id === "local-gateway"));
  assert.ok(deleted.providers.some((provider) => provider.id === "deepseek-official"));
  for (const [id, api, baseURL] of [
    ["openai", "openai-responses", "https://api.openai.com/v1"],
    ["anthropic", "anthropic-messages", "https://api.anthropic.com"],
  ]) {
    const before = await backend.listProviderSettings();
    await backend.saveProvider(
      {
        id,
        name: id,
        api,
        baseURL,
        apiKey: "",
        models: [{ id: `${id}-test`, name: `${id}-test`, contextWindow: 32000, maxTokens: 4096 }],
      },
      before.revision,
      true,
    );
    assert.ok((await backend.listModels()).some((model) => model.provider === id));
    const saved = await backend.listProviderSettings();
    await assert.rejects(
      backend.saveProvider(
        {
          id,
          name: id,
          api,
          baseURL,
          apiKey: "",
          models: [{ id: `${id}-test`, name: `${id}-test`, contextWindow: 32000, maxTokens: 4096 }],
        },
        saved.revision,
        true,
      ),
      /already exists/,
    );
    await backend.deleteProvider(id, saved.revision);
  }
  console.log("DSH provider CRUD and model catalog: OK");
} finally {
  await backend.stop();
}
