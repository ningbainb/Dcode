import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import chokidar from "chokidar";
import { parse as parseYaml } from "yaml";

export const name = "dcode-zcode-skills";
export const inject = ["skills"];

const PROVIDER = "dcode-zcode";
const MAX_DEPTH = 8;
const EXCLUDED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
]);
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PLUGIN_MANIFESTS = [".zcode-plugin", ".claude-plugin", ".codex-plugin"];
// Keep in sync with packages/shared/src/plugin-marketplaces.ts: ZCode enables these official plugins by default.
const DEFAULT_OFFICIAL_PLUGIN_IDS = new Set(
  [
    "browser-use",
    "image-search",
    "documents",
    "pdf",
    "presentations",
    "spreadsheets",
    "node-repl-host",
    "skill-creator",
    "plugin-creator",
    "zcode-guide",
  ].map((name) => `${name}@zcode-plugins-official`),
);

function homePath() {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}

function normalizedPath(path) {
  return path.replaceAll("\\", "/");
}

function skillName(raw, path) {
  if (NAME.test(raw)) return raw;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (NAME.test(slug)) return slug;
  return `zcode-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readPluginRoots(homeDir) {
  let config = {};
  try {
    config = JSON.parse(await readFile(join(homeDir, ".zcode", "cli", "config.json"), "utf8"));
  } catch {
    /* Missing or invalid config has no installed plugin roots. */
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
  const plugins =
    config.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins)
      ? config.plugins
      : {};
  if (plugins.enabled === false) return [];
  const enabled =
    plugins.enabledPlugins && typeof plugins.enabledPlugins === "object"
      ? plugins.enabledPlugins
      : {};
  const suppressed = new Set(
    Array.isArray(plugins.suppressedBuiltins) ? plugins.suppressedBuiltins : [],
  );
  const storage =
    typeof config.storage?.dir === "string" && config.storage.dir.trim()
      ? config.storage.dir.trim()
      : "~/.zcode";
  const storageRoot = storage.startsWith("~/") ? join(homeDir, storage.slice(2)) : resolve(storage);
  const cliRoot = basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
  const pluginStorage = join(cliRoot, "plugins");
  const candidates = [];
  for (const dir of Array.isArray(plugins.dirs) ? plugins.dirs : []) {
    if (typeof dir !== "string" || !dir.trim()) continue;
    candidates.push({
      path: dir.startsWith("~/") ? join(homeDir, dir.slice(2)) : resolve(dir),
      marketplace: "inline",
      defaultEnabled: true,
    });
  }
  const officialCache = join(pluginStorage, "cache", "zcode-plugins-official");
  try {
    for (const plugin of await readdir(officialCache, { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      for (const version of await readdir(join(officialCache, plugin.name), {
        withFileTypes: true,
      })) {
        if (version.isDirectory())
          candidates.push({
            path: join(officialCache, plugin.name, version.name),
            marketplace: "zcode-plugins-official",
            defaultEnabled: false,
          });
      }
    }
  } catch {
    /* Official cache is optional. */
  }
  try {
    const installed = JSON.parse(
      await readFile(join(pluginStorage, "installed_plugins.json"), "utf8"),
    );
    for (const item of Array.isArray(installed?.plugins) ? installed.plugins : []) {
      if (
        typeof item?.installPath === "string" &&
        isAbsolute(item.installPath) &&
        typeof item.marketplace === "string" &&
        item.marketplace.trim()
      ) {
        candidates.push({
          path: item.installPath,
          marketplace: item.marketplace,
          defaultEnabled: false,
        });
      }
    }
  } catch {
    /* Installed plugin records are optional. */
  }
  const roots = [];
  const seen = new Set();
  for (const candidate of candidates) {
    let manifest;
    for (const dir of PLUGIN_MANIFESTS) {
      try {
        manifest = JSON.parse(await readFile(join(candidate.path, dir, "plugin.json"), "utf8"));
        break;
      } catch {
        /* Try the next supported plugin manifest. */
      }
    }
    if (
      !manifest ||
      typeof manifest.name !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.name)
    )
      continue;
    const id = `${manifest.name}@${candidate.marketplace}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (candidate.marketplace === "zcode-plugins-official" && suppressed.has(id)) continue;
    if ((enabled[id] ?? (candidate.defaultEnabled || DEFAULT_OFFICIAL_PLUGIN_IDS.has(id))) !== true)
      continue;
    const declared =
      manifest.skills === undefined
        ? ["skills"]
        : typeof manifest.skills === "string"
          ? [manifest.skills]
          : Array.isArray(manifest.skills)
            ? manifest.skills
            : [];
    let canonicalPluginRoot;
    try {
      canonicalPluginRoot = await realpath(candidate.path);
    } catch {
      continue;
    }
    for (const item of declared) {
      if (typeof item !== "string" || isAbsolute(item)) continue;
      const path = resolve(candidate.path, item);
      const rel = relative(candidate.path, path);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      try {
        const canonicalPath = await realpath(path);
        const canonicalRel = relative(canonicalPluginRoot, canonicalPath);
        if (
          canonicalRel === ".." ||
          canonicalRel.startsWith(`..${sep}`) ||
          isAbsolute(canonicalRel)
        )
          continue;
        roots.push({ path, source: "plugin-zcode", rank: 550 + roots.length / 100 });
      } catch {
        /* A missing or unreadable plugin skill root contributes no skills. */
      }
    }
  }
  return roots;
}

