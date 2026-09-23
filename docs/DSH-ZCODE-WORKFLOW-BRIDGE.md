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

The composer can attach PNG, JPEG, WebP and GIF images using DSH 0.1.7's native
`session/prompt` image parts. Dcode keeps selected files only in the unsent
draft for that workspace and session; admission clears the exact draft, while
failure preserves it. DSH owns image normalization, storage and the durable
attachment ID. The transcript projects the stored image reference, and opening
it reads the bytes through DSH `session/attachment` for that same session.
The picker follows DSH's default limits of 20 MiB per image, 20 images and
200 MiB per message; DSH remains the final validator. A provider must actually
support image input for the model request to succeed. Ordinary files, including
text and PDFs, use a separate picker and DSH 0.1.7's
`fileUploads/upload(sessionId, { data, name })` contract. Its result carries an
Agent-scoped `receiptId`; the same session's `session/prompt` then includes
`{ type: "file", receiptId }`. DSH persists the original bytes and the
transcript displays its durable file reference. File-only prompts are accepted.
The current base64 transport limits files to 10 MiB each, 10 files and 50 MiB
per message. Dcode retains the exact unsent files on upload or prompt failure,
and clears them only after admission. Larger streaming uploads and in-app file
preview are separate work; a file chip does not pretend to be a preview button.

The existing ZCode shell already supplies the project sidebar, file and Git
surfaces, change viewer, cloud backup settings, theme and typography; DSH does
not need replacements for those surfaces. DSH-backed conversation annotations,
plugin toggles, models, approvals and cancellation are already connected through
their own service contracts. ZCode's legacy task queue editing and CLI-only
modes have different accepted-state owners and are not
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
- An image-only prompt reaches the native DSH session; the attachment survives
  session restoration and can be opened through the same session's attachment
  route. Invalid images fail without clearing the unsent draft.
- A file-only prompt first receives a DSH upload receipt, then reaches the
  same native session; its stored file reference survives session restoration.
  Invalid or failed files leave the unsent draft in place.
