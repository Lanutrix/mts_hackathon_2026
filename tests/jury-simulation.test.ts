import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "node:http";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import {
  registerJurySimulation,
  type JurySnapshot,
} from "../apps/server/jurySimulation.ts";
import { TEAM } from "../packages/domain/index.ts";

async function view(url: string, lastEventId?: string) {
  const req = get(url, {
    headers: lastEventId ? { "Last-Event-ID": lastEventId } : {},
  });
  const res = await new Promise<import("node:http").IncomingMessage>(
    (ok, fail) => {
      req.once("response", ok).once("error", fail);
    },
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"]!, /text\/event-stream/);
  const lines = createInterface({ input: res })[Symbol.asyncIterator]();
  return {
    close: () => res.destroy(),
    async next(): Promise<JurySnapshot> {
      let event = "";
      for (;;) {
        const line = await lines.next();
        assert.ok(!line.done, "expected another snapshot");
        if (line.value.startsWith("event: ")) event = line.value.slice(7);
        if (line.value.startsWith("data: ")) {
          assert.equal(event, "snapshot");
          return JSON.parse(line.value.slice(6));
        }
      }
    },
  };
}

test(
  "a shared simulation observes an isolated JSON file and replays the current snapshot on reconnect",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "wm-jury-test-"));
    const workspaceFile = join(root, "incidents.json");
    await writeFile(workspaceFile, '["workspace sentinel"]');
    const app = Fastify();
    registerJurySimulation(app, true, {
      temporaryRoot: root,
      stepDelays: [400, 100, 100, 100, 100],
      graceMs: 100,
    });
    const url =
      (await app.listen({ host: "127.0.0.1", port: 0 })) +
      "/api/simulation/stream";
    try {
      assert.deepEqual(await readdir(root), ["incidents.json"]);
      const [one, two] = await Promise.all([view(url), view(url)]);
      const baseline = await one.next();
      const simultaneous = await two.next();
      assert.deepEqual({ ...simultaneous, time: baseline.time }, baseline);
      assert.equal(baseline.step, 0);
      assert.equal(baseline.revision, 1);
      assert.deepEqual(baseline.events, []);
      assert.deepEqual(baseline.incidents[0].groups, []);
      const directory = (await readdir(root)).find(
        (name) => name !== "incidents.json",
      )!;
      const raw = JSON.parse(
        await readFile(join(root, directory, "incidents.json"), "utf8"),
      );
      assert.equal(raw[0].id, baseline.incidents[0].id);
      assert.equal(raw[0].header, baseline.incidents[0].header);
      assert.ok(Math.abs(Date.now() - Date.parse(raw[0].submitDate)) < 10_000);
      two.close();
      one.close();

      await delay(20);
      const returning = await view(url, `${baseline.runId}:1`);
      const resumed = await returning.next();
      assert.ok(Date.parse(resumed.time) > Date.parse(baseline.time));
      assert.deepEqual({ ...resumed, time: baseline.time }, baseline);
      const critical = await returning.next();
      assert.equal(critical.revision, 2);
      assert.deepEqual(critical.incidents[0].groups, ["critical"]);
      assert.deepEqual(critical.events[0].reasons, ["critical"]);
      const assigned = await returning.next();
      assert.equal(assigned.incidents.length, 1);
      assert.deepEqual(assigned.incidents[0].groups, [
        "critical",
        "coordinators",
      ]);
      assert.equal(assigned.incidents[0].team, TEAM);
      assert.deepEqual(assigned.events[0].reasons, ["assigned-coordinators"]);
      const updated = await returning.next();
      assert.deepEqual(updated.events, assigned.events);
      assert.notEqual(
        updated.incidents[0].deadline,
        assigned.incidents[0].deadline,
      );
      const resolved = await returning.next();
      assert.deepEqual(
        resolved.events.map((e) => e.reasons),
        [["critical-resolved"], ["assigned-coordinators"], ["critical"]],
      );
      assert.equal(resolved.events[0].state, "Завершён");
      assert.deepEqual(resolved.incidents[0].groups, []);
      const fresh = await returning.next();
      assert.equal(fresh.runId, baseline.runId);
      assert.equal(fresh.revision, 6);
      assert.equal(fresh.step, 0);
      assert.notEqual(fresh.incidents[0].id, resolved.incidents[0].id);
      assert.deepEqual(fresh.events, resolved.events);
      returning.close();

      for (let i = 0; i < 100 && (await readdir(root)).length > 1; i++)
        await delay(10);
      assert.deepEqual(await readdir(root), ["incidents.json"]);
      const nextViewer = await view(url);
      assert.notEqual((await nextViewer.next()).runId, baseline.runId);
      await app.close(); // includes a still-connected viewer
      assert.deepEqual(await readdir(root), ["incidents.json"]);
      assert.equal(
        await readFile(workspaceFile, "utf8"),
        '["workspace sentinel"]',
      );
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("disabling the public demo also disables the jury stream", async () => {
  const app = Fastify();
  registerJurySimulation(app, false);
  try {
    assert.equal((await app.inject("/api/simulation/stream")).statusCode, 404);
  } finally {
    await app.close();
  }
});

test(
  "a long-running stream keeps 24 frozen event records while ticket identities advance",
  { timeout: 10_000 },
  async () => {
    const app = Fastify();
    registerJurySimulation(app, true, { stepDelays: [2, 2, 2, 2, 2] });
    const url =
      (await app.listen({ host: "127.0.0.1", port: 0 })) +
      "/api/simulation/stream";
    try {
      const viewer = await view(url);
      let snapshot = await viewer.next();
      while (snapshot.revision < 45) snapshot = await viewer.next();
      assert.equal(snapshot.incidents[0].id, "SIM-009");
      assert.equal(snapshot.events.length, 24);
      assert.equal(snapshot.events[0].revision, 45);
      assert.equal(snapshot.events.at(-1)!.revision, 7);
      assert.equal(snapshot.events.at(-1)!.state, "Выполняется");
      assert.equal(snapshot.events.at(-1)!.team, "Сопровождение платежей");
      assert.ok(
        snapshot.events.every(
          (e, i, all) => !i || e.revision < all[i - 1].revision,
        ),
      );
    } finally {
      await app.close();
    }
  },
);