async function rootsFor(cwd, homeDir) {
  const roots = [];
  if (cwd) {
    const start = resolve(cwd);
    let current = start;
    let foundGit = false;
    while (true) {
      roots.push({
        path: join(current, ".zcode", "skills"),
        source: "project-zcode",
        rank: 150 + roots.length / 100,
      });
      if (await exists(join(current, ".git"))) {
        foundGit = true;
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!foundGit) roots.splice(1);
  }
  roots.push({ path: join(homeDir, ".zcode", "skills"), source: "user-zcode", rank: 450 });
  roots.push(...(await readPluginRoots(homeDir)));
  return roots;
}

async function* skillFiles(root, signal) {
  const stack = [{ path: root, depth: 0 }];
  const visitedLinks = new Set();
  while (stack.length) {
    signal?.throwIfAborted();
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current.path, entry.name);
      if (entry.name === "SKILL.md" && !entry.isDirectory()) yield path;
      if (
        current.depth >= MAX_DEPTH ||
        EXCLUDED.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".system")
      )
        continue;
      if (entry.isDirectory()) stack.push({ path, depth: current.depth + 1 });
      else if (entry.isSymbolicLink()) {
        try {
          if (!(await stat(path)).isDirectory()) continue;
          const target = await realpath(path);
          if (visitedLinks.has(target)) continue;
          visitedLinks.add(target);
          stack.push({ path, depth: current.depth + 1 });
        } catch {
          // Broken links do not invalidate another skill in the same root.
        }
      }
    }
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true" || value === "yes") return true;
  if (value === 0 || value === "0" || value === "false" || value === "no") return false;
  throw new TypeError("Invalid skill invocation flag.");
}

