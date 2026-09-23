import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(DESKTOP_ROOT, "../..");
const DSH_PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-mcp-client",
  "@deepseek-ai/dsh-web-app",
];

export function resolveDcodeRuntimeDeploy() {
  const manifestBytes = readFileSync(resolve(WORKSPACE_ROOT, "packages/dsh-runtime/package.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const versions = DSH_PACKAGES.map((name) => manifest.dependencies?.[name]);
  if (versions.some((version) => typeof version !== "string" || version !== versions[0]))
    throw new Error("Dcode runtime DSH packages must share one exact version.");
  const lockBytes = readFileSync(resolve(WORKSPACE_ROOT, "pnpm-lock.yaml"));
  const digest = createHash("sha256").update(manifestBytes).update(lockBytes).digest("hex").slice(0, 12);
  const directoryName = `dcode-runtime-${versions[0]}-${digest}`;
  return {
    version: versions[0],
    directoryName,
    target: resolve(DESKTOP_ROOT, directoryName),
    deployRelativePath: `packages/desktop/${directoryName}`,
  };
}
