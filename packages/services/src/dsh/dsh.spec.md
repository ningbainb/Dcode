# Desktop DSH service

The DSH backend owns sessions, transcripts, permissions and models. This service delegates
to the public DCode runtime package, exposes typed methods through the existing RPC graph,
and forwards session events through one emitter. It stores no accepted conversation state.
Only the Host owns the backend lifecycle. Renderer callers cannot select arbitrary RPC routes.
Host shutdown awaits stop; an unexpected transport close produces a visible error event.
Only desktop-local service assembly starts the runtime eagerly; other service containers
must not launch an unused DSH process during their own initialization.

The DSH UI is enabled only when this service exists. Existing ZCode service contracts remain
available for workspace/editor/Git/terminal functionality. The DSH panel uses its own history
from DSH, not ZCode task-index persistence.
Desktop's existing New Chat action opens a fresh DSH composer without creating a
parallel ZCode session. The first send creates the DSH session; New Session in the
panel creates it immediately. Tool-backed fixture verification covers Stop mid-stream.
Plugin-injected catalogs/context are not human messages and must not appear as "You".
Tool parameters and stdout render immediately as plain text inside the existing Tool card,
without waiting for syntax-highlighting workers. Settings/bootstrap paths use .dcode,
including the settings migration path; no existing .zcode directory is reused.
