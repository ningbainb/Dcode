import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = JSON.parse(
  await readFile(resolve(root, "config/provider/zcode-builtin.json"), "utf8"),
);
const protocol = {
  "openai-chat-completions": "openai-completions",
  "openai-responses": "openai-responses",
  "anthropic-messages": "anthropic-messages",
};
const included = new Set([
  "moonshot-kimi",
  "minimax",
  "qwen-alibaba-model-studio-cn",
  "qwen-alibaba-model-studio-intl",
  "xiaomi-mimo",
  "openai",
  "anthropic",
  "xai",
  "openrouter",
  "opencode-go-chat",
  "opencode-go-messages",
  "opencode-go-responses",
  "opencode-zen-responses",
  "opencode-zen-messages",
  "opencode-zen-chat",
]);
const templates = source.config.providerConfigRules.templateRules
  .filter((item) => included.has(item.templateId))
  .map((item) => {
    const api = protocol[item.config.api.type];
    if (!api) throw new Error(`Unsupported DSH protocol: ${item.templateId}`);
    return {
      id: item.templateId,
      name: item.templateNameMap["en-US"],
      nameZh: item.templateNameMap["zh-CN"],
      logo: item.config.logo.key,
      api,
      baseURL: item.config.api.baseUrl,
      models: item.config.builtinModelIds,
    };
  });
if (templates.length !== included.size || templates.some((item) => !item.models.length)) {
  throw new Error("The DSH provider catalog is empty or has an empty provider.");
}
const target = resolve(root, "packages/ui/src/dsh/provider-catalog.json");
await writeFile(target, `${JSON.stringify(templates, null, 2)}\n`, "utf8");
console.log(`Generated ${templates.length} DSH API provider templates from ZCode config.`);
