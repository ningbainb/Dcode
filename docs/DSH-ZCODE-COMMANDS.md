# ZCode custom commands in DSH conversations

The existing Commands settings service owns discovery, scope precedence, plugin state,
and enable flags. A local DSH composer reads that service only when the submitted text
starts with `/`. It expands an enabled Markdown command into a model prompt before the
existing DSH `session/prompt` admission. DSH remains the sole owner of accepted messages,
queue order, and transcript persistence. The composer retains the literal unsent command
until admission succeeds; it never stores a second accepted prompt or command queue.

```text
Commands settings -> ZCode command files + enable config
                                  |
composer submit -> commandsService.list(workspacePath) -> expand -> DSH session/prompt
```

Match the entire leading slash name, so `/review` cannot consume `/review-more`.
Project commands keep the existing service's precedence over user commands. Disabled
commands and commands from disabled plugins fail visibly before a new DSH session is
created; unknown slash text remains an ordinary message. `$ARGUMENTS` and `$1` onward
follow the ZCode command template convention; arguments without placeholders are
appended to the body. Shell interpolation (`!` backticks and ` ```! ` blocks) is rejected
because running those expressions in the renderer would cross the execution boundary.
The prompt identifies the command source, but sends no ZCode-specific runtime metadata.

On list or expansion failure the draft stays in the composer and DSH receives nothing.
The workspace path captured at submit selects the command catalog; later UI selection
changes do not redirect the accepted DSH send. This bridge does not claim support for
ZCode-only command hooks or shell interpolation. DSH-native UI commands are separate.

Acceptance: create a project Markdown command in Settings, invoke it in a DSH chat with
quoted and positional arguments, and inspect the model's received prompt. Disable it
in Settings and confirm a second invocation is blocked. Check unknown slash text,
busy-turn queuing, and failed admission without losing draft.
