import type { DshSession } from "@zcode/services";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Archive, MessageSquareText, Search } from "lucide-react";
import { useState } from "react";

export function DshSessionList({
  sessions,
  selectedId,
  loading,
  error,
  onSelect,
}: {
  sessions: DshSession[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const [query, setQuery] = useState("");
  const displayTitle = (session: DshSession) =>
    session.title === "New Session"
      ? intl.formatMessage({ id: "workspaceSidebar.newConversation" })
      : session.title;
  const visibleSessions = sessions.filter((session) =>
    displayTitle(session).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div data-testid="dsh-session-list" className="space-y-1 px-1 pb-2">
      {sessions.length > 0 && (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-foreground-subtle">
          <Search className="size-3.5 shrink-0 text-foreground-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={locale.startsWith("zh") ? "搜索会话" : "Search conversations"}
            placeholder={locale.startsWith("zh") ? "搜索会话" : "Search conversations"}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-ui-sm text-foreground outline-none placeholder:text-foreground-subtle"
          />
        </label>
      )}
      {error ? (
        <p role="alert" className="px-3 py-2 text-ui-xs text-destructive">
          {error}
        </p>
      ) : null}
      {loading && sessions.length === 0 ? (
        <p role="status" className="px-3 py-2 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "common.loading" })}
        </p>
      ) : null}
      {!loading && sessions.length === 0 ? (
        <p className="px-3 py-2 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "workspaceSidebar.noConversations" })}
        </p>
      ) : null}
      {sessions.length > 0 && visibleSessions.length === 0 && (
        <p className="px-3 py-2 text-ui-xs text-foreground-subtle">
          {locale.startsWith("zh") ? "没有匹配的会话" : "No matching conversations"}
        </p>
      )}
      <ul className="space-y-0.5">
        {visibleSessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              data-testid="dsh-session-item"
              data-session-id={session.id}
              aria-current={selectedId === session.id ? "page" : undefined}
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground",
                selectedId === session.id && "bg-selected font-medium text-foreground",
              )}
              title={displayTitle(session)}
              onClick={() => onSelect(session.id)}
            >
              {session.source === "zcode" ? (
                <Archive className="size-3.5 shrink-0 opacity-70" />
              ) : (
                <MessageSquareText className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">{displayTitle(session)}</span>
              {session.source === "zcode" && (
                <span className="shrink-0 rounded border border-border px-1 text-ui-xs text-foreground-subtle">
                  ZCode
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
