import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { ZcodeSessionImportStore } from "../src/zcode-session-import.mjs";

test("copies selected ZCode messages without touching source, then skips duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "dcode-zcode-import-"));
  const source = join(root, "zcode.sqlite");
  const dataDir = join(root, "dcode");
  const originalWorkspace = join(homedir(), ".zcode", "workspace", "default");
  const destinationWorkspace = join(dataDir, "workspace", "default");
  try {
    const db = new DatabaseSync(source);
    db.exec(`create table session(id text, title text, directory text, parent_id text, time_created integer, time_updated integer);
      create table message(id text, session_id text, sequence integer, time_created integer, data text);
      create table part(id text, message_id text, session_id text, sequence integer, time_created integer, data text);`);
    db.prepare("insert into session values (?, ?, ?, null, 1, 3)").run(
      "s1",
      "Research notes",
      originalWorkspace,
    );
    db.prepare("insert into message values (?, ?, ?, ?, ?)").run(
      "m1",
      "s1",
      0,
      1,
      JSON.stringify({ role: "user" }),
    );
    db.prepare("insert into message values (?, ?, ?, ?, ?)").run(
      "m2",
      "s1",
      1,
      2,
      JSON.stringify({ role: "assistant" }),
    );
    db.prepare("insert into part values (?, ?, ?, ?, ?, ?)").run(
      "p1",
      "m1",
      "s1",
      0,
      1,
      JSON.stringify({ type: "text", text: "Need a plan" }),
    );
    db.prepare("insert into part values (?, ?, ?, ?, ?, ?)").run(
      "p2",
      "m2",
      "s1",
      0,
      2,
      JSON.stringify({ type: "text", text: "Here is the plan" }),
    );
    db.prepare("insert into part values (?, ?, ?, ?, ?, ?)").run(
      "p3",
      "m2",
      "s1",
      1,
      2,
      JSON.stringify({
        type: "tool",
        tool: "Bash",
        state: { status: "completed", input: { command: "pwd" }, output: "/project" },
      }),
    );
    db.close();
    const before = await readFile(source);
    const store = new ZcodeSessionImportStore(dataDir, source);
    const candidates = await store.candidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].imported, false);
    assert.deepEqual(await store.importSessions(["s1"]), [{ sourceId: "s1", status: "imported" }]);
    assert.deepEqual(await store.importSessions(["s1"]), [{ sourceId: "s1", status: "skipped" }]);
    assert.deepEqual(await readFile(source), before);
    assert.equal((await store.candidates())[0].imported, true);
    const listed = await store.list(destinationWorkspace);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].source, "zcode");
    assert.equal((await store.list(originalWorkspace)).length, 0);
    const archive = await store.read(listed[0].id);
    assert.deepEqual(
      archive.transcript.map((entry) => [entry.role, entry.text]),
      [
        ["user", "Need a plan"],
        ["assistant", "Here is the plan"],
      ],
    );
    assert.deepEqual(
      archive.transcript[1].tools.map((tool) => [tool.name, tool.status, tool.output]),
      [["Bash", "completed", "/project"]],
    );
    assert.deepEqual(archive.continuation, { omittedMessages: 0, degradedAttachments: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing source is an empty scan and a requested import reports failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "dcode-zcode-missing-"));
  try {
    const store = new ZcodeSessionImportStore(root, join(root, "absent.sqlite"));
    assert.deepEqual(await store.candidates(), []);
    const result = await store.importSessions(["unknown"]);
    assert.equal(result[0].status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
