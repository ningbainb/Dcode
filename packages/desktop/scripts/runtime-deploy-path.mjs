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

export function resolveDcodeRuntimeDeploy({ platform = process.platform, arch = process.arch } = {}) {
  if (!/^(?:win32|darwin|linux)$/.test(platform) || !/^(?:x64|arm64)$/.test(arch))
    throw new Error(`Unsupported Dcode runtime target: ${platform}-${arch}`);
  const manifestBytes = readFileSync(resolve(WORKSPACE_ROOT, "packages/dsh-runtime/package.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const versions = DSH_PACKAGES.map((name) => manifest.dependencies?.[name]);
  if (versions.some((version) => typeof version !== "string" || version !== versions[0]))
    throw new Error("Dcode runtime DSH packages must share one exact version.");
  const lockBytes = readFileSync(resolve(WORKSPACE_ROOT, "pnpm-lock.yaml"));
  const digest = createHash("sha256").update(manifestBytes).update(lockBytes).digest("hex").slice(0, 12);
  // A physical deployment contains a Node binary and native modules for the
  // host target. Never reuse its ready marker across operating systems or CPUs.
  const directoryName = `dcode-runtime-${versions[0]}-${platform}-${arch}-${digest}`;
  return {
    version: versions[0],
    platform,
    arch,
    directoryName,
    target: resolve(DESKTOP_ROOT, directoryName),
    deployRelativePath: `packages/desktop/${directoryName}`,
  };
}
