# DCode conversation annotations and reading font

## Ownership and behavior

The DSH runtime owns conversation annotations for each DSH session. The UI projects
DSH's existing transcript and sends annotation commands through `IDshService`; it
never stores a second transcript. Each annotation has a session ID, stable DSH
event message ID, role, selected quote, rendered-text offset, source message text,
comment, timestamps, status, and a session-local monotonic number. The runtime
persists the records atomically in its data directory. Existing file code comments
and their prompt format remain unchanged; both features use a selected quote plus
comment and display the attachment count near the composer.

Only completed `event:*` messages can be annotated. A selection belongs to one
message; live stream rows, tool rows, reasoning and composer input are excluded.
If the source message changes, the annotation is retained but its anchor is marked
invalid, rather than moved to unrelated text. A deleted message's annotations are
removed when the caller explicitly deletes that message. Session ID keys prevent
cross-session leakage. Numbering is never reused after deletion.

The composer shows unsent annotations for the active session. On prompt admission,
the runtime reads those annotations, appends numbered source/quote/comment context
to the outgoing prompt, and marks them sent only after DSH accepts the prompt.
The user's visible draft remains unchanged. A failed admission retains the pending
annotations. Explicit annotation IDs may select a subset, including previously
sent annotations. Session switching reloads the list from the runtime.

The existing `AppSettings` owner stores only the chat reading font size and family.
The controls live in Settings → Appearance under a separate conversation reading
section, alongside the existing interface and code preview typography settings.
Defaults preserve today's appearance; the CSS scope contains only message text,
not the editor, terminal, file tree, composer, or application zoom.

```text
selection -> DSH chat UI -> IDshService -> DshBackend -> session annotation file
composer send -------------------------------> read pending + DSH prompt
AppSettings -> useSettings -> chat text CSS scope
```

## Acceptance

- User and assistant completed messages support multiple numbered annotations.
- Quote, author, message ID and timestamps persist across restart and remain in
  their own session; editing/deleting an annotation updates the composer count.
- Markdown/code rendering and stream rows are not mutated by highlighting.
- The Agent receives the exact quote and comment when the user sends a prompt;
  failed prompts do not silently consume annotations.
- Settings → Appearance changes only chat message text; settings survive restart.
