# DSH adapter boundary

DSH is the sole owner of sessions, transcripts, tools, models and permissions.
Model-provider settings use DSH `settings/describe` for redacted reads,
`settings/mutate` with expected revision for one provider path, and DSH
credentials for keys. The UI owns only an unsaved draft. See
`docs/DSH-MODEL-PROVIDER-SETTINGS.md`; legacy ZCode provider settings are not
reused as a write path.
The optional ZCode import archive is a separate DCode-owned, read-only copy of historical
sessions. Its IDs are distinct from DSH IDs; only explicit continuation converts a
bounded, typed event seed and asks the DCode profile plugin to create a native DSH
session. The plugin is scoped to this profile and its loopback import route requires
a per-launch bridge token. See `docs/DSH-ZCODE-SESSION-IMPORT.md`.
The Desktop service forwards commands and emits runtime/session events. The UI only
projects these events and discards responses belonging to a previously selected workspace.

Runtime lifecycle is reused from DeepSeek Harness Desktop at commit
`d2dd1a8077d06f119e2cc3f8a06dc39495f48940`. Its controller and support files are vendored
with their license. DCode supplies a minimal profile composed from official NPM packages.
No upstream DSH source is modified. No existing DSH user profile is read or written.

The Dcode Agent plugin state is owned by `DshBackend` in its own data directory.
An opt-in Playwright MCP server provides isolated browser control. An opt-in
Windows GUI MCP server provides Windows UI Automation after installing its
Python runtime in a Dcode-specific virtual environment. Only Dcode-marked rows
of the profile patch are generated; unrelated user rows are retained. Changes
restart DSH, so an active turn may be interrupted. The ZCode plugin settings
are a different runtime and are not presented as DSH Agent tools.

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

Packaging keeps the physical DSH deployment outside app.asar. The application archive
contains only the desktop package's external production dependency closure; workspace
UI/service source dependencies are already bundled and must not pull a duplicate DSH
or browser dependency tree into the archive. Existing native/closure checks still run.
Before packaging, validate renderer entry references and record its complete file list.
After packaging, verify every renderer file is present in app.asar. Windows executable
resources use DCode branding and version 0.1.0 while retaining upstream legal notices.
The local desktop development server binds IPv4 loopback explicitly so disabled IPv6
does not leave Electron waiting for a server that is unreachable from its launcher.
Windows Explorer registration is opt-in through DCODE_ENABLE_EXPLORER_MENU=1 and uses
an independent DCode registry key; starting a development/portable app never overwrites ZCode's menu.
The physical runtime node_modules directory is an explicit resource root, bypassing
Electron Builder's default exclusion of nested node_modules. Its bundled Node executable
must load the backend and resolve all entry dependencies strictly inside the shipped directory.
The packaging gate also imports official runtime plugins, detecting corrupted transitive JavaScript before Desktop launch.
# Conversation annotations

`DshBackend` owns persisted annotations keyed by DSH session ID and durable
`event:*` message ID. The UI reads and edits through `IDshService`; it never
persists a transcript. `sendMessage` attaches pending annotations to the DSH
prompt and marks them sent only after prompt admission. See
`docs/DSH-CONVERSATION-ANNOTATIONS.md` for lifecycle and font setting rules.
