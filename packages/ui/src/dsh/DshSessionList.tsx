import type { DshSession } from "@zcode/services";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

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
  const { intl } = useZCodeIntl();
  return (
    <div data-testid="dsh-session-list" className="space-y-1 px-1 pb-2">
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
      <ul className="space-y-0.5">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              data-testid="dsh-session-item"
              data-session-id={session.id}
              aria-current={selectedId === session.id ? "page" : undefined}
              className={cn(
                "w-full truncate rounded-lg px-3 py-2 text-left text-ui-base text-foreground-subtle hover:bg-surface-hover hover:text-foreground",
                selectedId === session.id && "bg-selected text-foreground",
              )}
              title={session.title}
              onClick={() => onSelect(session.id)}
            >
              {session.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
