import { useCallback, useEffect, useRef, useState } from "react";
import type { DshSession } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

const SELECTION_STORAGE_PREFIX = "dcode:dsh:selected-session:";

function readSavedSelection(workspaceKey: string): string | null {
  try {
    return localStorage.getItem(`${SELECTION_STORAGE_PREFIX}${workspaceKey}`);
  } catch {
    return null;
  }
}

function saveSelection(workspaceKey: string, sessionId: string | null): void {
  try {
    const key = `${SELECTION_STORAGE_PREFIX}${workspaceKey}`;
    if (sessionId) localStorage.setItem(key, sessionId);
    else localStorage.removeItem(key);
  } catch {
    // Browser storage can be disabled. Keep the current in-memory selection usable.
  }
}

export function useDshWorkspaceSessions({
  enabled,
  workspacePath,
  workspaceIdentity,
}: {
  enabled: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { dshService } = useServices();
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const scopeRef = useRef(workspaceKey);
  scopeRef.current = workspaceKey;
  const requestRef = useRef(0);
  const [view, setView] = useState<{
    workspaceKey: string;
    sessions: DshSession[];
    selectedId: string | null;
    loading: boolean;
    error: string | null;
  }>({
    workspaceKey,
    sessions: [],
    selectedId: readSavedSelection(workspaceKey),
    loading: enabled,
    error: null,
  });
  const current = view.workspaceKey === workspaceKey ? view : null;

  const refresh = useCallback(async () => {
    if (!enabled || !dshService) return;
    const requestId = ++requestRef.current;
    const key = workspaceKey;
    setView((previous) =>
      previous.workspaceKey === key
        ? { ...previous, loading: true, error: null }
        : {
            workspaceKey: key,
            sessions: [],
            selectedId: readSavedSelection(key),
            loading: true,
            error: null,
          },
    );
    try {
      await dshService.start();
      const sessions = await dshService.listSessions(workspacePath);
      if (requestRef.current !== requestId || scopeRef.current !== key) return;
      setView((previous) => {
        const saved = previous.workspaceKey === key ? previous.selectedId : readSavedSelection(key);
        const selectedId = saved && sessions.some((session) => session.id === saved) ? saved : null;
        if (saved && !selectedId) saveSelection(key, null);
        return { workspaceKey: key, sessions, selectedId, loading: false, error: null };
      });
    } catch (error) {
      if (requestRef.current !== requestId || scopeRef.current !== key) return;
      setView((previous) => ({
        workspaceKey: key,
        sessions: previous.workspaceKey === key ? previous.sessions : [],
        selectedId: previous.workspaceKey === key ? previous.selectedId : null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [dshService, enabled, workspaceKey, workspacePath]);

  useEffect(() => {
    void refresh();
    return () => {
      ++requestRef.current;
    };
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !dshService) return;
    const subscription = dshService.onEvent((event) => {
      if (
        event.type === "event" &&
        (event.data as { event?: { type?: string } })?.event?.type === "turn/end"
      ) {
        void refresh();
      }
    });
    return () => subscription.dispose();
  }, [dshService, enabled, refresh]);

  const selectSession = useCallback(
    (sessionId: string | null) => {
      const key = workspaceKey;
      saveSelection(key, sessionId);
      setView((previous) =>
        previous.workspaceKey === key
          ? { ...previous, selectedId: sessionId }
          : { workspaceKey: key, sessions: [], selectedId: sessionId, loading: true, error: null },
      );
    },
    [workspaceKey],
  );

  const startDraftForWorkspace = useCallback(
    (path: string, identity?: string) => {
      const key = identity?.trim() || path;
      saveSelection(key, null);
      if (key === workspaceKey) selectSession(null);
    },
    [selectSession, workspaceKey],
  );

  return {
    sessions: current?.sessions ?? [],
    selectedSessionId:
      current?.loading && current.sessions.length === 0 ? null : (current?.selectedId ?? null),
    loading: current?.loading ?? enabled,
    error: current?.error ?? null,
    selectSession,
    startDraftForWorkspace,
    refresh,
  };
}
