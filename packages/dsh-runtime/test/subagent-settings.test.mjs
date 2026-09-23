import assert from "node:assert/strict";
import { test } from "node:test";
import { listDshSubagentSettings, updateDshSubagentSettings } from "../src/subagent-settings.mjs";

test("DSH subagent settings read the runtime-owned namespace", async () => {
  const calls = [];
  const transport = {
    call: async (method, params) => {
      calls.push([method, params]);
      return {
        writable: true,
        namespaces: [{ ns: "subagent", revision: 7, value: { maxDepth: 2 } }],
      };
    },
  };
  assert.deepEqual(await listDshSubagentSettings(transport), {
    maxDepth: 2,
    revision: 7,
    writable: true,
  });
  assert.deepEqual(calls, [["settings/describe", undefined]]);
});

test("DSH subagent settings update checks revision and does not write a stale value", async () => {
  const calls = [];
  const transport = {
    call: async (method, params) => {
      calls.push([method, params]);
      if (method === "settings/describe")
        return {
          writable: true,
          namespaces: [{ ns: "subagent", revision: 4, value: { maxDepth: 1 } }],
        };
      return { revision: 5 };
    },
  };
  await assert.rejects(updateDshSubagentSettings(transport, 0, 3), /changed/i);
  assert.equal(calls.length, 1);
  await updateDshSubagentSettings(transport, 0, 4);
  assert.deepEqual(calls.at(-2), [
    "settings/update",
    { ns: "subagent", patch: { maxDepth: 0 }, expectedRevision: 4 },
  ]);
  await assert.rejects(updateDshSubagentSettings(transport, -1, 4), /depth/i);
});

test("read-only DSH subagent settings refuse writes", async () => {
  const transport = {
    call: async () => ({
      writable: false,
      namespaces: [{ ns: "subagent", revision: 1, value: { maxDepth: 1 } }],
    }),
  };
  await assert.rejects(updateDshSubagentSettings(transport, 2, 1), /read-only/i);
});
