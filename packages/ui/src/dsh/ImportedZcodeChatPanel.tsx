import { useEffect, useState } from "react";
import type { DshImportedZcodeSession } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Loader2 } from "lucide-react";
import appLogoUrl from "@/assets/dcode-logo.png";

export function ImportedZcodeChatPanel({
  workspacePath,
  sessionId,
  onSessionCreated,
  onRefreshSessions,
}: {
  workspacePath: string;
  sessionId: string;
  onSessionCreated: (id: string) => void;
  onRefreshSessions: () => void;
}) {
  const { dshService } = useServices();
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const [archive, setArchive] = useState<DshImportedZcodeSession | null>(null);
  const [error, setError] = useState("");
  const [continuing, setContinuing] = useState(false);
  useEffect(() => {
    let current = true;
    setArchive(null);
    setError("");
    void dshService
      ?.readImportedZcodeSession(sessionId)
      .then((result) => {
        if (current) setArchive(result);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      current = false;
    };
  }, [dshService, sessionId]);

  async function continueSession() {
    if (!dshService) return;
    setContinuing(true);
    setError("");
    try {
      const created = await dshService.continueImportedZcodeSession(sessionId, workspacePath);
      onSessionCreated(created.id);
      onRefreshSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setContinuing(false);
    }
  }

  return (
    <section
      data-testid="zcode-imported-chat"
      className="flex h-full min-h-0 flex-col bg-background text-ui-base"
    >
      <header className="border-b border-border px-5 py-3">
        <div className="mx-auto flex w-full max-w-[840px] flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-ui-xs text-foreground-subtle">
                {zh ? "来自 ZCode · 只读" : "From ZCode · read only"}
              </span>
              <h2 className="truncate text-ui-base font-medium text-foreground">
                {archive?.title}
              </h2>
            </div>
            <p className="mt-1 text-ui-xs text-foreground-subtle">
              {zh
                ? "继续时会创建原生 DSH 会话，保留可迁移的消息与工具结果。创建过程不会请求模型；发送下一条消息后，DSH 才会使用这些历史。"
                : "Continue creates a native DSH session with portable messages and tool results. The model sees that history when you send your next message."}
            </p>
            {archive?.continuation &&
              (archive.continuation.omittedMessages > 0 ||
                archive.continuation.degradedAttachments > 0) && (
                <p className="mt-1 text-ui-xs text-foreground-subtle" role="status">
                  {zh
                    ? `上下文预算省略 ${archive.continuation.omittedMessages} 条消息；${archive.continuation.degradedAttachments} 个附件仅保留占位说明。完整原始记录仍在本地归档。`
                    : `${archive.continuation.omittedMessages} messages omitted for context size; ${archive.continuation.degradedAttachments} attachments kept as placeholders. Full source rows remain in the local archive.`}
                </p>
              )}
          </div>
          <Button
            size="sm"
            disabled={!archive || continuing}
            onClick={() => void continueSession()}
          >
            {continuing && <Loader2 className="size-3.5 animate-spin" />}
            {zh ? "在 DCode 中继续" : "Continue in DCode"}
          </Button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="mx-auto w-full max-w-[840px] px-5 py-3 text-ui-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
        data-testid="zcode-imported-messages"
      >
        <div className="mx-auto w-full max-w-[840px]">
          {!archive && !error && (
            <p role="status" className="text-ui-sm text-foreground-subtle">
              {zh ? "正在加载历史会话…" : "Loading conversation…"}
            </p>
          )}
          {archive?.transcript.map((message) => (
            <article
              key={message.id}
              className={`mb-6 flex ${message.role === "user" ? "justify-end" : "gap-3"}`}
            >
              {message.role === "assistant" && (
                <img src={appLogoUrl} alt="" className="mt-0.5 size-7 shrink-0 rounded-lg" />
              )}
              <div
                className={
                  message.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-tr-md border border-border/70 bg-surface px-4 py-3 text-foreground"
                    : "min-w-0 flex-1 pt-0.5 text-foreground"
                }
              >
                {message.role === "assistant" && (
                  <div className="mb-2 text-ui-xs font-medium text-foreground-subtle">ZCode</div>
                )}
                <div className="whitespace-pre-wrap break-words text-ui-base leading-relaxed">
                  {message.text}
                </div>
                {message.tools?.map((tool) => (
                  <details
                    key={tool.id}
                    className="mt-2 rounded-lg border border-border/70 bg-surface/40 px-3 py-2 text-ui-xs text-foreground-subtle"
                  >
                    <summary className="cursor-pointer">
                      {tool.name}
                      {tool.title ? ` · ${tool.title}` : ""}
                      {tool.status ? ` · ${tool.status}` : ""}
                    </summary>
                    {tool.input && (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                        {tool.input}
                      </pre>
                    )}
                    {tool.output && (
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border/70 pt-2">
                        {tool.output}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
