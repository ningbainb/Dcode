import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { staleDcodeBundleExclusions } from "./dcode-stale-bundle-filter.mjs";

test("packaging excludes old chunks and maps while retaining current JavaScript", async () => {
  const root = await mkdtemp(resolve(import.meta.dirname, "../../../.cache/dcode-filter-"));
  const out = join(root, "out");
  try {
    for (const directory of ["metadata", "main", "host", "preload"])
      await mkdir(join(out, directory), { recursive: true });
    await writeFile(join(out, "metadata/build-meta.json"), JSON.stringify({
      buildTime: "2026-09-23T09:30:00.000Z",
    }));
    const old = join(out, "main/old.js");
    const current = join(out, "host/current.js");
    await writeFile(old, "old");
    await writeFile(current, "current");
    await utimes(old, new Date("2026-09-23T09:00:00Z"), new Date("2026-09-23T09:00:00Z"));
    await utimes(current, new Date("2026-09-23T10:00:00Z"), new Date("2026-09-23T10:00:00Z"));
    const excluded = staleDcodeBundleExclusions(root);
    assert.ok(excluded.includes("!out/main/old.js"));
    assert.ok(excluded.includes("!out/**/*.map"));
    assert.ok(!excluded.includes("!out/host/current.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
