/* eslint-disable max-lines -- DSH provider settings keeps its navigation, catalog and editor together so draft state has one owner. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
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
import { BooleanModelOption } from "@/settings/model-provider-section/ProviderModelMetadataFields.js";
import { ModelSettingsGroup } from "@/settings/model-provider-section/ProviderModelSettingsGroups.js";
import { DshProviderNavigation } from "./DshProviderNavigation.js";
import providerCatalog from "./provider-catalog.json" with { type: "json" };

const TEMPLATES = providerCatalog;
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

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
    configuredGroup: "已配置 API",
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
    advanced: "高级模型配置",
    modalities: "输入能力",
    modalitiesInherit: "继承 DSH 模型目录",
    modalitiesExplicit: "手动声明",
    textInput: "文字",
    imageInput: "图片",
    imageHint: "仅在接口确实接受图片时开启；此选项不会检测服务端能力。",
    reasoning: "推理档位",
    reasoningMode: "推理配置",
    reasoningInherit: "继承 DSH 模型目录",
    reasoningOff: "不支持推理",
    reasoningCustom: "自定义档位",
    reasoningWire: "接口参数值",
    reasoningHint: "档位用于聊天选择，参数值是发给接口的 reasoning effort。",
    addModel: "添加模型",
    removeModel: "移除模型",
    save: "保存到 DSH",
    saving: "保存中…",
    remove: "删除供应商",
    choose: "从左侧选择供应商，或添加新供应商。",
    templateHint: "从原有独立 API 目录选择供应商；地址、协议和模型均可修改。",
    search: "搜索供应商",
    searchConfigured: "筛选已配置供应商",
    noMatches: "没有匹配的供应商",
    apiProviders: "API 供应商",
    modelSuggestion: "可输入其他模型 ID，或从候选列表选择。",
    modelCount: (count: number) => `${count} 个模型`,
    moveUp: "上移模型",
    moveDown: "下移模型",
    nativeModels: "DSH 内置模型由运行时管理，不能在这里编辑。",
    nativeHint: "DeepSeek 是 DSH 内置供应商，模型由 DSH 管理；这里只需设置或更新 API Key。",
    keyConfigured: "已配置密钥",
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
    configuredGroup: "Configured APIs",
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
    advanced: "Advanced model settings",
    modalities: "Input capabilities",
    modalitiesInherit: "Inherit DSH catalog",
    modalitiesExplicit: "Declare explicitly",
    textInput: "Text",
    imageInput: "Images",
    imageHint: "Enable images only if the endpoint accepts them. This does not probe the server.",
    reasoning: "Reasoning efforts",
    reasoningMode: "Reasoning configuration",
    reasoningInherit: "Inherit DSH catalog",
    reasoningOff: "No reasoning",
    reasoningCustom: "Custom efforts",
    reasoningWire: "API value",
    reasoningHint: "The level appears in chat; the API value is sent as the reasoning effort.",
    addModel: "Add model",
    removeModel: "Remove model",
    save: "Save to DSH",
    saving: "Saving…",
    remove: "Delete provider",
    choose: "Select a provider on the left or add a new one.",
    templateHint: "Choose an API provider. Its endpoint, protocol and model are editable.",
    search: "Search providers",
    searchConfigured: "Filter configured providers",
    noMatches: "No matching providers",
    apiProviders: "API providers",
    modelSuggestion: "Choose a suggested model or enter another model ID.",
    modelCount: (count: number) => `${count} model${count === 1 ? "" : "s"}`,
    moveUp: "Move model up",
    moveDown: "Move model down",
    nativeModels: "Built-in DSH models are managed by the runtime and cannot be edited here.",
    nativeHint:
      "DeepSeek is built into DSH; DSH manages its models. Set or update its API key here.",
    keyConfigured: "Key configured",
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
  const modelId = template?.models[0] ?? "";
  return {
    id: template?.id ?? "",
    name: template?.name ?? "",
    api: template?.api ?? "openai-completions",
    baseURL: template?.baseURL ?? "",
    apiKey: "",
    models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 8192 }],
  };
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
  const [catalogQuery, setCatalogQuery] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const refreshSerial = useRef(0);
  const selected = view?.providers.find((provider) => provider.id === selectedId) ?? null;
  const visibleTemplates = TEMPLATES.filter((template) =>
    `${template.name} ${template.nameZh} ${template.id} ${template.models.join(" ")}`
      .toLowerCase()
      .includes(catalogQuery.trim().toLowerCase()),
  );
  const modelSuggestions = TEMPLATES.find((template) => template.id === draft?.id)?.models ?? [];

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

  const moveModel = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current || index + direction < 0 || index + direction >= current.models.length)
        return current;
      const models = [...current.models];
      const [model] = models.splice(index, 1);
      if (!model) return current;
      models.splice(index + direction, 0, model);
      return { ...current, models };
    });
  };

  const openCatalog = () => {
    setMode("catalog");
    setCatalogQuery("");
    setNotice("");
  };

  return (
    <section className="space-y-4" data-testid="dsh-model-settings">
      <div className="flex items-start justify-between gap-3">
        <p className="text-ui-base leading-6 text-foreground-subtle">{t.intro}</p>
        <SettingsResourceHeaderActions
          onRefresh={() => void refresh()}
          onNew={openCatalog}
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
          <DshProviderNavigation
            providers={view?.providers ?? []}
            selectedId={selectedId}
            mode={mode}
            draftName={draft?.name}
            query={providerQuery}
            writable={Boolean(view?.writable)}
            labels={t}
            onQueryChange={setProviderQuery}
            onSelect={(id) => {
              setMode("detail");
              setSelectedId(id);
              setNotice("");
            }}
            onAdd={openCatalog}
          />
          <div className="min-w-0 p-4 pb-12 sm:p-6" data-model-provider-detail-scroll="true">
            {mode === "catalog" ? (
              <div className="space-y-4" data-testid="dsh-provider-catalog">
                <div>
                  <h2 className="text-ui-lg font-semibold">{t.add}</h2>
                  <p className="mt-1 text-ui-base text-foreground-subtle">{t.templateHint}</p>
                </div>
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtlest" />
                  <Input
                    aria-label={t.search}
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder={t.search}
                    className="pl-9"
                  />
                </div>
                <h3 className="text-ui-caption font-semibold text-foreground-subtle">
                  {t.apiProviders}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleTemplates.map((template) => (
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
                        <span className="block truncate">
                          {locale.startsWith("zh") ? template.nameZh : template.name}
                        </span>
                        <span className="mt-0.5 block text-ui-xs text-foreground-subtle">
                          {template.models.length} {t.model} · {template.api}
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-foreground-subtlest" />
                    </button>
                  ))}
                  {visibleTemplates.length === 0 && (
                    <p className="col-span-full text-ui-base text-foreground-subtle">
                      {t.noMatches}
                    </p>
                  )}
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
                      {selected && ` · ${t.modelCount(selected.models.length)}`}
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
                {selected?.builtIn && (
                  <section className="space-y-2" aria-label={t.model}>
                    <h3 className="text-ui-base font-semibold">{t.model}</h3>
                    <p className="text-ui-caption text-foreground-subtle">{t.nativeModels}</p>
                    {selected.models.map((model) => (
                      <div
                        key={model.id}
                        className="rounded-lg border border-border bg-surface px-3 py-2"
                      >
                        <p className="text-ui-base font-medium">{model.name}</p>
                        <p className="text-ui-caption text-foreground-subtle">{model.id}</p>
                      </div>
                    ))}
                  </section>
                )}
                {!selected?.builtIn && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-ui-base font-semibold">
                        {t.model} · {t.modelCount(draft.models.length)}
                      </h3>
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
                        className="space-y-3 rounded-lg border border-border bg-surface p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-ui-base font-medium">
                            {model.name || model.id || `${t.model} ${index + 1}`}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t.moveUp} ${index + 1}`}
                            disabled={index === 0}
                            onClick={() => moveModel(index, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t.moveDown} ${index + 1}`}
                            disabled={index === draft.models.length - 1}
                            onClick={() => moveModel(index, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
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
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={t.modelId}>
                            <Input
                              size="lg"
                              value={model.id}
                              list={
                                modelSuggestions.length ? `dsh-model-options-${index}` : undefined
                              }
                              onChange={(event) =>
                                updateModel(index, {
                                  id: event.target.value,
                                  ...(model.name === model.id || !model.name
                                    ? { name: event.target.value }
                                    : {}),
                                })
                              }
                            />
                            {modelSuggestions.length > 0 && (
                              <datalist id={`dsh-model-options-${index}`}>
                                {modelSuggestions.map((id) => (
                                  <option key={id} value={id} />
                                ))}
                              </datalist>
                            )}
                            {modelSuggestions.length > 0 && (
                              <span className="text-ui-xs text-foreground-subtlest">
                                {t.modelSuggestion}
                              </span>
                            )}
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
                        </div>
                        <details
                          className="border-t border-border pt-3"
                          data-testid="dsh-model-advanced"
                        >
                          <summary className="cursor-pointer text-ui-base font-medium text-foreground-subtle hover:text-foreground">
                            {t.advanced}
                          </summary>
                          <div className="space-y-5 pt-4">
                            <ModelSettingsGroup group="modalities">
                              <div className="space-y-2">
                                <p className="text-ui-base font-medium">{t.modalities}</p>
                                <Select
                                  value={model.input ? "custom" : "inherit"}
                                  onValueChange={(value) =>
                                    updateModel(index, {
                                      input: value === "inherit" ? undefined : ["text"],
                                    })
                                  }
                                >
                                  <SelectTrigger size="lg" className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inherit">{t.modalitiesInherit}</SelectItem>
                                    <SelectItem value="custom">{t.modalitiesExplicit}</SelectItem>
                                  </SelectContent>
                                </Select>
                                {model.input && (
                                  <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-ui-base text-foreground-subtle">
                                      {t.textInput}
                                    </span>
                                    <BooleanModelOption
                                      label={t.imageInput}
                                      selected={model.input.includes("image")}
                                      onToggle={() =>
                                        updateModel(index, {
                                          input: model.input?.includes("image")
                                            ? ["text"]
                                            : ["text", "image"],
                                        })
                                      }
                                    />
                                  </div>
                                )}
                                <p className="text-ui-caption text-foreground-subtle">
                                  {t.imageHint}
                                </p>
                              </div>
                            </ModelSettingsGroup>
                            <ModelSettingsGroup group="reasoning">
                              <Field label={t.reasoningMode}>
                                <Select
                                  value={
                                    model.reasoningEfforts === undefined
                                      ? "inherit"
                                      : model.reasoningEfforts === false
                                        ? "off"
                                        : "custom"
                                  }
                                  onValueChange={(value) =>
                                    updateModel(index, {
                                      reasoningEfforts:
                                        value === "inherit"
                                          ? undefined
                                          : value === "off"
                                            ? false
                                            : {
                                                off: null,
                                                low: "low",
                                                medium: "medium",
                                                high: "high",
                                              },
                                    })
                                  }
                                >
                                  <SelectTrigger size="lg" className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inherit">{t.reasoningInherit}</SelectItem>
                                    <SelectItem value="off">{t.reasoningOff}</SelectItem>
                                    <SelectItem value="custom">{t.reasoningCustom}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </Field>
                              {model.reasoningEfforts && (
                                <div className="space-y-3">
                                  <p className="text-ui-base font-medium">{t.reasoning}</p>
                                  <div className="flex flex-wrap gap-2">
                                    {REASONING_LEVELS.map((level) => (
                                      <BooleanModelOption
                                        key={level}
                                        label={level}
                                        selected={Object.hasOwn(
                                          model.reasoningEfforts || {},
                                          level,
                                        )}
                                        onToggle={() => {
                                          const efforts = { ...model.reasoningEfforts };
                                          if (Object.hasOwn(efforts, level)) {
                                            delete efforts[level];
                                            if (
                                              Object.keys(efforts).every((item) => item === "off")
                                            )
                                              return;
                                          } else efforts[level] = level;
                                          updateModel(index, { reasoningEfforts: efforts });
                                        }}
                                      />
                                    ))}
                                  </div>
                                  {REASONING_LEVELS.filter((level) =>
                                    Object.hasOwn(model.reasoningEfforts || {}, level),
                                  ).map((level) => (
                                    <Field key={level} label={`${level} · ${t.reasoningWire}`}>
                                      <Input
                                        size="lg"
                                        value={
                                          model.reasoningEfforts &&
                                          model.reasoningEfforts[level] !== null
                                            ? model.reasoningEfforts[level]
                                            : ""
                                        }
                                        onChange={(event) =>
                                          updateModel(index, {
                                            reasoningEfforts: {
                                              ...model.reasoningEfforts,
                                              [level]: event.target.value,
                                            },
                                          })
                                        }
                                      />
                                    </Field>
                                  ))}
                                  <p className="text-ui-caption text-foreground-subtle">
                                    {t.reasoningHint}
                                  </p>
                                </div>
                              )}
                            </ModelSettingsGroup>
                          </div>
                        </details>
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
