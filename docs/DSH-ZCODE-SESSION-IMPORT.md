# ZCode session import into DCode

## Behavior and ownership

DCode Desktop offers an optional, local-only import from the current user's ZCode
SQLite session store. A first-run prompt appears only when readable source sessions
exist. Settings → Import conversations remains available later. Scan shows titles,
source workspaces and dates; the user explicitly selects sessions. Source files are
opened read-only and never migrated in place.
ZCode's built-in conversation workspace maps to DCode's built-in conversation
workspace; ordinary project paths remain unchanged.

The DCode import archive owns copied historical rows and an idempotence index keyed
by source session ID. It stores a full local copy of each selected message and part,
plus a readable text and tool activity projection. Full source rows remain in the
local archive. The DSH controller remains the sole owner of live sessions, model
runs and approvals. Imported archive entries have a distinct ID prefix and source
badge. They remain read-only after a separate native DSH session is created.

```text
ZCode SQLite (read-only) → scan/selection → DCode import archive → sidebar/archive reader
                                              │
                                              └─ explicit Continue → DCode adapter → DSH native event seed
                                                                         │
                                                                         └─ DSH owns session and persistence
```

The continuation button converts archived ZCode rows into a balanced DSH event
seed: original user and assistant roles, assistant tool-call blocks, matching tool
results and ZCode compaction summaries. It creates a fresh native DSH session in the
same workspace through a DCode-owned profile plugin, then opens that session. Neither
scan, archive import nor native session creation sends a model request. The first
subsequent user prompt uses DSH's derived history. Historical tools are never rerun.

The DCode adapter owns conversion and bounded context selection; full source rows
remain in the archive. It keeps opening user messages, compaction summaries and
recent complete messages within the budget, treating a tool call and result as one
unit. Images and file attachments without portable DSH bytes become placeholders.
Source system/developer prompts, credentials, approvals and hidden reasoning do not
become active instructions. The UI reports omitted messages and degraded attachment
blocks before continuation.

The plugin's loopback import route accepts only a POST from the DCode runtime with
its per-launch private bridge token. The token is passed through the owned DSH
process environment and is never persisted or included in imported history.

## Failure and privacy semantics

Missing or incompatible source databases yield an empty scan or a clear error.
Import is per-session and atomic: write a temporary archive file, rename it, then
make it discoverable. Re-importing an already copied source ID is skipped; repeating an
import cannot duplicate sidebar entries. Late scan responses cannot replace a new
workspace selection. No source data is uploaded by the import operation, logged,
or mixed with GitHub cloud backup automatically.

## Plugin compatibility decision

The [dsh-plugin-session-import](https://github.com/huguangyu666/dsh-plugin-session-import)
plugin (MIT, reviewed at `3d4c7342ec7b96a03549d76a4babc02dc5e8a5c5`) directly reads
ZCode's `db.sqlite` and demonstrates native DSH seed mapping, tool-result pairing,
compaction-summary recovery and workspace binding. Its published package declares
`@deepseek-ai/dsh >=0.1.0-rc.6`; DCode pins `0.1.6-alpha.2`, whose agent metadata
contract differs. DCode therefore uses a small profile-local plugin and a mapper
for its existing read-only archive. The external plugin is research and design
reference, not an unverified runtime dependency or a second user-facing UI.

## Acceptance

- First-run prompt is dismissible; Settings remains discoverable.
- Scan and import selected root sessions, including text from both roles, while
  leaving ZCode's SQLite database unchanged.
- Imported sessions appear under their source workspace and reopen after restart.
- Re-import skips duplicates. A corrupt archive or missing workspace reports a
  useful error without altering ZCode or DSH session storage.
- Continue creates a native DSH session only on click, with typed, balanced events
  and no synthetic prompt. The session survives DSH restart and accepts the next
  user message with its imported history and ordinary tools available.
- A completed tool call has a matching DSH call/result pair; an incomplete source
  call is marked interrupted, never silently considered done.
- Oversized history and attachment degradation are reported accurately; the local
  archive still retains every copied source row.
