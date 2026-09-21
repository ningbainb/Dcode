# DSH adapter boundary

DSH is the sole owner of sessions, transcripts, tools, models and permissions.
The Desktop service forwards commands and emits runtime/session events. The UI only
projects these events and discards responses belonging to a previously selected workspace.

Runtime lifecycle is reused from DeepSeek Harness Desktop at commit
`d2dd1a8077d06f119e2cc3f8a06dc39495f48940`. Its controller and support files are vendored
with their license. DCode supplies a minimal profile composed from official NPM packages.
No upstream DSH source is modified. No existing DSH user profile is read or written.

Startup: ensure profile -> controller.start -> authenticated health -> ready.
Stop: cancel active work -> controller.stop. Restart creates a new generation; previous
stream subscribers must close. Errors are surfaced and never replaced by fake answers.

Development data and logs are inside the workspace. Packaged default data is DCode-specific.
Models are obtained from DSH; model connectivity failures are reported as failures.

Acceptance scenarios: concurrent start is idempotent; startup failure is recoverable;
session history survives runtime restart; workspace and model selection reach the agent;
events stream before completion; cancellation settles; file changes refresh the existing
ZCode file/Git surfaces; UI cannot send unbounded arbitrary IPC method names.

Each session has an independent presentation subscription because workspace panels remain
mounted in the background. Resuming one session replaces only its own subscription.
All subscriptions close on runtime stop. A failed stream open must clear its snapshot timer.