function parseSkill(markdown, path) {
  const text = markdown.replace(/\r\n|\r/g, "\n");
  let metadata = {};
  let body = text.trim();
  if (text.startsWith("---\n")) {
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!match) return null;
    try {
      metadata = parseYaml(match[1]);
    } catch {
      return null;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    body = text.slice(match[0].length).trim();
  }
  const originalName =
    typeof metadata.name === "string" && metadata.name.trim()
      ? metadata.name.trim()
      : basename(dirname(path));
  const name = skillName(originalName, path);
  const firstLine = body
    .split("\n")
    .find((line) => line.trim())
    ?.replace(/^#+\s*/, "")
    .trim();
  const description = (
    typeof metadata.description === "string" && metadata.description.trim()
      ? metadata.description.trim()
      : firstLine || `ZCode skill ${originalName}`
  ).slice(0, 1024);
  const displayDescription =
    name === originalName ? description : `${description} (ZCode name: ${originalName})`;
  let invocation;
  try {
    invocation = {
      modelInvocable: !parseBoolean(metadata["disable-model-invocation"], false),
      userInvocable: parseBoolean(metadata["user-invocable"], true),
    };
  } catch {
    return null;
  }
  return { name, description: displayDescription, content: body, invocation };
}

async function disabledPaths(homeDir) {
  let config;
  try {
    config = JSON.parse(await readFile(join(homeDir, ".zcode", "cli", "config.json"), "utf8"));
  } catch {
    return new Set();
  }
  const entries =
    config && typeof config.skills === "object" && !Array.isArray(config.skills)
      ? Object.entries(config.skills)
      : [];
  return new Set(
    entries.filter(([, value]) => value?.enable === false).map(([path]) => normalizedPath(path)),
  );
}

export function createZcodeSkillProvider({ homeDir = homePath() } = {}, control) {
  const resolvedHome = resolve(homeDir);
  const watched = new Set();
  let watcher;
  let watcherReady = false;
  let watcherOpening;

  async function observeRoots(roots) {
    if (!control) return false;
    const paths = [
      ...roots.map((root) => root.path),
      ...roots.map((root) => dirname(root.path)),
      join(resolvedHome, ".zcode"),
      join(resolvedHome, ".zcode", "cli", "config.json"),
      join(resolvedHome, ".zcode", "cli", "plugins"),
      join(resolvedHome, ".zcode", "cli", "plugins", "installed_plugins.json"),
    ];
    const additions = paths.filter((path) => !watched.has(path));
    for (const path of additions) watched.add(path);
    if (!watcher) {
      watcher = chokidar.watch(paths, {
        ignoreInitial: true,
        persistent: false,
        depth: MAX_DEPTH,
        followSymlinks: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      });
      watcher.on("all", () => control.invalidate());
      watcher.on("error", () => {
        watcherReady = false;
        control.invalidate();
      });
      watcherOpening = new Promise((done) => {
        const timeout = setTimeout(() => done(false), 5000);
        timeout.unref?.();
        watcher.once("ready", () => {
          clearTimeout(timeout);
          watcherReady = true;
          control.invalidate();
          done(true);
        });
        watcher.once("error", () => {
          clearTimeout(timeout);
          done(false);
        });
      });
    } else if (additions.length) {
      watcher.add(additions);
    }
    if (!watcherReady) await watcherOpening;
    return watcherReady;
  }

  return {
    name: PROVIDER,
    async list(options = {}) {
      const candidates = [];
      const disabled = await disabledPaths(resolvedHome);
      const roots = await rootsFor(options.cwd, resolvedHome);
      const complete = await observeRoots(roots);
      for (const root of roots) {
        for await (const sourcePath of skillFiles(root.path, options.signal)) {
          try {
            const path = await realpath(sourcePath);
            if (disabled.has(normalizedPath(path))) continue;
            const parsed = parseSkill(await readFile(path, "utf8"), path);
            if (!parsed) continue;
            candidates.push({
              name: parsed.name,
              description: parsed.description,
              invocation: parsed.invocation,
              source: root.source,
              rank: root.rank,
              provider: PROVIDER,
              locator: { path, root: root.path },
              resourceBase: { kind: "directory", path: dirname(path) },
              path,
            });
          } catch {
            options.signal?.throwIfAborted();
          }
        }
      }
      return { candidates, complete };
    },
    async get(candidate, options = {}) {
      options.signal?.throwIfAborted();
      if (!candidate?.locator?.path || !candidate?.locator?.root) return undefined;
      const roots = await rootsFor(options.cwd, resolvedHome);
      if (!roots.some((root) => root.path === candidate.locator.root)) return undefined;
      if ((await disabledPaths(resolvedHome)).has(normalizedPath(candidate.locator.path)))
        return undefined;
      try {
        const parsed = parseSkill(
          await readFile(candidate.locator.path, "utf8"),
          candidate.locator.path,
        );
        if (!parsed || parsed.name !== candidate.name) return undefined;
        return {
          ...parsed,
          source: candidate.source,
          provider: PROVIDER,
          resourceBase: candidate.resourceBase,
          path: candidate.path,
        };
      } catch {
        options.signal?.throwIfAborted();
        return undefined;
      }
    },
    async dispose() {
      await watcher?.close();
    },
  };
}

export function apply(ctx) {
  let provider;
  ctx.skills.registerProvider((control) => {
    provider = createZcodeSkillProvider({}, control);
    return provider;
  });
  ctx.effect(function* () {
    yield async () => provider.dispose();
  }, "dcode-zcode-skills watcher");
}
