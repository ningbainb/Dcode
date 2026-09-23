# DSH workspace conversation ownership

The DSH backend owns accepted sessions, messages, model execution and approvals. Desktop UI
keeps only the current workspace's selected session ID and a read-only session list. A DSH
session ID must not be passed to the legacy ZCode task service or stored as its task ID.
Imported ZCode archives are DCode-owned, read-only records with a distinct ID prefix in
that sidebar; they are not DSH sessions. See `docs/DSH-ZCODE-SESSION-IMPORT.md`.

Workspace identity keys selection, with the path as a fallback. Changing projects must not
apply a late session-list response to the new project. The sidebar and chat read the same
selection; the sidebar lists only DSH sessions for the active local project. A new task
starts a draft and creates one DSH session when the first message is sent. Selection is
restored on app restart when that ID still exists in the DSH list.

DSH events update the selected session only. On turn completion, refresh the index so
new titles appear in the sidebar. Reconnect and restore use backend snapshots and their
cursor rather than a second persistent transcript. Project links, Git/Diff and cloud backup
retain their existing owners.
DSH 0.1.7 emits tool results as a tool-role message with `toolCallId`, text `content`, and
message-level `isError`. The projection joins it to the preceding `tool/call` by ID,
including when reconstructing a snapshot; it also accepts the older nested
`tool-result` block for previously imported history. A failed tool result must stay
visibly failed rather than disappearing from the conversation.
For the DSH 0.1.7 Windows `SetNamedSecurityInfoW ... grantWrite(project)` failure,
the selected project's failed tool result shows an explicit ACL repair action. The UI
does not change permissions automatically, and it does not show a different project's
repair action after switching workspaces. After repair, the user retries the failed turn.

Acceptance: create two sessions from the sidebar, switch between them and projects, send
in each, restart the app, restore the chosen session, and verify no cross-session messages
or approvals. Existing desktop file/tool/terminal and GitHub backup behavior still works.

The UI owns only unsent composer drafts, keyed by workspace path and DSH session ID;
it never persists accepted prompts or a second queue. During an active turn,
follow-up sends use DSH's existing queued `sendMessage` admission. Stop and
composer Escape call the same DSH cancellation command. The sidebar filters
DSH-owned sessions locally by displayed title. Completed messages reuse
ZCode's copy action. See `docs/DSH-ZCODE-WORKFLOW-BRIDGE.md` for failure and
stale-response rules.

Images and ordinary files have separate composer buttons and per-session
unsent drafts. Image references can be reopened through DSH's attachment route;
file references show their stored names without claiming an in-app preview.
Submission clears only the exact accepted draft. A failed file upload or prompt
admission keeps the corresponding unsent selection available; an attachment
read error is reported without changing the session.
