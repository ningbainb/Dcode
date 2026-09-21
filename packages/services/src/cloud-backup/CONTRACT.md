# Desktop cloud backup

The cloud-backup service owns configuration, durable snapshot/upload state and scheduling.
UI calls its typed descriptor through a hook. DSH remains the sole Agent runtime.
Desktop-local Windows is supported; other hosts return unsupported and never schedule work.

Authentication uses Git Credential Manager's browser flow, isolated namespace and DPAPI
files inside DCode data. This replaces the proposed gh login because gh's keyring namespace
does not isolate accounts by GH_CONFIG_DIR. Never alter global Git/gh configuration.
No token, device code or credential output is logged or returned to the renderer.

Per project: off -> preview -> confirm private destination -> capture -> queued -> upload -> idle.
Only confirmation enables automatic backup. Current disk contents include uncommitted files;
the original HEAD/index/remotes are never written. A separate bare Git repository owns snapshots.
No parent link to source history. No hooks, filters, force pushes or remote deletions.
Excluded paths and blocked files are visible in preview. Secrets, large files, symlinks and
submodule/LFS limitations are handled before upload; preview fingerprint must match activation.

Durable per-project state is protected by a cross-process lock, including upload and config edits.
Operations serialize; toggling off takes effect after an in-flight operation completes. UI shows pending.
On restart timers resume durable pending snapshots. Success is only recorded after remote confirmation.
Manual backup bypasses scheduled backoff. Account identity is rechecked before each upload.
One project/device branch prevents automatic cross-device overwrites. Existing destinations must be
private and marked as DCode backup repositories. Public/rules-protected/changed targets fail closed.
Restore always creates a new directory, with validated regular file paths; never overwrites a project.
Reading existing cloud snapshots fetches only snapshot refs from the validated private repository.
Imported projects remain disabled/unapproved until a separate file preview and upload confirmation.
Cloud history is bounded to the newest 100 commits for the first recovery listing.

Acceptance: real Git tests for staged/unstaged/new/deleted files, exclusions, stable/no-change trees,
source index immutability, queue retry, restart, account mismatch, public target, and safe restoration.
GitHub adapter tests use injected HTTP/process boundaries; no automatic live account login/upload.
Desktop UI uses existing settings cards/rows/switch/select/button, semantic tokens and both locales.
