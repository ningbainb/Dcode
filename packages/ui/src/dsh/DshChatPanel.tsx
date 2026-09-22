import { useCallback, useEffect, useRef, useState } from "react";
import type { DshModel, DshRuntimeHealth } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { ArrowUp, FileDiff, FolderOpen, ShieldCheck, Sparkles } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import appLogoUrl from "@/assets/dcode-logo.png";
import { emptyProjection, projectFrame, record, type DshRow } from "./projection.js";
import { getDshCopy } from "./dshCopy.js";
import { DshToolActivity } from "./DshToolActivity.js";

export function DshChatPanel({
  workspacePath,
  selectedSessionId,
  onSessionCreated,
  onRefreshSessions,
  onRefreshGit,
  onOpenDiff,
}: {
  workspacePath: string;
  selectedSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onRefreshGit: () => void;
  onOpenDiff: () => void;
}) {
  const { locale } = useZCodeIntl();
  const copy = getDshCopy(locale);
  const zh = locale.startsWith("zh");
  const { dshService: service } = useServices();
  const [health, setHealth] = useState<DshRuntimeHealth>({ state: "starting", generation: 0 });
  const [models, setModels] = useState<DshModel[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [draft, setDraft] = useState("");
  const [projection, setProjection] = useState(emptyProjection);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState<Record<string, unknown> | null>(null);
  const selection = useRef({ workspacePath, sessionId: selectedSessionId });
  selection.current = { workspacePath, sessionId: selectedSessionId };
  const loadedSessionRef = useRef("");
  const bottom = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const model = models.find((item) => `${item.provider}/${item.model}` === modelKey);
  const approvalDescription =
    typeof approval?.reason === "string"
      ? approval.reason
      : typeof approval?.description === "string"
        ? approval.description
        : copy.permissionDescription;
  const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath;
  const displayRows: Array<DshRow | DshRow[]> = [];
  for (const row of projection.rows) {
    const previous = displayRows.at(-1);
    if (row.kind === "tool") {
      if (Array.isArray(previous)) previous.push(row);
      else displayRows.push([row]);
    } else displayRows.push(row);
  }

  const refresh = useCallback(async () => {
    if (!service) return;
    const scope = workspacePath;
    const current = await service.start();
    const available = await service.listModels();
    if (selection.current.workspacePath !== scope) return;
    setHealth(current);
    setModels(available);
    setModelKey((previous) =>
      available.some((item) => `${item.provider}/${item.model}` === previous)
        ? previous
        : available[0]
          ? `${available[0].provider}/${available[0].model}`
          : "",
    );
  }, [service, workspacePath]);
  const report = (failure: unknown) =>
    setError(failure instanceof Error ? failure.message : String(failure));

  useEffect(() => {
    setProjection(emptyProjection());
    setApproval(null);
    setError("");
    setPending(false);
    void refresh().catch(report);
  }, [refresh]);
  useEffect(() => {
    if (!service) return;
    let active = true;
    const check = () =>
      void service
        .health()
        .then((value) => {
          if (active) setHealth(value);
        })
        .catch(report);
    const timer = setInterval(check, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [service]);
  useEffect(() => {
    if (!service) return;
    const listener = service.onEvent((event) => {
      if (event.generation < generation.current) return;
      generation.current = event.generation;
      if (event.type === "runtime") {
        setHealth(event.data as DshRuntimeHealth);
        return;
      }
      if (event.sessionId && event.sessionId !== selection.current.sessionId) return;
      if (event.type === "error") {
        setError(String(event.data));
        setPending(false);
        setProjection((old) => ({ ...old, busy: false }));
        return;
      }
      if (event.type === "approval") {
        setApproval(record(event.data));
        return;
      }
      if (event.type === "approval_end") {
        setApproval(null);
        return;
      }
      setProjection((old) => projectFrame(old, event.data));
      const native = record(record(event.data).event);
      if (native.type === "tool/result" || native.type === "turn/end") onRefreshGit();
      if (native.type === "turn/end") void refresh().catch(report);
    });
    return () => listener.dispose();
  }, [service, onRefreshGit, refresh]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [projection]);
  useEffect(() => {
    const handleModelsChanged = () => void refresh().catch(report);
    window.addEventListener("dcode:dsh-models-changed", handleModelsChanged);
    return () => window.removeEventListener("dcode:dsh-models-changed", handleModelsChanged);
  }, [refresh]);
  useEffect(() => {
    const handleRestarted = () => {
      void refresh().catch(report);
      onRefreshSessions();
      if (selection.current.sessionId) void openSession(selection.current.sessionId);
    };
    window.addEventListener("dcode:dsh-runtime-restarted", handleRestarted);
    return () => window.removeEventListener("dcode:dsh-runtime-restarted", handleRestarted);
  }, [refresh, onRefreshSessions]);

  async function openSession(id: string) {
    if (!service || !id) return;
    const scope = workspacePath;
    loadedSessionRef.current = `${scope}\0${id}`;
    selection.current = { workspacePath: scope, sessionId: id };
    setProjection(emptyProjection());
    setError("");
    setApproval(null);
    setPending(true);
    try {
      const snapshot = await service.resumeSession(id);
      if (selection.current.sessionId === id && selection.current.workspacePath === scope) {
        setProjection((old) =>
          old.cursor > Number(record(snapshot).cursor) ? old : projectFrame(old, snapshot),
        );
        const pendingApproval = record(record(snapshot).pendingApproval);
        if (pendingApproval.requestId) setApproval(pendingApproval);
      }
    } catch (failure) {
      if (selection.current.sessionId === id && selection.current.workspacePath === scope)
        report(failure);
    } finally {
      if (selection.current.sessionId === id && selection.current.workspacePath === scope)
        setPending(false);
    }
  }
  useEffect(() => {
    const key = selectedSessionId ? `${workspacePath}\0${selectedSessionId}` : "";
    if (!key) {
      loadedSessionRef.current = "";
      setProjection(emptyProjection());
      setApproval(null);
      setError("");
      setPending(false);
      return;
    }
    if (selectedSessionId && loadedSessionRef.current !== key) void openSession(selectedSessionId);
  }, [selectedSessionId, workspacePath]);
  async function send() {
    if (!service || !draft.trim() || pending || projection.busy) return;
    setPending(true);
    setError("");
    try {
      let id = selectedSessionId;
      if (!id) {
        const created = await service.createSession(workspacePath, model);
        id = created.id;
        onSessionCreated(id);
        await openSession(id);
        onRefreshSessions();
      }
      setPending(true);
      await service.sendMessage(id, draft, model);
      setDraft("");
      await refresh();
    } catch (failure) {
      report(failure);
    } finally {
      setPending(false);
    }
  }
  async function answer(allowed: boolean) {
    if (!service || !approval) return;
    try {
      if (selectedSessionId)
        await service.respondApproval(selectedSessionId, String(approval.requestId), allowed);
      setApproval(null);
    } catch (failure) {
      report(failure);
    }
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-ui-base" data-testid="dcode-chat">
      {(error || projection.error || health.error) && (
        <div role="alert" className="mx-auto mt-4 flex w-full max-w-[840px] items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui-sm text-destructive">
          <span>{error || projection.error || health.error}</span>
          <Button size="sm" variant="ghost" onClick={() =>
            selectedSessionId ? void openSession(selectedSessionId) : void refresh().catch(report)
          }>{copy.retry}</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="dcode-messages">
        <div className={`mx-auto flex min-h-full w-full max-w-[840px] flex-col px-5 pb-6 ${projection.rows.length ? "pt-6" : "justify-center"}`}>
          {!projection.rows.length && (
            <div className="mx-auto w-full max-w-[720px] pb-8" data-testid="dsh-empty-state">
              <img src={appLogoUrl} alt="" className="mb-6 size-12 rounded-xl" />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">{copy.welcome}</h2>
              <p className="mt-2 text-ui-base text-foreground-subtle">{copy.welcomeDescription}</p>
              <div data-testid="dsh-project-chip" className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-surface/50 px-3 py-1.5 text-ui-xs text-foreground-subtle" title={workspacePath}>
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate">{copy.project} · {workspaceName}</span>
              </div>
              <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {copy.suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.title}
                    onClick={() => { setDraft(suggestion.prompt); composerInputRef.current?.focus(); }}
                    className="group flex min-h-16 items-start gap-2.5 rounded-xl border border-border/70 bg-surface/40 p-3 text-left text-ui-sm text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle group-hover:text-foreground" />
                    <span>{suggestion.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {displayRows.map((item) => Array.isArray(item) ? (
            <DshToolActivity key={item[0]?.id} rows={item} copy={copy} zh={zh} />
          ) : (
            <article key={item.id} className={`mb-6 flex ${item.kind === "user" ? "justify-end" : "gap-3"}`}>
              {item.kind === "assistant" && <img src={appLogoUrl} alt="" className="mt-0.5 size-7 shrink-0 rounded-lg" />}
              <div className={item.kind === "user"
                ? "max-w-[85%] rounded-2xl rounded-tr-md border border-border/70 bg-surface px-4 py-3 text-foreground"
                : "min-w-0 flex-1 pt-0.5"}>
                {item.kind === "assistant" && <div className="mb-2 text-ui-xs font-medium text-foreground-subtle">{copy.message}</div>}
                {item.thinking && (
                  <details className="mb-3 rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-ui-xs text-foreground-subtle">
                    <summary className="cursor-pointer">{copy.thinking}</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{item.thinking}</pre>
                  </details>
                )}
                {item.kind === "user" ? <p className="whitespace-pre-wrap break-words">{item.text}</p> : (
                  <MessageResponse streaming={item.id.startsWith("live:")} workspacePath={workspacePath}>{item.text}</MessageResponse>
                )}
              </div>
            </article>
          ))}
          {projection.busy && <p role="status" className="flex items-center gap-2 text-ui-xs text-foreground-subtle"><span className="size-1.5 animate-pulse rounded-full bg-brand" />{copy.working}</p>}
          <div ref={bottom} />
        </div>
      </div>
      {approval && (
        <div className="mx-auto w-full max-w-[840px] px-5 pb-2" data-testid="dsh-approval-card">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-lg/10">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" />{copy.permission}</div>
            <p className="mt-2 text-ui-sm text-foreground-subtle">{approvalDescription}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void answer(true)}>{copy.allowOnce}</Button>
              <Button size="sm" variant="outline" onClick={() => void answer(false)}>{copy.reject}</Button>
            </div>
          </div>
        </div>
      )}
      <form
        className="shrink-0 px-5 pb-4 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="mx-auto w-full max-w-[840px] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_10px_36px_rgba(0,0,0,0.12)] focus-within:border-foreground-subtle">
          <textarea
            ref={composerInputRef}
            data-testid="dsh-message-input"
            aria-label={zh ? "消息" : "Message"}
            className="block min-h-20 max-h-48 w-full resize-none bg-transparent px-4 pt-3 text-ui-base leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.prompt}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span data-testid="dsh-current-workspace" title={workspacePath} className="hidden max-w-28 shrink-0 items-center gap-1.5 truncate border-r border-border/70 pr-2 text-ui-xs text-foreground-subtle md:flex">
                <FolderOpen className="size-3.5 shrink-0" /><span className="truncate">{workspaceName}</span>
              </span>
              <select
                data-testid="dsh-model-select"
                aria-label={zh ? "模型" : "Model"}
                className="max-w-52 truncate rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-ui-xs text-foreground outline-none hover:bg-surface-hover"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                disabled={projection.busy}
              >
                {!models.length && <option value="">{copy.noModels}</option>}
                {models.map((item) => (
                  <option
                    key={`${item.provider}/${item.model}`}
                    value={`${item.provider}/${item.model}`}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="flex shrink-0 items-center gap-1.5 text-ui-xs text-foreground-subtle" role="status">
                <span className={`size-1.5 rounded-full ${health.state === "ready" ? "bg-green-500" : "bg-amber-500"}`} />
                {health.state === "ready" ? copy.ready : copy.connecting}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button data-testid="dsh-view-changes" type="button" size="sm" variant="ghost" className="gap-1.5 text-foreground-subtle" onClick={onOpenDiff}>
                <FileDiff className="size-3.5" />{copy.viewChanges}
              </Button>
              {projection.busy ? (
                <Button
                  data-testid="dsh-stop"
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    selectedSessionId && void service?.cancel(selectedSessionId).catch(report)
                  }
                >
                  {copy.stop}
                </Button>
              ) : (
                <Button
                  data-testid="dsh-send"
                  type="submit"
                  size="sm"
                  className="gap-1.5 rounded-lg"
                  disabled={pending || !draft.trim() || health.state !== "ready"}
                >
                  {copy.send}<ArrowUp className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="mx-auto mt-1.5 hidden max-w-[840px] text-right text-ui-xs text-foreground-subtlest sm:block">{copy.hint}</p>
      </form>
    </section>
  );
}
