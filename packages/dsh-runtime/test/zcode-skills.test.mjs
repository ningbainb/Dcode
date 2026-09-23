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
