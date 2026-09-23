const NAMESPACE = "llm-pi-ai";
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/;
const APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
const MODALITIES = new Set(["text", "image"]);
const REASONING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function namespaceView(description) {
  const view = description.namespaces.find((item) => item.ns === NAMESPACE);
  if (!view) throw new Error("DSH model provider settings are unavailable.");
  return view;
}

function credentialRef(provider, profile) {
  return typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv
    ? profile.apiKeyEnv
    : `DCODE_${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`;
}

export function validateProviderDraft(draft) {
  const id = String(draft?.id ?? "").trim();
  if (!PROVIDER_ID.test(id) || id === "deepseek-official")
    throw new Error("Provider ID must use lowercase letters, digits and hyphens.");
  const name = String(draft.name ?? "").trim();
  if (!name) throw new Error("Enter a provider name.");
  const api = String(draft.api ?? "");
  if (!APIS.has(api)) throw new Error("Unsupported model protocol.");
  let baseURL;
  try {
    const url = new URL(String(draft.baseURL ?? ""));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    baseURL = url.href.replace(/\/$/, "");
  } catch {
    throw new Error("Enter an HTTP(S) model endpoint without embedded credentials.");
  }
  const models = draft.models;
  if (!Array.isArray(models) || models.length === 0) throw new Error("Add at least one model.");
  if (models.length > 100) throw new Error("A provider supports at most 100 models.");
  const ids = new Set();
  const normalized = models.map((model) => {
    const modelId = String(model?.id ?? "").trim();
    if (!modelId || ids.has(modelId)) throw new Error("Model IDs must be unique and nonempty.");
    ids.add(modelId);
    const contextWindow = Number(model.contextWindow);
    const maxTokens = Number(model.maxTokens);
    if (
      !Number.isSafeInteger(contextWindow) ||
      contextWindow < 1024 ||
      !Number.isSafeInteger(maxTokens) ||
      maxTokens < 1 ||
      maxTokens > contextWindow
    )
      throw new Error(`Check the context and output token limits for ${modelId}.`);
    let input;
    if (model.input !== undefined) {
      if (
        !Array.isArray(model.input) ||
        !model.input.includes("text") ||
        new Set(model.input).size !== model.input.length ||
        model.input.some((modality) => !MODALITIES.has(modality))
      )
        throw new Error(`Check the input modalities for ${modelId}.`);
      input = model.input;
    }
    let reasoningEfforts;
    if (model.reasoningEfforts !== undefined) {
      if (model.reasoningEfforts === false) reasoningEfforts = false;
      else {
        const efforts = object(model.reasoningEfforts);
        if (
          Object.keys(efforts).length === 0 ||
          !Object.keys(efforts).some((level) => level !== "off") ||
          Object.entries(efforts).some(
            ([level, wire]) =>
              !REASONING_LEVELS.has(level) ||
              (level === "off"
                ? wire !== null && typeof wire !== "string"
                : typeof wire !== "string" || !wire.trim()),
          )
        )
          throw new Error(`Check the reasoning efforts for ${modelId}.`);
        reasoningEfforts = efforts;
      }
    }
    return {
      id: modelId,
      name: String(model.name ?? "").trim() || modelId,
      contextWindow,
      maxTokens,
      // 显式 undefined 覆盖旧模型字段，允许从自定义能力恢复为 DSH 目录继承。
      input,
      reasoningEfforts,
    };
  });
  return { id, name, api, baseURL, models: normalized, apiKey: String(draft.apiKey ?? "").trim() };
}

