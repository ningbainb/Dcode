import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createZcodeSkillProvider } from "../vendor/dcode-zcode-skills/index.mjs";

async function fixture() {
  const root = resolve(import.meta.dirname, "../../../.cache/zcode-skills-test", randomUUID());
  const homeDir = join(root, "home");
  const workspace = join(root, "repo", "nested");
  const projectSkill = join(workspace, ".zcode", "skills", "code-review", "SKILL.md");
  const userSkill = join(homeDir, ".zcode", "skills", "My_Skill", "SKILL.md");
  await mkdir(join(root, "repo", ".git"), { recursive: true });
  await mkdir(join(workspace, ".zcode", "skills", "code-review"), { recursive: true });
  await mkdir(join(homeDir, ".zcode", "skills", "My_Skill"), { recursive: true });
  await writeFile(
    projectSkill,
    "---\nname: code-review\ndescription: Review source code.\n---\nUse the review checklist.\n",
  );
  await writeFile(userSkill, "# My skill\nUse the shared checklist.\n");
  return { root, homeDir, workspace, projectSkill, userSkill };
}

test("DSH skill provider discovers workspace and user ZCode skills, then loads instructions", async () => {
  const { homeDir, workspace } = await fixture();
  const provider = createZcodeSkillProvider({ homeDir });
  const observation = await provider.list({ cwd: workspace });
  assert.equal(observation.complete, false);
  assert.deepEqual(observation.candidates.map((item) => item.name).sort(), [
    "code-review",
    "my-skill",
  ]);
  const project = observation.candidates.find((item) => item.name === "code-review");
  const user = observation.candidates.find((item) => item.name === "my-skill");
  assert.ok(project.rank < user.rank);
  assert.match((await provider.get(project, { cwd: workspace })).content, /review checklist/);
  assert.match((await provider.get(user, { cwd: workspace })).description, /My_Skill/);
});

test("ZCode disabled skill is absent from DSH's next catalog and load", async () => {
  const { homeDir, workspace, projectSkill } = await fixture();
  const provider = createZcodeSkillProvider({ homeDir });
  const first = await provider.list({ cwd: workspace });
  const candidate = first.candidates.find((item) => item.name === "code-review");
  assert.ok(candidate);
  const configFile = join(homeDir, ".zcode", "cli", "config.json");
  await mkdir(join(homeDir, ".zcode", "cli"), { recursive: true });
  await writeFile(
    configFile,
    JSON.stringify({ skills: { [projectSkill.replaceAll("\\", "/")]: { enable: false } } }),
  );
  const second = await provider.list({ cwd: workspace });
  assert.equal(
    second.candidates.some((item) => item.name === "code-review"),
    false,
  );
  assert.equal(await provider.get(candidate, { cwd: workspace }), undefined);
  assert.equal(
    second.candidates.some((item) => item.name === "my-skill"),
    true,
  );
});

test("invalid skill is skipped without hiding other skills", async () => {
  const { homeDir, workspace, projectSkill } = await fixture();
  await writeFile(projectSkill, "---\nname: broken\ndescription: [invalid\n---\nBad YAML\n");
  const provider = createZcodeSkillProvider({ homeDir });
  const observation = await provider.list({ cwd: workspace });
  assert.deepEqual(
    observation.candidates.map((item) => item.name),
    ["my-skill"],
  );
});

test("enabled installed plugin skills reach DSH and follow ZCode plugin state", async () => {
  const { root, homeDir, workspace } = await fixture();
  const pluginRoot = join(root, "review-plugin");
  const pluginSkill = join(pluginRoot, "skills", "plugin-review", "SKILL.md");
  const pluginStorage = join(homeDir, ".zcode", "cli", "plugins");
  const configFile = join(homeDir, ".zcode", "cli", "config.json");
  await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "plugin-review"), { recursive: true });
  await mkdir(pluginStorage, { recursive: true });
  await writeFile(
    join(pluginRoot, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "review-plugin" }),
  );
  await writeFile(
    pluginSkill,
    "---\nname: plugin-review\ndescription: Plugin review.\n---\nPLUGIN_REVIEW_BODY\n",
  );
  await writeFile(
    join(pluginStorage, "installed_plugins.json"),
    JSON.stringify({
      plugins: [
        { id: "review-plugin@test-market", marketplace: "test-market", installPath: pluginRoot },
      ],
    }),
  );
  await writeFile(
    configFile,
    JSON.stringify({ plugins: { enabledPlugins: { "review-plugin@test-market": true } } }),
  );
  const provider = createZcodeSkillProvider({ homeDir });
  const first = await provider.list({ cwd: workspace });
  const candidate = first.candidates.find((item) => item.name === "plugin-review");
  assert.ok(candidate);
  assert.equal(candidate.source, "plugin-zcode");
  assert.match((await provider.get(candidate, { cwd: workspace })).content, /PLUGIN_REVIEW_BODY/);
  await writeFile(
    configFile,
    JSON.stringify({ plugins: { enabledPlugins: { "review-plugin@test-market": false } } }),
  );
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some(
      (item) => item.name === "plugin-review",
    ),
    false,
  );
  assert.equal(await provider.get(candidate, { cwd: workspace }), undefined);
});

