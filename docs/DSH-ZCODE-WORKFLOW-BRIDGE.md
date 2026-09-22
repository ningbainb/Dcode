# DSH conversation workflow bridge

## Behavior and ownership

The DSH backend remains the only owner of accepted prompts, turn execution,
queue order, transcript, and session metadata. ZCode's Desktop conversation UI
may keep unsent text in memory, keyed by workspace path and DSH session ID. A
new-conversation draft uses a separate key. Switching sessions or workspaces
must restore the matching draft without showing another session's text. A draft
is cleared only after its exact text has been accepted; failed submission keeps
it. Drafts are not written to legacy ZCode task storage or treated as accepted
messages. This follows the current v4 composer's in-memory draft boundary.

DSH `session/prompt` already accepts `mode: queue`. While a turn is active, the
composer keeps its Send action available beside Stop; it submits through the
same `IDshService.sendMessage` command. The renderer may show a short accepted
toast, but it must not maintain its own accepted queue or infer order from local
button clicks. Stop still calls DSH `session/cancel`. A pending command prevents
duplicate submission. Busy follow-ups do not reselect a model mid-turn. A late response from a previously selected session must
not mutate the newly selected session's annotations, error state, or draft.
Escape in the focused composer uses the same DSH cancellation command while a
turn is active. Completed user and assistant messages reuse ZCode's compact
copy action; live partial text does not advertise a completed-message action.

The sidebar filters the DSH session list by its already loaded title, locally
and case-insensitively. It does not create a separate history index or issue
extra runtime queries. An empty filtered result is distinct from an empty
workspace. Selection remains owned by the existing workspace-session hook. A
project change resets the filter.

The existing ZCode shell already supplies the project sidebar, file and Git
surfaces, change viewer, cloud backup settings, theme and typography; DSH does
not need replacements for those surfaces. DSH-backed conversation annotations,
plugin toggles, models, approvals and cancellation are already connected through
their own service contracts. ZCode's legacy task queue editing, attachment
uploads and CLI-only modes have different accepted-state owners and are not
silently routed to DSH sessions; each needs a DSH-native capability contract
before it can be exposed here.

```text
composer draft (UI, keyed by workspace/session) --send--> IDshService
                                                   |
                                                   v
                                        DSH prompt admission + queue
                                                   |
                                                   v
                                      DSH event stream / UI projection

DSH session list --> sidebar title filter --> visible rows
```

## Acceptance

- Switching between two sessions, a new draft, and another project never mixes
  unsent text; a failed send retains the exact draft.
- A busy session can accept a follow-up through DSH's existing queue mode;
  Send and Stop remain distinct actions. Repeated clicks during admission do
  not create duplicate prompts.
- A late response for session A cannot clear session B's draft or annotation
  selection.
- Session search filters titles without changing the selected session or
  losing the original list.
