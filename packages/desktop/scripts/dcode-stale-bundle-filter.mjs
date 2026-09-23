import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function staleDcodeBundleExclusions(desktopRoot) {
  const out = resolve(desktopRoot, "out");
  const metadata = JSON.parse(readFileSync(resolve(out, "metadata/build-meta.json"), "utf8"));
  const builtAfter = Date.parse(metadata.buildTime);
  if (!Number.isFinite(builtAfter)) throw new Error("Dcode build metadata has no valid build time");
  const exclusions = ["!out/**/*.map"];
  for (const directory of ["main", "host", "preload"]) {
    const root = resolve(out, directory);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      if (statSync(resolve(root, entry.name)).mtimeMs >= builtAfter) continue;
      // 旧构建的 chunk 即使留在 out，也不能随新安装包一起进入 app.asar。
      exclusions.push(`!out/${directory}/${entry.name}`);
    }
  }
  return exclusions;
}
