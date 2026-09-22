/** Unsent composer text belongs to a workspace and a DSH session, never a ZCode task. */
export function draftScopeKey(workspacePath: string, sessionId: string | null): string {
  return JSON.stringify([workspacePath, sessionId]);
}

export function promoteDraftToSession(
  drafts: Record<string, string>,
  draftKey: string,
  sessionKey: string,
): Record<string, string> {
  if (draftKey === sessionKey || !(draftKey in drafts)) return drafts;
  const next = { ...drafts, [sessionKey]: drafts[sessionKey] ?? drafts[draftKey]! };
  delete next[draftKey];
  return next;
}

export function clearDraftIfUnchanged(
  drafts: Record<string, string>,
  scopeKey: string,
  submittedText: string,
): Record<string, string> {
  if (drafts[scopeKey] !== submittedText) return drafts;
  const next = { ...drafts };
  delete next[scopeKey];
  return next;
}
