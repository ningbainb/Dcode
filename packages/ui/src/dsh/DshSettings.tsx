/* eslint-disable max-lines -- DSH provider settings keeps its navigation, catalog and editor together so draft state has one owner. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type {
  DshProviderDraft,
  DshProviderSettings,
  DshProviderSettingsView,
} from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import { ApiKeyInput } from "@/settings/model-provider-section/ApiKeyInput.js";

const TEMPLATES = [
  {
    id: "openai",
    name: "OpenAI",
    logo: "openai",
    api: "openai-responses",
    baseURL: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: "anthropic",
    api: "anthropic-messages",
    baseURL: "https://api.anthropic.com",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    logo: "openrouter",
    api: "openai-completions",
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek-api",
    name: "DeepSeek API",
    logo: "deepseek",
    api: "openai-completions",
    baseURL: "https://api.deepseek.com",
  },
  { id: "minimax", name: "MiniMax", logo: "minimax", api: "openai-completions", baseURL: "" },
  {
    id: "moonshot-kimi",
    name: "Moonshot / Kimi",
    logo: "moonshot-kimi",
    api: "openai-completions",
    baseURL: "",
  },
  {
    id: "alibaba-model-studio",
    name: "Alibaba Cloud",
    logo: "alibaba-model-studio",
    api: "openai-completions",
    baseURL: "",
  },
  { id: "xai", name: "xAI", logo: "xai", api: "openai-completions", baseURL: "" },
] as const;

const COPY = {
  zh: {
    intro: "管理 Dcode 聊天使用的模型供应商、密钥和模型。保存后即可在会话中选择。",
    add: "添加供应商",
    refresh: "刷新",
    configured: "已配置",
    keyMissing: "未配置密钥",
    provider: "供应商",
    custom: "自定义供应商",
    native: "DSH 内置",
    newProvider: "新供应商",
    name: "显示名称",
    id: "供应商 ID",
    protocol: "接口协议",
    endpoint: "接口地址",
    key: "API Key",
    keyHint: "留空则保留当前密钥。",
    newKeyHint: "本地服务可留空；使用云端模型通常需要 API Key。",
    model: "模型",
    modelId: "模型 ID",
    modelName: "显示名称",
    context: "上下文上限",
    output: "输出上限",
    addModel: "添加模型",
    removeModel: "移除模型",
    save: "保存到 DSH",
    saving: "保存中…",
    remove: "删除供应商",
    choose: "从左侧选择供应商，或添加新供应商。",
    templateHint: "选择一个模板后填写模型 ID；预填地址和协议都可以修改。",
    nativeHint: "DeepSeek 是 DSH 内置供应商，模型由 DSH 管理；这里只需设置或更新 API Key。",
    saved: "已保存到 DSH，聊天模型列表已刷新。",
    deleted: "供应商已删除。",
    deleteConfirm: "确定删除这个供应商配置吗？已有会话不会删除。",
    diagnostics: "运行时诊断",
    restart: "重启运行时",
    logs: "打开日志",
    restarted: "运行时已重启。",
    loading: "正在读取 DSH 供应商…",
    readOnly: "DSH 设置当前为只读。",
  },
  en: {
    intro:
      "Manage the providers, keys and models used by Dcode chats. Saved models are ready to select in a conversation.",
    add: "Add provider",
    refresh: "Refresh",
    configured: "Configured",
    keyMissing: "No key",
    provider: "Provider",
    custom: "Custom provider",
    native: "Built into DSH",
    newProvider: "New provider",
    name: "Display name",
    id: "Provider ID",
    protocol: "API protocol",
    endpoint: "Base URL",
    key: "API key",
    keyHint: "Leave blank to keep the current key.",
    newKeyHint: "Local endpoints can omit a key. Cloud models usually require one.",
    model: "Models",
    modelId: "Model ID",
    modelName: "Display name",
    context: "Context window",
    output: "Max output",
    addModel: "Add model",
    removeModel: "Remove model",
    save: "Save to DSH",
    saving: "Saving…",
    remove: "Delete provider",
    choose: "Select a provider on the left or add a new one.",
    templateHint: "Choose a template, then enter a model ID. Endpoints and protocols are editable.",
    nativeHint:
      "DeepSeek is built into DSH; DSH manages its models. Set or update its API key here.",
    saved: "Saved to DSH. Chat models have been refreshed.",
    deleted: "Provider removed.",
    deleteConfirm: "Delete this provider configuration? Existing sessions will remain.",
    diagnostics: "Runtime diagnostics",
    restart: "Restart runtime",
    logs: "Open logs",
    restarted: "Runtime restarted.",
    loading: "Loading DSH providers…",
    readOnly: "DSH settings are read-only.",
  },
};

function draftFromProvider(provider: DshProviderSettings): DshProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    api: provider.api,
    baseURL: provider.baseURL,
    models: provider.models.map((model) => ({ ...model })),
    apiKey: "",
  };
}

function newDraft(template?: (typeof TEMPLATES)[number]): DshProviderDraft {
  return {
    id: template?.id ?? "",
    name: template?.name ?? "",
    api: template?.api ?? "openai-completions",
    baseURL: template?.baseURL ?? "",
    apiKey: "",
    models: [{ id: "", name: "", contextWindow: 128000, maxTokens: 8192 }],
  };
}

function logoKey(provider: DshProviderSettings): string {
  return provider.builtIn
    ? "deepseek"
    : (TEMPLATES.find((item) => item.id === provider.id)?.logo ?? "");
}

export function DshSettings() {
  const { dshService } = useServices();
  const platform = usePlatform();
  const { locale } = useZCodeIntl();
  const t = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const [view, setView] = useState<DshProviderSettingsView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DshProviderDraft | null>(null);
  const [mode, setMode] = useState<"detail" | "catalog">("detail");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const refreshSerial = useRef(0);
  const selected = view?.providers.find((provider) => provider.id === selectedId) ?? null;

  const refresh = useCallback(
    async (selectId?: string) => {
      if (!dshService) return;
      const serial = ++refreshSerial.current;
      setLoading(true);
      try {
        const next = await dshService.listProviderSettings();
        if (serial !== refreshSerial.current) return;
        setView(next);
        setSelectedId((current) => {
          const target = selectId ?? current;
          return next.providers.some((provider) => provider.id === target)
            ? target
            : (next.providers[0]?.id ?? null);
        });
        setNotice("");
        return true;
      } catch (error) {
        if (serial === refreshSerial.current)
          setNotice(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        if (serial === refreshSerial.current) setLoading(false);
      }
    },
    [dshService],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (mode !== "detail") return;
    if (selected) setDraft(draftFromProvider(selected));
    else if (selectedId !== "new") setDraft(null);
  }, [mode, selected, selectedId]);

  const startNew = (template?: (typeof TEMPLATES)[number]) => {
    if (template && view?.providers.some((provider) => provider.id === template.id)) {
      setMode("detail");
      setSelectedId(template.id);
      setNotice("");
      return;
    }
    setMode("detail");
    setSelectedId("new");
    setDraft(newDraft(template));
    setNotice("");
  };

  const save = async () => {
    if (!dshService || !draft || !view || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await dshService.saveProvider(draft, view.revision, selectedId === "new");
      const savedId = draft.id.trim();
      if (!(await refresh(savedId))) return;
      window.dispatchEvent(new Event("dcode:dsh-models-changed"));
      setNotice(t.saved);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !dshService ||
      !selected ||
      selected.builtIn ||
      !view ||
      busy ||
      !window.confirm(t.deleteConfirm)
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      await dshService.deleteProvider(selected.id, view.revision);
      if (!(await refresh())) return;
      window.dispatchEvent(new Event("dcode:dsh-models-changed"));
      setNotice(t.deleted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restartRuntime = async () => {
    if (!dshService) return;
    setBusy(true);
    setNotice("");
    try {
      await dshService.restart();
      window.dispatchEvent(new Event("dcode:dsh-runtime-restarted"));
      await refresh();
      setNotice(t.restarted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateModel = (index: number, patch: Partial<DshProviderDraft["models"][number]>) => {
    setDraft(
      (current) =>
        current && {
          ...current,
          models: current.models.map((model, position) =>
            position === index ? { ...model, ...patch } : model,
          ),
        },
    );
  };

  return (
    <section className="space-y-4" data-testid="dsh-model-settings">
      <div className="flex items-start justify-between gap-3">
        <p className="text-ui-base leading-6 text-foreground-subtle">{t.intro}</p>
        <SettingsResourceHeaderActions
          onRefresh={() => void refresh()}
          onNew={() => {
            setMode("catalog");
            setNotice("");
          }}
          refreshing={loading}
          newDisabled={!view?.writable}
          refreshLabel={t.refresh}
          newLabel={t.add}
        />
      </div>
      <div className="overflow-clip rounded-xl border border-border bg-card">
        <div
          className="grid min-h-[36rem] grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)]"
          data-model-provider-split-panel="true"
        >
          <nav className="min-w-0 space-y-1 border-r border-border p-2" aria-label={t.provider}>
            <p className="px-2 py-2 text-ui-xs font-semibold text-foreground-subtle max-md:sr-only">
              {t.provider}
            </p>
            {view?.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                data-testid="dsh-provider-nav-item"
                title={provider.name}
                aria-selected={selectedId === provider.id && mode === "detail"}
                onClick={() => {
                  setMode("detail");
                  setSelectedId(provider.id);
                  setNotice("");
                }}
                className={`flex h-9 w-full items-center gap-2 rounded-lg border px-2 text-left text-ui-base transition-colors max-md:justify-center ${
                  selectedId === provider.id && mode === "detail"
                    ? "border-border-hover bg-card-selected"
                    : "border-transparent hover:bg-hover"
                }`}
              >
                <ProviderLogo
                  logo={{ type: "builtin", key: logoKey(provider) }}
                  className="size-4"
                />
                <span className="min-w-0 flex-1 truncate max-md:sr-only">{provider.name}</span>
                <span
                  className={`size-1.5 rounded-full max-md:hidden ${provider.hasApiKey ? "bg-success" : "bg-foreground-subtlest"}`}
                />
              </button>
            ))}
            {selectedId === "new" && mode === "detail" && (
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border-hover bg-card-selected px-2 text-ui-base">
                <Plus className="size-4" />
                <span className="truncate max-md:sr-only">{draft?.name || t.newProvider}</span>
              </div>
            )}
          </nav>
          <div className="min-w-0 p-4 pb-12 sm:p-6" data-model-provider-detail-scroll="true">
            {mode === "catalog" ? (
              <div className="space-y-4" data-testid="dsh-provider-catalog">
                <div>
                  <h2 className="text-ui-lg font-semibold">{t.add}</h2>
                  <p className="mt-1 text-ui-base text-foreground-subtle">{t.templateHint}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => startNew(template)}
                      className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface px-4 text-left hover:border-border-hover hover:bg-hover"
                    >
                      <ProviderLogo
                        logo={{ type: "builtin", key: template.logo }}
                        className="size-8"
                      />
                      <span className="min-w-0 flex-1 text-ui-base font-medium">
                        {template.name}
                      </span>
                      <ChevronRight className="size-4 text-foreground-subtlest" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => startNew()}
                    className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface px-4 text-left hover:border-border-hover hover:bg-hover"
                  >
                    <Plus className="size-8 rounded-lg bg-hover p-2" />
                    <span className="min-w-0 flex-1 text-ui-base font-medium">{t.custom}</span>
                    <ChevronRight className="size-4 text-foreground-subtlest" />
                  </button>
                </div>
              </div>
            ) : draft ? (
              <form
                className="space-y-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-ui-lg font-semibold">
                      {selected?.name ?? draft.name ?? t.newProvider}
                    </h2>
                    <p className="mt-1 text-ui-caption text-foreground-subtle">
                      {selected?.builtIn
                        ? t.native
                        : selected?.hasApiKey
                          ? t.configured
                          : t.keyMissing}
                    </p>
                  </div>
                  {selected && !selected.builtIn && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || !view?.writable}
                      onClick={() => void remove()}
                    >
                      <Trash2 className="size-4" />
                      {t.remove}
                    </Button>
                  )}
                </div>
                {!selected?.builtIn && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.name}>
                      <Input
                        size="lg"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </Field>
                    <Field label={t.id}>
                      <Input
                        size="lg"
                        value={draft.id}
                        disabled={Boolean(selected)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                          })
                        }
                      />
                    </Field>
                    <Field label={t.protocol}>
                      <Select
                        value={draft.api}
                        onValueChange={(api) => setDraft({ ...draft, api })}
                      >
                        <SelectTrigger size="lg" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai-completions">
                            OpenAI Chat Completions
                          </SelectItem>
                          <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                          <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t.endpoint}>
                      <Input
                        size="lg"
                        value={draft.baseURL}
                        placeholder="https://…"
                        onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <Field label={t.key}>
                  <ApiKeyInput
                    value={draft.apiKey}
                    visible={keyVisible}
                    onChange={(apiKey) => setDraft({ ...draft, apiKey })}
                    onBlur={() => {}}
                    onToggleVisibility={() => setKeyVisible((value) => !value)}
                  />
                  <p className="mt-1 text-ui-caption text-foreground-subtle">
                    {selected?.builtIn ? t.nativeHint : selected ? t.keyHint : t.newKeyHint}
                  </p>
                </Field>
                {!selected?.builtIn && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-ui-base font-semibold">{t.model}</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            models: [
                              ...draft.models,
                              { id: "", name: "", contextWindow: 128000, maxTokens: 8192 },
                            ],
                          })
                        }
                      >
                        <Plus className="size-4" />
                        {t.addModel}
                      </Button>
                    </div>
                    {draft.models.map((model, index) => (
                      <div
                        key={index}
                        className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_7rem_auto]"
                      >
                        <Field label={t.modelId}>
                          <Input
                            size="lg"
                            value={model.id}
                            onChange={(event) => updateModel(index, { id: event.target.value })}
                          />
                        </Field>
                        <Field label={t.modelName}>
                          <Input
                            size="lg"
                            value={model.name}
                            onChange={(event) => updateModel(index, { name: event.target.value })}
                          />
                        </Field>
                        <Field label={t.context}>
                          <Input
                            size="lg"
                            type="number"
                            min={1024}
                            value={model.contextWindow}
                            onChange={(event) =>
                              updateModel(index, { contextWindow: Number(event.target.value) })
                            }
                          />
                        </Field>
                        <Field label={t.output}>
                          <Input
                            size="lg"
                            type="number"
                            min={1}
                            value={model.maxTokens}
                            onChange={(event) =>
                              updateModel(index, { maxTokens: Number(event.target.value) })
                            }
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="self-end"
                          aria-label={t.removeModel}
                          disabled={draft.models.length === 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              models: draft.models.filter((_, position) => position !== index),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={busy || !view?.writable || (selected?.builtIn && !draft.apiKey.trim())}
                >
                  {busy ? t.saving : t.save}
                </Button>
              </form>
            ) : (
              <p className="text-ui-base text-foreground-subtle">
                {loading ? t.loading : t.choose}
              </p>
            )}
          </div>
        </div>
      </div>
      {view && !view.writable && <p className="text-ui-caption text-warning">{t.readOnly}</p>}
      {notice && (
        <p role="status" className="text-ui-base text-foreground-subtle">
          {notice}
        </p>
      )}
      <details className="rounded-lg border border-border p-4 text-ui-base">
        <summary className="cursor-pointer font-medium">{t.diagnostics}</summary>
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void restartRuntime()}
          >
            {t.restart}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void dshService
                ?.getLogsPath()
                .then((path) => platform.openExternalFile?.(path))
                .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
            }
          >
            {t.logs}
          </Button>
        </div>
      </details>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-ui-caption font-medium text-foreground-subtle">{label}</span>
      {children}
    </label>
  );
}
