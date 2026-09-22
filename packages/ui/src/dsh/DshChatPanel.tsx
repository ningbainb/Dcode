import { useCallback, useEffect, useRef, useState } from "react";
import type { DshModel, DshRuntimeHealth, DshSession } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { Button } from "@/components/ui/button.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool.js";
import { emptyProjection, projectFrame, record } from "./projection.js";
import { DshSettings } from "./DshSettings.js";

export function DshChatPanel({ workspacePath, onRefreshGit, onOpenDiff, draftRequest = 0 }: {
  draftRequest?: number;
  workspacePath: string;
  onRefreshGit: () => void;
  onOpenDiff: () => void;
}) {
  const { dshService: service } = useServices();
  const platform = usePlatform();
  const [health, setHealth] = useState<DshRuntimeHealth>({ state: "starting", generation: 0 });
  const [models, setModels] = useState<DshModel[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [sessions, setSessions] = useState<DshSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [draft, setDraft] = useState("");
  const [projection, setProjection] = useState(emptyProjection);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState<Record<string, unknown> | null>(null);
  const selection = useRef({ workspacePath, sessionId });
  selection.current = { workspacePath, sessionId };
  const bottom = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const model = models.find(item => `${item.provider}/${item.model}` === modelKey);

  const refresh = useCallback(async () => {
    if (!service) return;
    const scope = workspacePath;
    const current = await service.start();
    const [available, history] = await Promise.all([service.listModels(), service.listSessions(scope)]);
    if (selection.current.workspacePath !== scope) return;
    setHealth(current); setModels(available); setSessions(history);
    setModelKey(previous => previous || (available[0] ? `${available[0].provider}/${available[0].model}` : ""));
  }, [service, workspacePath]);
  const report = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure));

  useEffect(() => {
    setSessionId(""); setProjection(emptyProjection()); setApproval(null); setError(""); setPending(false);
    void refresh().catch(report);
  }, [refresh, draftRequest]);
  useEffect(() => {
    if (!service) return;
    let active = true;
    const check = () => void service.health().then(value => { if (active) setHealth(value); }).catch(report);
    const timer = setInterval(check, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [service]);
  useEffect(() => {
    if (!service) return;
    const listener = service.onEvent(event => {
      if (event.generation < generation.current) return;
      generation.current = event.generation;
      if (event.type === "runtime") { setHealth(event.data as DshRuntimeHealth); return; }
      if (event.sessionId && event.sessionId !== selection.current.sessionId) return;
      if (event.type === "error") { setError(String(event.data)); setPending(false); setProjection(old => ({ ...old, busy: false })); return; }
      if (event.type === "approval") { setApproval(record(event.data)); return; }
      if (event.type === "approval_end") { setApproval(null); return; }
      setProjection(old => projectFrame(old, event.data));
      const native = record(record(event.data).event);
      if (native.type === "tool/result" || native.type === "turn/end") onRefreshGit();
      if (native.type === "turn/end") void refresh().catch(report);
    });
    return () => listener.dispose();
  }, [service, onRefreshGit, refresh]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [projection]);

  async function openSession(id: string) {
    if (!service || !id) return;
    const scope = workspacePath;
    selection.current = { workspacePath: scope, sessionId: id };
    setSessionId(id); setProjection(emptyProjection()); setError(""); setApproval(null); setPending(true);
    try {
      const snapshot = await service.resumeSession(id);
      if (selection.current.sessionId === id && selection.current.workspacePath === scope) {
        setProjection(old => old.cursor > Number(record(snapshot).cursor) ? old : projectFrame(old, snapshot));
      }
    } catch (failure) { report(failure); } finally { setPending(false); }
  }
  async function newSession() {
    if (!service) return;
    setPending(true); setError("");
    try {
      const created = await service.createSession(workspacePath, model);
      await refresh(); await openSession(created.id);
    } catch (failure) { report(failure); } finally { setPending(false); }
  }
  async function send() {
    if (!service || !draft.trim() || pending || projection.busy) return;
    setPending(true); setError("");
    try {
      let id = sessionId;
      if (!id) { const created = await service.createSession(workspacePath, model); id = created.id; await openSession(id); }
      setPending(true);
      await service.sendMessage(id, draft, model);
      setDraft(""); await refresh();
    } catch (failure) { report(failure); } finally { setPending(false); }
  }
  async function restart() {
    if (!service) return;
    setPending(true); setError("");
    try { setHealth(await service.restart()); await refresh(); if (sessionId) await openSession(sessionId); }
    catch (failure) { report(failure); } finally { setPending(false); }
  }
  async function answer(allowed: boolean) {
    if (!service || !approval) return;
    try { await service.respondApproval(sessionId, String(approval.requestId), allowed); setApproval(null); }
    catch (failure) { report(failure); }
  }
  return <section className="flex h-full min-h-0 flex-col text-ui-base" data-testid="dcode-chat">
    <header className="flex flex-wrap items-center gap-2 border-b p-3">
      <strong>Dcode</strong><span className="text-foreground-subtle" role="status">DSH · {health.state === "ready" ? "Connected" : health.state}</span>
      <Button size="sm" variant="outline" onClick={() => void restart()} disabled={pending}>Restart Runtime</Button>
      <Button size="sm" variant="ghost" onClick={() => void service?.getLogsPath().then(path => platform.openExternalFile?.(path)).catch(report)}>Open Logs</Button>
      <Button size="sm" variant="outline" onClick={onOpenDiff}>View Diff</Button>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <Button size="sm" onClick={() => void newSession()} disabled={pending || projection.busy}>New Session</Button>
      <select aria-label="Session History" className="min-w-0 flex-1 rounded border bg-background p-2" value={sessionId} onChange={event => void openSession(event.target.value)} disabled={pending}>
        <option value="">Session History</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <select aria-label="Model" className="max-w-72 rounded border bg-background p-2" value={modelKey} onChange={event => setModelKey(event.target.value)} disabled={projection.busy}>
        {!models.length && <option value="">No models available</option>}
        {models.map(item => <option key={`${item.provider}/${item.model}`} value={`${item.provider}/${item.model}`}>{item.label}</option>)}
      </select>
    </div>
    {(error || projection.error || health.error) && <div role="alert" className="border-b p-3 text-destructive">{error || projection.error || health.error}<Button size="sm" variant="ghost" onClick={() => sessionId ? void openSession(sessionId) : void refresh().catch(report)}>Retry</Button></div>}
    <DshSettings onSaved={() => void refresh().catch(report)} />
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="dcode-messages">
      {!projection.rows.length && <div className="py-10 text-center text-foreground-subtle"><h2 className="text-ui-xl font-semibold">AI Coding Workspace</h2><p>Powered by DeepSeek Harness</p><p className="mt-3 break-all">{workspacePath}</p><p>Choose a model and describe a code change.</p></div>}
      {projection.rows.map(row => row.kind === "tool" ? <Tool key={row.id} defaultOpen>
        <ToolHeader type="dynamic-tool" toolName={row.name ?? "Tool"} state={row.state ?? "input-available"} />
        <ToolContent>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-3">{row.input}</pre>
          {/* 命令输出必须立即可见，不等待通用 CodeBlock 的异步语法高亮。 */}
          {row.text && <ToolOutput output={<pre className="whitespace-pre-wrap break-all p-3">{row.text}</pre>} errorText={row.state === "output-error" ? row.text : undefined} />}
        </ToolContent>
      </Tool> : <article key={row.id} className="mb-5">
        <div className="mb-1 font-medium">{row.kind === "user" ? "You" : "DeepSeek Harness"}</div>
        {row.thinking && <details className="mb-2 text-foreground-subtle"><summary>Thinking</summary><pre className="whitespace-pre-wrap">{row.thinking}</pre></details>}
        <MessageResponse streaming={row.id.startsWith("live:")} workspacePath={workspacePath}>{row.text}</MessageResponse>
      </article>)}
      {projection.busy && <p role="status">Agent working…</p>}<div ref={bottom} />
    </div>
    {approval && <div className="border-t p-3"><p>Permission required: {String(approval.reason ?? approval.description ?? "Review this tool operation")}</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(approval, null, 2)}</pre><Button onClick={() => void answer(true)}>Allow once</Button><Button variant="outline" onClick={() => void answer(false)}>Reject</Button></div>}
    <form className="flex gap-2 border-t p-3" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea aria-label="Message" className="min-h-20 flex-1 resize-none rounded border bg-background p-2" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Dcode to read or modify this project…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {projection.busy ? <Button type="button" variant="outline" onClick={() => void service?.cancel(sessionId).catch(report)}>Stop</Button> : <Button type="submit" disabled={pending || !draft.trim() || health.state !== "ready"}>Send</Button>}
    </form>
  </section>;
}
