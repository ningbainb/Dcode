import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DshBackend } from "../src/index.mjs";
import { createFixture } from "./fixture.mjs";

const root = process.env.DCODE_TEST_ROOT
  ? resolve(process.env.DCODE_TEST_ROOT)
  : resolve(import.meta.dirname, "../../../.cache/zcode-skills-e2e");
await mkdir(root, { recursive: true });
const { workspace, server, requests, commands } = await createFixture(root);
const skillPath = join(workspace, ".zcode", "skills", "dcode-review", "SKILL.md");
await mkdir(join(workspace, ".zcode", "skills", "dcode-review"), { recursive: true });
await writeFile(
  skillPath,
  "---\nname: dcode-review\ndescription: DCODE_BRIDGED_SKILL\n---\nFollow the Dcode review checklist.\n",
);
const home = join(root, "home");
await mkdir(home, { recursive: true });
await mkdir(join(home, ".zcode", "cli"), { recursive: true });
await writeFile(join(home, ".zcode", "cli", "config.json"), "{}\n");
const previousHome = process.env.HOME;
process.env.HOME = home;
commands.splice(0, commands.length, ["skill", { name: "dcode-review" }]);
const backend = new DshBackend({ dataDir: root });
const events = [];
backend.on("event", (event) => {
  events.push(event);
  if (event.type === "approval")
    void backend.respondApproval(event.sessionId, event.data.requestId, true);
});

async function waitForTurn(sessionId) {
  const deadline = Date.now() + 120000;
  while (
    !events.some((event) => event.sessionId === sessionId && event.data?.event?.type === "turn/end")
  ) {
    if (Date.now() > deadline) throw new Error("DSH skill turn did not finish within 120 seconds");
    await delay(100);
  }
}

try {
  await backend.configureProvider({
    provider: "dcode-skill-fixture",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    model: "dcode-fixture",
    apiKey: "synthetic-local-test-key",
  });
  const model = (await backend.listModels()).find(
    (item) => item.provider === "dcode-skill-fixture",
  );
  assert.ok(model);
  const first = await backend.createSession(workspace, model);
  await backend.resumeSession(first.id);
  await backend.sendMessage(first.id, "Load the dcode-review skill and review the project.", model);
  await waitForTurn(first.id);
  assert.ok(
    requests.some((request) => request.tools?.some((tool) => tool.function?.name === "skill")),
  );
  const firstEvents = JSON.stringify(events.filter((event) => event.sessionId === first.id));
  const hasCatalog = JSON.stringify(requests).includes("DCODE_BRIDGED_SKILL");
  const loaded = firstEvents.includes("Dcode review checklist");
  if (!hasCatalog || !loaded) {
    await writeFile(
      join(root, "skill-diagnostics.json"),
      JSON.stringify(
        {
          hasCatalog,
          loaded,
          tools: requests.map((request) => request.tools?.map((tool) => tool.function?.name)),
          toolResults: events
            .filter((event) => event.data?.event?.type === "tool/result")
            .map((event) => event.data.event)
            .slice(0, 2),
        },
        null,
        2,
      ),
    );
  }
  assert.ok(hasCatalog, "DSH must advertise the bridged skill to the model");
  assert.ok(loaded, "DSH must load the bridged skill through its native tool");

  const configPath = join(home, ".zcode", "cli", "config.json");
  await mkdir(join(home, ".zcode", "cli"), { recursive: true });
  const canonicalSkill = (await realpath(skillPath)).replaceAll("\\", "/");
  await writeFile(configPath, JSON.stringify({ skills: { [canonicalSkill]: { enable: false } } }));
  commands.splice(0, commands.length, ["skill", { name: "dcode-review" }]);
  requests.splice(0);
  const second = await backend.createSession(workspace, model);
  await backend.resumeSession(second.id);
  await backend.sendMessage(second.id, "Check the available skills.", model);
  await waitForTurn(second.id);
  const disabledResults = events.filter(
    (event) => event.sessionId === second.id && event.data?.event?.type === "tool/result",
  );
  assert.equal(disabledResults.length, 1);
  assert.doesNotMatch(JSON.stringify(disabledResults), /Dcode review checklist/);
  assert.doesNotMatch(JSON.stringify(requests), /DCODE_BRIDGED_SKILL/);
  console.log(
    "PASS: DSH loaded ZCode skill and respected its disabled setting in the next session.",
  );
} finally {
  await backend.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}
