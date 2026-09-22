# DSH workspace conversation ownership

The DSH backend owns accepted sessions, messages, model execution and approvals. Desktop UI
keeps only the current workspace's selected session ID and a read-only session list. A DSH
session ID must not be passed to the legacy ZCode task service or stored as its task ID.

Workspace identity keys selection, with the path as a fallback. Changing projects must not
apply a late session-list response to the new project. The sidebar and chat read the same
selection; the sidebar lists only DSH sessions for the active local project. A new task
starts a draft and creates one DSH session when the first message is sent. Selection is
restored on app restart when that ID still exists in the DSH list.

DSH events update the selected session only. On turn completion, refresh the index so
new titles appear in the sidebar. Reconnect and restore use backend snapshots and their
cursor rather than a second persistent transcript. Project links, Git/Diff and cloud backup
retain their existing owners.

Acceptance: create two sessions from the sidebar, switch between them and projects, send
in each, restart the app, restore the chosen session, and verify no cross-session messages
or approvals. Existing desktop file/tool/terminal and GitHub backup behavior still works.
