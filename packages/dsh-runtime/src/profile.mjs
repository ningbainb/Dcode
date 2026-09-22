import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeManagedMcpPatch } from "./agent-plugins.mjs";

const require = createRequire(import.meta.url);
export const PROFILE_NAME = "dcode";

// The official bundle resolver owns the runtime dependency graph. Only the Coding
// base and its public session/model gateway are composed. The DCode import bridge
// is a local profile bundle; it never changes the user's standalone DSH profile.
export async function ensureDcodeProfile(dshHome, nodeExecutable = process.execPath) {
  const profileDir = join(dshHome, "profiles", PROFILE_NAME);
  await mkdir(profileDir, { recursive: true });
  const bridgeName = "dcode-zcode-session-import";
  const bridgeRoot = fileURLToPath(
    new URL("../vendor/dcode-zcode-session-import/", import.meta.url),
  );
  const bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", bridgeName];
  const linkedPackages = [...bundles, "@deepseek-ai/dsh-mcp-client"];
  const packageRoots = Object.fromEntries(
    linkedPackages.map((name) => [
      name,
      name === bridgeName ? bridgeRoot : dirname(require.resolve(`${name}/package.json`)),
    ]),
  );
  const dependencies = Object.fromEntries(
    linkedPackages.map((name) => [name, `file:${packageRoots[name].replaceAll("\\", "/")}`]),
  );
  const manifest = {
    name: "dcode-runtime-profile",
    private: true,
    type: "module",
    dependencies,
    dsh: { profile: { bundles } },
  };
  await writeFile(join(profileDir, "package.json"), JSON.stringify(manifest, null, 2));
  const { symlink, lstat } = await import("node:fs/promises");
  for (const name of linkedPackages) {
    const target = packageRoots[name];
    const link = join(profileDir, "node_modules", ...name.split("/"));
    await mkdir(dirname(link), { recursive: true });
    try {
      await lstat(link);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    }
  }
  for (const file of ["cordis.yml", "cordis.patch.yml"]) {
    const path = join(profileDir, file);
    try {
      await readFile(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(path, "[]\n");
    }
  }
  await writeManagedMcpPatch(profileDir, dirname(dshHome), nodeExecutable);
  return { profileDir, cliPath: require.resolve("@deepseek-ai/dsh/lib/bin.js") };
}
