# DCode v0.1

AI Coding Workspace powered by DeepSeek Harness, based on ZCode.

## Development

Node 24.14.0 and pnpm 10.33.2. From this repository:

```powershell
pnpm install
pnpm dev
```

The workspace root also provides `dev.ps1` to keep development data and caches inside the workspace.

The DSH panel provides model settings, model selection, new sessions, session history, streamed messages, tools, permissions, cancellation and Runtime restart. Existing ZCode file, Git/Diff and terminal surfaces are retained.

## Validation

`pnpm typecheck`, `pnpm lint`, `pnpm test:dcode`.
The runtime fixture test is `node packages/dsh-runtime/test/agent-e2e.mjs`; set `DCODE_TEST_ROOT` to an isolated path. It uses a deterministic model server and the real DSH runtime. It is not a live-provider acceptance test.

## Attribution

Based on [ZCode](https://github.com/zai-org/ZCode), Apache-2.0. Original notices, license and [README](docs/upstream/ZCode-README.md) are retained.
DSH lifecycle files are reused from [DeepSeek Harness Desktop](https://github.com/ningbainb/deepseek-harness-desktop), BSD-3-Clause; see packages/dsh-runtime/vendor/PROVENANCE.md and LICENSE. Official DeepSeek Harness packages retain their upstream licenses.
