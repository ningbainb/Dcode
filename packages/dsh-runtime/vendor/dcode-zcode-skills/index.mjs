import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
