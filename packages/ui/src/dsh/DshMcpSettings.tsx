/* eslint-disable max-lines -- DSH MCP settings keeps the server list and unsaved editor in one state owner. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Cable, Download, Plus, Trash2 } from "lucide-react";
import type { DshMcpServer, DshMcpServerSettingsView } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { prepareZcodeMcpImport } from "./zcodeMcpImport.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";

type Draft = {
  serverName: string;
  transport: DshMcpServer["transport"];
  enabled: boolean;
  command: string;
  args: string;
  cwd: string;
  envRefs: string;
  url: string;
  bearerTokenEnv: string;
};

const COPY = {
  zh: {
    intro: "管理 DSH Agent 真正使用的 MCP 服务器。浏览器和电脑控制仍在“插件”中管理。",
    add: "添加服务器",
    importZcode: "从 ZCode 导入",
    importResult: (imported: number, skipped: number) =>
      `已导入 ${imported} 个停用的服务器，跳过 ${skipped} 个。请检查配置后逐项启用。`,
    refresh: "刷新",
    empty: "尚未添加 MCP 服务器。",
    serverName: "服务器名称",
    transport: "连接方式",
    command: "启动命令",
    args: "命令参数（每行一个）",
    cwd: "工作目录（可选）",
    envRefs: "环境变量映射（每行 CHILD_NAME=SYSTEM_NAME）",
    url: "MCP 地址",
    bearer: "Bearer Token 环境变量名（可选）",
    save: "保存到 DSH",
    saving: "保存中…",
    remove: "删除服务器",
    configured: "已启用配置",
    disabled: "已停用",
    local: "本地 stdio",
    http: "Streamable HTTP",
    hint: "启停或修改会重启 DSH，正在执行的任务可能中断。已启用不代表服务器已连接；工具发现失败时请查看运行时日志。",
    secretHint:
      "密钥使用系统环境变量名，变量值不会写入配置文件。新设置的系统变量需重启 Dcode 才能读取；命令参数和 URL 会保存，请勿在其中填写密钥。",
    saved: "MCP 配置已保存，DSH 已重启。",
    deleted: "MCP 服务器已删除，DSH 已重启。",
    deleteConfirm: "删除这个 MCP 服务器配置？",
  },
  en: {
    intro:
      "Manage MCP servers used by the DSH Agent. Browser and computer control stay in Plugins.",
    add: "Add server",
    importZcode: "Import from ZCode",
    importResult: (imported: number, skipped: number) =>
      `Imported ${imported} disabled servers; skipped ${skipped}. Review each before enabling.`,
    refresh: "Refresh",
    empty: "No MCP servers have been added.",
    serverName: "Server name",
    transport: "Transport",
    command: "Command",
    args: "Arguments (one per line)",
    cwd: "Working directory (optional)",
    envRefs: "Environment mappings (CHILD_NAME=SYSTEM_NAME per line)",
    url: "MCP URL",
    bearer: "Bearer token environment variable (optional)",
    save: "Save to DSH",
    saving: "Saving…",
    remove: "Delete server",
    configured: "Enabled configuration",
    disabled: "Disabled",
    local: "Local stdio",
    http: "Streamable HTTP",
    hint: "Changes restart DSH and may interrupt an active turn. Enabled does not mean connected; check runtime logs if tools are missing.",
    secretHint:
      "Use environment variable names for secrets; their values are not saved. Restart Dcode after setting a system variable. Command arguments and URLs are saved, so do not put secrets there.",
    saved: "MCP settings saved and DSH restarted.",
    deleted: "MCP server deleted and DSH restarted.",
    deleteConfirm: "Delete this MCP server configuration?",
  },
};

function toDraft(server?: DshMcpServer): Draft {
  return {
    serverName: server?.serverName ?? "",
    transport: server?.transport ?? "stdio",
    enabled: server?.enabled ?? false,
    command: server?.transport === "stdio" ? server.command : "",
    args: server?.transport === "stdio" ? server.args.join("\n") : "",
    cwd: server?.transport === "stdio" ? server.cwd : "",
    envRefs:
      server?.transport === "stdio"
        ? Object.entries(server.envRefs)
            .map(([child, system]) => `${child}=${system}`)
            .join("\n")
        : "",
    url: server?.transport === "streamable-http" ? server.url : "",
    bearerTokenEnv: server?.transport === "streamable-http" ? server.bearerTokenEnv : "",
  };
}

function fromDraft(draft: Draft): DshMcpServer {
  const base = { serverName: draft.serverName.trim(), enabled: draft.enabled };
  if (draft.transport === "stdio") {
    const envRefs: Record<string, string> = {};
    for (const line of draft.envRefs
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const separator = line.indexOf("=");
      if (separator < 1) throw new Error("Use CHILD_NAME=SYSTEM_NAME for environment mappings.");
      envRefs[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return {
      ...base,
      transport: "stdio",
      command: draft.command.trim(),
      args: draft.args
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      cwd: draft.cwd.trim(),
      envRefs,
    };
  }
  return {
    ...base,
    transport: "streamable-http",
    url: draft.url.trim(),
    bearerTokenEnv: draft.bearerTokenEnv.trim(),
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-ui-base">
      <span className="font-medium text-foreground-subtle">{label}</span>
      {children}
    </label>
  );
}

export function DshMcpSettings() {
  const { dshService, mcpSyncService } = useServices();
  const { locale } = useZCodeIntl();
  const t = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const [view, setView] = useState<DshMcpServerSettingsView | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = view?.servers.find((item) => item.serverName === selectedName);

  const refresh = useCallback(async () => {
    if (!dshService) return;
    setLoading(true);
    try {
      const next = await dshService.listMcpServers();
      setView(next);
      setSelectedName((old) =>
        old === "new" || next.servers.some((item) => item.serverName === old)
          ? old
          : (next.servers[0]?.serverName ?? null),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [dshService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
    else if (selectedName !== "new") setDraft(null);
  }, [selected, selectedName]);

  async function commit(servers: DshMcpServer[], selectName: string | null, message: string) {
    if (!dshService || !view || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const next = await dshService.updateMcpServers(servers, view.revision);
      setView(next);
      setSelectedName(selectName);
      setNotice(message);
      window.dispatchEvent(new Event("dcode:dsh-runtime-restarted"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!draft || !view) return;
    try {
      const server = fromDraft(draft);
      if (
        selectedName === "new" &&
        view.servers.some((item) => item.serverName === server.serverName)
      )
        throw new Error("This MCP server name already exists.");
      void commit(
        [...view.servers.filter((item) => item.serverName !== selectedName), server],
        server.serverName,
        t.saved,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function importFromZcode() {
    if (!dshService || !mcpSyncService || !view || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const source = await mcpSyncService.loadMcpFromUserDirectory();
      const prepared = prepareZcodeMcpImport(source.servers, view.servers);
      if (prepared.imported > 0) {
        const next = await dshService.updateMcpServers(prepared.servers, view.revision);
        setView(next);
        setSelectedName(prepared.servers[view.servers.length]?.serverName ?? null);
        window.dispatchEvent(new Event("dcode:dsh-runtime-restarted"));
      }
      setNotice(t.importResult(prepared.imported, prepared.skipped));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" data-testid="dsh-mcp-settings">
      <div className="flex items-start justify-between gap-3">
        <p className="text-ui-base leading-6 text-foreground-subtle">{t.intro}</p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !view}
            onClick={() => void importFromZcode()}
          >
            <Download className="size-4" />
            {t.importZcode}
          </Button>
          <SettingsResourceHeaderActions
            onRefresh={() => void refresh()}
            refreshing={loading}
            onNew={() => {
              setSelectedName("new");
              setDraft(toDraft());
              setNotice("");
            }}
            newLabel={t.add}
            refreshLabel={t.refresh}
          />
        </div>
      </div>
      <div className="overflow-clip rounded-xl border border-border bg-card">
        <div className="grid min-h-[32rem] grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)]">
          <nav aria-label={t.serverName} className="min-w-0 space-y-1 border-r border-border p-2">
            {view?.servers.map((server) => (
              <div key={server.serverName} className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="dsh-mcp-nav-item"
                  title={server.serverName}
                  aria-selected={selectedName === server.serverName}
                  onClick={() => {
                    setSelectedName(server.serverName);
                    setNotice("");
                  }}
                  className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 text-left text-ui-base max-md:justify-center ${selectedName === server.serverName ? "border-border-hover bg-card-selected" : "border-transparent hover:bg-hover"}`}
                >
                  <Cable className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate max-md:sr-only">
                    {server.serverName}
                  </span>
                  <span
                    className={`size-1.5 shrink-0 rounded-full max-md:hidden ${server.enabled ? "bg-success" : "bg-foreground-subtlest"}`}
                  />
                </button>
                <Switch
                  aria-label={`${server.serverName} ${server.enabled ? t.configured : t.disabled}`}
                  checked={server.enabled}
                  disabled={busy}
                  onCheckedChange={(enabled) =>
                    void commit(
                      view.servers.map((item) =>
                        item.serverName === server.serverName ? { ...item, enabled } : item,
                      ),
                      selectedName,
                      t.saved,
                    )
                  }
                  className="max-md:hidden"
                />
              </div>
            ))}
            {selectedName === "new" && (
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border-hover bg-card-selected px-2 text-ui-base">
                <Plus className="size-4" />
                <span className="max-md:sr-only">{t.add}</span>
              </div>
            )}
          </nav>
          <div className="min-w-0 p-4 pb-10 sm:p-6">
            {draft ? (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-ui-lg font-semibold">{selected?.serverName ?? t.add}</h2>
                    <p className="mt-1 text-ui-caption text-foreground-subtle">
                      {selected?.enabled ? t.configured : t.disabled}
                    </p>
                  </div>
                  {selected && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t.deleteConfirm))
                          void commit(
                            view!.servers.filter((item) => item.serverName !== selected.serverName),
                            null,
                            t.deleted,
                          );
                      }}
                    >
                      <Trash2 className="size-4" />
                      {t.remove}
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.serverName}>
                    <Input
                      size="lg"
                      value={draft.serverName}
                      disabled={Boolean(selected)}
                      onChange={(event) => setDraft({ ...draft, serverName: event.target.value })}
                    />
                  </Field>
                  <Field label={t.transport}>
                    <Select
                      value={draft.transport}
                      onValueChange={(transport) =>
                        setDraft({ ...draft, transport: transport as Draft["transport"] })
                      }
                    >
                      <SelectTrigger size="lg" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stdio">{t.local}</SelectItem>
                        <SelectItem value="streamable-http">{t.http}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                {draft.transport === "stdio" ? (
                  <div className="space-y-4">
                    <Field label={t.command}>
                      <Input
                        size="lg"
                        value={draft.command}
                        onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                      />
                    </Field>
                    <Field label={t.args}>
                      <SettingsFormTextarea
                        value={draft.args}
                        onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                      />
                    </Field>
                    <Field label={t.cwd}>
                      <Input
                        size="lg"
                        value={draft.cwd}
                        onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                      />
                    </Field>
                    <Field label={t.envRefs}>
                      <SettingsFormTextarea
                        value={draft.envRefs}
                        onChange={(event) => setDraft({ ...draft, envRefs: event.target.value })}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Field label={t.url}>
                      <Input
                        size="lg"
                        value={draft.url}
                        placeholder="https://example.com/mcp"
                        onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      />
                    </Field>
                    <Field label={t.bearer}>
                      <Input
                        size="lg"
                        value={draft.bearerTokenEnv}
                        onChange={(event) =>
                          setDraft({ ...draft, bearerTokenEnv: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                )}
                <p className="text-ui-caption text-foreground-subtle">{t.secretHint}</p>
                <Button type="submit" disabled={busy || !view}>
                  {busy ? t.saving : t.save}
                </Button>
              </form>
            ) : (
              <p className="text-ui-base text-foreground-subtle">{t.empty}</p>
            )}
          </div>
        </div>
      </div>
      <p className="text-ui-sm leading-5 text-foreground-subtle">{t.hint}</p>
      {notice && (
        <p role="status" className="text-ui-base text-foreground-subtle">
          {notice}
        </p>
      )}
    </section>
  );
}
