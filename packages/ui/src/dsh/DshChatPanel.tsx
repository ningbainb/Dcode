import { useCallback, useEffect, useRef, useState } from "react";
import type { DshModel, DshRuntimeHealth } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { Button } from "@/components/ui/button.js";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group.js";
import { ShieldCheck } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool.js";
import { emptyProjection, projectFrame, record } from "./projection.js";

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
  const generation = useRef(0);
  const model = models.find((item) => `${item.provider}/${item.model}` === modelKey);
  const approvalDescription =
    typeof approval?.reason === "string"
      ? approval.reason
      : typeof approval?.description === "string"
        ? approval.description
        : "Review this tool operation before continuing.";

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
    <section className="flex h-full min-h-0 flex-col text-ui-base" data-testid="dcode-chat">
      {(error || projection.error || health.error) && (
        <div role="alert" className="border-b p-3 text-destructive">
          {error || projection.error || health.error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              selectedSessionId ? void openSession(selectedSessionId) : void refresh().catch(report)
            }
          >
            Retry
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="dcode-messages">
        {!projection.rows.length && (
          <div className="py-10 text-center text-foreground-subtle">
            <h2 className="text-ui-xl font-semibold">AI Coding Workspace</h2>
            <p>Powered by DeepSeek Harness</p>
            <p className="mt-3 break-all">{workspacePath}</p>
            <p>Choose a model and describe a code change.</p>
          </div>
        )}
        {projection.rows.map((row) =>
          row.kind === "tool" ? (
            <Tool key={row.id} defaultOpen={row.name === "pwsh"} className="mb-2 border-border/60">
              <ToolHeader
                type="dynamic-tool"
                toolName={row.name ?? "Tool"}
                state={row.state ?? "input-available"}
              />
              <ToolContent className="pt-0">
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-3">
                  {row.input}
                </pre>
                {/* 命令输出必须立即可见，不等待通用 CodeBlock 的异步语法高亮。 */}
                {row.text && (
                  <ToolOutput
                    output={<pre className="whitespace-pre-wrap break-all p-3">{row.text}</pre>}
                    errorText={row.state === "output-error" ? row.text : undefined}
                  />
                )}
              </ToolContent>
            </Tool>
          ) : (
            <article key={row.id} className="mb-5">
              <div className="mb-1 font-medium">
                {row.kind === "user" ? "You" : "DeepSeek Harness"}
              </div>
              {row.thinking && (
                <details className="mb-2 text-foreground-subtle">
                  <summary>Thinking</summary>
                  <pre className="whitespace-pre-wrap">{row.thinking}</pre>
                </details>
              )}
              <MessageResponse streaming={row.id.startsWith("live:")} workspacePath={workspacePath}>
                {row.text}
              </MessageResponse>
            </article>
          ),
        )}
        {projection.busy && <p role="status">Agent working…</p>}
        <div ref={bottom} />
      </div>
      {approval && (
        <div className="border-t p-3" data-testid="dsh-approval-card">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4" />
              Permission required
            </div>
            <p className="mt-2 text-ui-sm text-foreground-subtle">{approvalDescription}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void answer(true)}>
                Allow once
              </Button>
              <Button size="sm" variant="outline" onClick={() => void answer(false)}>
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
      <form
        className="border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <InputGroup className="overflow-hidden rounded-xl border-border/60 bg-card/60 shadow-sm">
          <InputGroupTextarea
            aria-label="Message"
            className="min-h-20"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask Dcode to read or modify this project…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <InputGroupAddon
            align="block-end"
            className="flex-wrap justify-between gap-2 border-t border-border/40"
          >
            <div className="flex min-w-0 items-center gap-2">
              <select
                aria-label="Model"
                className="max-w-56 truncate rounded-md bg-transparent px-2 py-1 text-ui-sm"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                disabled={projection.busy}
              >
                {!models.length && <option value="">No models available</option>}
                {models.map((item) => (
                  <option
                    key={`${item.provider}/${item.model}`}
                    value={`${item.provider}/${item.model}`}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-ui-xs text-foreground-subtle" role="status">
                {health.state === "ready" ? "Connected" : health.state}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={onOpenDiff}>
                View changes
              </Button>
              {projection.busy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    selectedSessionId && void service?.cancel(selectedSessionId).catch(report)
                  }
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || !draft.trim() || health.state !== "ready"}
                >
                  Send
                </Button>
              )}
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}
