# Vendored lifecycle implementation

Source: https://github.com/ningbainb/deepseek-harness-desktop
Commit: d2dd1a8077d06f119e2cc3f8a06dc39495f48940
Original directory: apps/dsh-desktop/src
License: BSD-3-Clause, reproduced in LICENSE.

workspace-file-open-policy.mjs comes from packages/dsh-desktop-compat/lib/workspace-file-open-policy.js.
Local adaptation: controller imports that policy from this directory instead of the full
Desktop compatibility package. Lifecycle and shutdown behavior remain upstream-owned code.