test("plugin skill manifest cannot escape its plugin root and global disable applies", async () => {
  const { root, homeDir, workspace } = await fixture();
  const pluginRoot = join(root, "unsafe-plugin");
  const escapedSkill = join(root, "escaped", "SKILL.md");
  const configFile = join(homeDir, ".zcode", "cli", "config.json");
  await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
  await mkdir(join(root, "escaped"), { recursive: true });
  await mkdir(join(homeDir, ".zcode", "cli"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "unsafe-plugin", skills: "../escaped" }),
  );
  await writeFile(escapedSkill, "---\nname: escaped\ndescription: Escape.\n---\nNever load.\n");
  await writeFile(configFile, JSON.stringify({ plugins: { dirs: [pluginRoot] } }));
  const provider = createZcodeSkillProvider({ homeDir });
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some((item) => item.name === "escaped"),
    false,
  );
  await writeFile(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "unsafe-plugin", skills: "skills" }),
  );
  await mkdir(join(pluginRoot, "skills", "valid"), { recursive: true });
  await writeFile(
    join(pluginRoot, "skills", "valid", "SKILL.md"),
    "---\nname: valid-plugin\ndescription: Valid.\n---\nLoad me.\n",
  );
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some(
      (item) => item.name === "valid-plugin",
    ),
    true,
  );
  await writeFile(configFile, JSON.stringify({ plugins: { enabled: false, dirs: [pluginRoot] } }));
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some(
      (item) => item.name === "valid-plugin",
    ),
    false,
  );
});

test("official default plugin skills disappear when the plugin is suppressed", async () => {
  const { homeDir, workspace } = await fixture();
  const pluginRoot = join(
    homeDir,
    ".zcode",
    "cli",
    "plugins",
    "cache",
    "zcode-plugins-official",
    "documents",
    "1.0.0",
  );
  const configFile = join(homeDir, ".zcode", "cli", "config.json");
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "doc-review"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "documents" }),
  );
  await writeFile(
    join(pluginRoot, "skills", "doc-review", "SKILL.md"),
    "---\nname: doc-review\ndescription: Document review.\n---\nCheck docs.\n",
  );
  const provider = createZcodeSkillProvider({ homeDir });
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some((item) => item.name === "doc-review"),
    true,
  );
  await mkdir(join(homeDir, ".zcode", "cli"), { recursive: true });
  await writeFile(
    configFile,
    JSON.stringify({ plugins: { suppressedBuiltins: ["documents@zcode-plugins-official"] } }),
  );
  assert.equal(
    (await provider.list({ cwd: workspace })).candidates.some((item) => item.name === "doc-review"),
    false,
  );
});

test("creating the ZCode enable config invalidates DSH's complete catalog", async () => {
  const { homeDir, workspace, projectSkill } = await fixture();
  let invalidations = 0;
  const provider = createZcodeSkillProvider({ homeDir }, { invalidate: () => invalidations++ });
  try {
    assert.equal((await provider.list({ cwd: workspace })).complete, true);
    invalidations = 0;
    await mkdir(join(homeDir, ".zcode", "cli"), { recursive: true });
    await writeFile(
      join(homeDir, ".zcode", "cli", "config.json"),
      JSON.stringify({
        skills: { [projectSkill.replaceAll("\\", "/")]: { enable: false } },
      }),
    );
    const deadline = Date.now() + 5000;
    while (invalidations === 0 && Date.now() < deadline) await delay(50);
    assert.ok(invalidations > 0, "creating a previously absent config must invalidate the catalog");
    assert.equal(
      (await provider.list({ cwd: workspace })).candidates.some(
        (item) => item.name === "code-review",
      ),
      false,
    );
  } finally {
    await provider.dispose();
  }
});

test("creating the first workspace ZCode skill invalidates a cached DSH catalog", async () => {
  const root = resolve(import.meta.dirname, "../../../.cache/zcode-skills-test", randomUUID());
  const homeDir = join(root, "home");
  const workspace = join(root, "project");
  await mkdir(homeDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  let invalidations = 0;
  const provider = createZcodeSkillProvider({ homeDir }, { invalidate: () => invalidations++ });
  try {
    assert.equal((await provider.list({ cwd: workspace })).complete, true);
    invalidations = 0;
    const skillDir = join(workspace, ".zcode", "skills", "fresh-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: fresh-skill\ndescription: New skill.\n---\nHello.\n",
    );
    const deadline = Date.now() + 5000;
    while (invalidations === 0 && Date.now() < deadline) await delay(50);
    assert.ok(invalidations > 0, "creating a previously absent root must invalidate the catalog");
    assert.equal(
      (await provider.list({ cwd: workspace })).candidates.some(
        (item) => item.name === "fresh-skill",
      ),
      true,
    );
  } finally {
    await provider.dispose();
  }
});
