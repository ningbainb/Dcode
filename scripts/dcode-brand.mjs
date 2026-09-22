import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const logo = resolve(root, 'packages/ui/src/components/ui/ZCodeAboutLogo.tsx');
const source = await readFile(logo, 'utf8');
const names = [...source.matchAll(/export function (\w+)/g)].map(match => match[1]);
await writeFile(logo, `import { cn } from "@/components/lib/utils.js";\nimport logoUrl from "@/assets/dcode-logo.png";\n\n${names.map(name => `export function ${name}({ className }: { className?: string }) {\n  return <img src={logoUrl} alt="Dcode" className={cn("shrink-0", className)} />;\n}`).join('\n\n')}\n`);
await mkdir(resolve(root, 'docs/upstream'), { recursive: true });
await copyFile(resolve(root, 'README.md'), resolve(root, 'docs/upstream/ZCode-README.md'), constants.COPYFILE_EXCL)
  .catch(error => { if (error.code !== 'EEXIST') throw error; });
await writeFile(resolve(root, 'README.md'), `# Dcode v0.1\n\nAI Coding Workspace powered by DeepSeek Harness, based on ZCode.\n\n## Development\n\nNode 24.14.0 and pnpm 10.33.2. From this repository:\n\n\x60\x60\x60powershell\npnpm install\npnpm dev\n\x60\x60\x60\n\nThe workspace root also provides \x60dev.ps1\x60 to keep development data and caches inside the workspace.\n\nThe DSH panel provides model settings, model selection, new sessions, session history, streamed messages, tools, permissions, cancellation and Runtime restart. Existing ZCode file, Git/Diff and terminal surfaces are retained.\n\n## Validation\n\n\x60pnpm typecheck\x60, \x60pnpm lint\x60, \x60pnpm test:dcode\x60.\nThe runtime fixture test is \x60node packages/dsh-runtime/test/agent-e2e.mjs\x60; set \x60DCODE_TEST_ROOT\x60 to an isolated path. It uses a deterministic model server and the real DSH runtime. It is not a live-provider acceptance test.\n\n## Attribution\n\nBased on [ZCode](https://github.com/zai-org/ZCode), Apache-2.0. Original notices, license and [README](docs/upstream/ZCode-README.md) are retained.\nDSH lifecycle files are reused from [DeepSeek Harness Desktop](https://github.com/ningbainb/deepseek-harness-desktop), BSD-3-Clause; see packages/dsh-runtime/vendor/PROVENANCE.md and LICENSE. Official DeepSeek Harness packages retain their upstream licenses.\n`);