export async function listDshProviderSettings(transport) {
  const description = await transport.call("settings/describe");
  const view = namespaceView(description);
  const profiles = object(object(view.value).providers);
  const native = description.namespaces.find((item) => item.ns === "llm-deepseek");
  const refs = [
    "DEEPSEEK_API_KEY",
    ...Object.entries(profiles).map(([id, profile]) => credentialRef(id, object(profile))),
  ];
  const credentials = await transport.call("credentials/describe", { refs: [...new Set(refs)] });
  const providers = Object.entries(profiles).map(([id, raw]) => {
    const profile = object(raw);
    return {
      id,
      name: typeof profile.displayName === "string" ? profile.displayName : id,
      api: typeof profile.api === "string" ? profile.api : "openai-completions",
      baseURL: typeof profile.baseURL === "string" ? profile.baseURL : "",
      models: Array.isArray(profile.models)
        ? profile.models.map((model) => ({
            id: String(model.id ?? ""),
            name: String(model.name ?? model.id ?? ""),
            contextWindow: Number(model.contextWindow ?? 128000),
            maxTokens: Number(model.maxTokens ?? 8192),
            ...(Array.isArray(model.input) && model.input.length ? { input: model.input } : {}),
            ...(model.reasoningEfforts !== undefined
              ? { reasoningEfforts: model.reasoningEfforts }
              : {}),
          }))
        : [],
      hasApiKey: Boolean(credentials[credentialRef(id, profile)]?.configured),
      builtIn: false,
    };
  });
  if (native)
    providers.unshift({
      id: "deepseek-official",
      name: "DeepSeek",
      api: "native",
      baseURL: "",
      models: Array.isArray(object(native.value).models)
        ? native.value.models.map((model) => ({
            id: String(model.id),
            name: String(model.name ?? model.id),
            contextWindow: Number(model.contextWindow ?? 1000000),
            maxTokens: Number(object(native.value).maxTokens ?? 256000),
          }))
        : [],
      hasApiKey: Boolean(credentials.DEEPSEEK_API_KEY?.configured),
      builtIn: true,
    });
  return { revision: view.revision, writable: Boolean(description.writable), providers };
}

export async function saveDshProvider(transport, draft, expectedRevision, creating = false) {
  if (draft?.id === "deepseek-official") {
    if (!String(draft.apiKey ?? "").trim()) throw new Error("Enter an API key.");
    await transport.call("credentials/set", {
      ref: "DEEPSEEK_API_KEY",
      value: draft.apiKey.trim(),
    });
    return;
  }
  const config = validateProviderDraft(draft);
  const description = await transport.call("settings/describe");
  const view = namespaceView(description);
  if (!description.writable) throw new Error("DSH provider settings are read-only.");
  if (view.revision !== expectedRevision)
    throw new Error("Provider settings changed. Refresh and retry.");
  const previous = object(object(view.value).providers)[config.id];
  if (creating && previous) throw new Error("This provider already exists. Select it to edit.");
  const ref = credentialRef(config.id, object(previous));
  const oldModels = new Map(
    (Array.isArray(object(previous).models) ? previous.models : []).map((model) => [
      model.id,
      model,
    ]),
  );
  const profile = {
    ...object(previous),
    displayName: config.name,
    api: config.api,
    baseURL: config.baseURL,
    ...(config.apiKey || object(previous).apiKeyEnv ? { apiKeyEnv: ref } : {}),
    models: config.models.map((model) => ({ ...object(oldModels.get(model.id)), ...model })),
  };
  const result = await transport.call("settings/mutate", {
    ns: NAMESPACE,
    ops: [{ op: "set", path: ["providers", config.id], value: profile }],
    expectedRevision,
  });
  if (config.apiKey) {
    try {
      await transport.call("credentials/set", { ref, value: config.apiKey });
    } catch (error) {
      // 凭据保存失败时回滚刚写入的供应商，避免 UI 显示一个不可用的新配置。
      await transport
        .call("settings/mutate", {
          ns: NAMESPACE,
          ops: [
            previous
              ? { op: "set", path: ["providers", config.id], value: previous }
              : { op: "unset", path: ["providers", config.id] },
          ],
          expectedRevision: result.revision,
        })
        .catch(() => {});
      throw error;
    }
  }
}

export async function deleteDshProvider(transport, id, expectedRevision) {
  if (!PROVIDER_ID.test(id) || id === "deepseek-official")
    throw new Error("This provider cannot be removed.");
  const description = await transport.call("settings/describe");
  const view = namespaceView(description);
  if (!description.writable) throw new Error("DSH provider settings are read-only.");
  if (view.revision !== expectedRevision)
    throw new Error("Provider settings changed. Refresh and retry.");
  if (!Object.hasOwn(object(object(view.value).providers), id))
    throw new Error("Provider no longer exists.");
  await transport.call("settings/mutate", {
    ns: NAMESPACE,
    ops: [{ op: "unset", path: ["providers", id] }],
    expectedRevision,
  });
}
