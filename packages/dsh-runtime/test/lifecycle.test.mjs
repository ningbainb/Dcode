import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DshLifecycle } from "../src/lifecycle.mjs";
import { probeHttpReady } from "../vendor/runtime-controller.mjs";

test("accepts the DSH 0.1.7 relative browser-token redirect only with a cookie", async () => {
  let probes = 0;
  await probeHttpReady("http://127.0.0.1:1234/?token=test", {
    attempts: 1,
    fetchImpl: async () => {
      probes++;
      return new Response(null, {
        status: 303,
        headers: { location: "./", "set-cookie": "dcode=test; HttpOnly" },
      });
    },
  });
  assert.equal(probes, 1);
  await assert.rejects(
    probeHttpReady("http://127.0.0.1:1234/?token=test", {
      attempts: 1,
      fetchImpl: async () => new Response(null, { status: 303, headers: { location: "./" } }),
    }),
    /HTTP 303/,
  );
});

test("concurrent startup shares one controller and authenticates before ready", async () => {
  const root = await mkdtemp(resolve(import.meta.dirname, "../../../../.dcode-lifecycle-"));
  const server = createServer((_req, res) => {
    res.writeHead(303, { "set-cookie": "dcode=test; HttpOnly", location: "/" });
    res.end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let starts = 0,
    stops = 0;
  let launchOptions;
  const controller = Object.assign(new EventEmitter(), {
    status: { state: "stopped" },
    async start() {
      starts++;
      this.status = { state: "ready", url: `http://127.0.0.1:${server.address().port}/launch` };
    },
    async stop() {
      stops++;
      this.status = { state: "stopped" };
    },
  });
  const runtime = new DshLifecycle({
    dataDir: root,
    controllerFactory: (options) => {
      launchOptions = options;
      return controller;
    },
    prepareProfile: async () => ({ cliPath: "fixture" }),
  });
  try {
    const values = await Promise.all([runtime.start(), runtime.start(), runtime.start()]);
    assert.equal(starts, 1);
    assert.ok(values.every((value) => value.state === "ready"));
    assert.equal(runtime.cookie, "dcode=test");
    if (process.platform === "win32") {
      const privateTemp = join(root, "dsh-temp");
      assert.equal((await stat(privateTemp)).isDirectory(), true);
      assert.equal(launchOptions.environmentProvider().TEMP, privateTemp);
      assert.equal(launchOptions.environmentProvider().TMP, privateTemp);
      assert.equal(launchOptions.startupTimeoutMs, 240_000);
      assert.notEqual(privateTemp, process.env.TEMP);
    }
    await runtime.stop();
    assert.equal(stops, 1);
    assert.equal(runtime.health().state, "stopped");
  } finally {
    await runtime.stop();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});

test("profile failure is visible and a later start can recover", async () => {
  const root = await mkdtemp(resolve(import.meta.dirname, "../../../../.dcode-lifecycle-"));
  let attempts = 0;
  const runtime = new DshLifecycle({
    dataDir: root,
    prepareProfile: async () => {
      attempts++;
      throw new Error("fixture profile unavailable");
    },
  });
  try {
    await assert.rejects(runtime.start(), /Restart Runtime or open logs/);
    assert.equal(runtime.health().state, "error");
    await assert.rejects(runtime.start(), /Restart Runtime or open logs/);
    assert.equal(attempts, 2, "failure does not cache a rejected startup promise");
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});
