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
import { createApp } from "../apps/server/api.ts";
import { registerTrainingActions } from "../apps/server/trainingActions.ts";
import { Auth } from "../apps/server/auth.ts";
import { Store } from "../apps/worker/ingestion.ts";

async function view(url: string, lastEventId?: string, cookie?: string) {
  const req = get(url, {
    headers: {
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  const res = await new Promise<import("node:http").IncomingMessage>(
    (ok, fail) => {
      req.once("response", ok).once("error", fail);
    },
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"]!, /text\/event-stream/);
  const lines = createInterface({ input: res })[Symbol.asyncIterator]();
  async function frame() {
    let event = "";
    for (;;) {
      const line = await lines.next();
      assert.ok(!line.done, "expected another snapshot");
      if (line.value.startsWith("event: ")) event = line.value.slice(7);
      if (line.value.startsWith("data: ")) {
        return { event, data: JSON.parse(line.value.slice(6)) };
      }
    }
  }
  return {
    close: () => res.destroy(),
    frame,
    async next(): Promise<JurySnapshot> {
      const { event, data } = await frame();
      assert.equal(event, "snapshot");
      return data;
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
      arrivalRandom: () => 0.5,
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

test("disabling the public demo disables the jury stream and training writes", async () => {
  const app = Fastify();
  const jury = registerJurySimulation(app, false);
  registerTrainingActions(app, jury, () => ({ username: "coordinator" }));
  try {
    assert.equal((await app.inject("/api/simulation/stream")).statusCode, 404);
    for (const suffix of ["", "?ns=simulation"]) {
      const response = await app.inject({ method: "POST", url: "/api/simulation/incidents/SIM-001" + suffix,
        payload: { runId: "old", expectedRevision: 1, action: "resolve" } });
      assert.equal(response.statusCode, 404);
    }
  } finally {
    await app.close();
  }
});

test(
  "standard dashboard APIs and both stream protocols share a read-only simulation without touching the workspace database",
  { timeout: 15_000 },
  async () => {
    let queries = 0;
    const blocked = async () => {
      queries++;
      throw new Error("workspace DB accessed");
    };
    const workspace = new Store(
      { query: blocked, transaction: blocked, close: blocked },
      "workspace",
    );
    const auth = new Auth();
    auth.sessions.set(auth.digest("test-cookie"), {
      username: "owner",
      role: "demo-admin",
      csrf: "test-csrf",
      expires: Date.now() + 60_000,
    });
    const app = await createApp({
      auth,
      publicDemo: true,
      secure: false,
      origin: "http://localhost",
      stores: new Map([["workspace", workspace]]),
      sources: new Map(),
      itsmUrl: "https://system.invalid/workspace",
      jurySimulation: { stepDelays: [400, 200, 200, 200, 200], graceMs: 150, arrivalRandom: () => 0.5 },
    });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const headers = {
      cookie: "wm_session=test-cookie",
      "x-csrf-token": "test-csrf",
    };
    const read = async (path: string) => {
      const response = await app.inject({
        url:
          "/api/" + path + (path.includes("?") ? "&" : "?") + "ns=simulation",
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    try {
      const [a, b] = await Promise.all([read("dashboard"), read("dashboard")]);
      assert.equal(a.simulation.runId, b.simulation.runId);
      assert.equal(a.simulation.currentId, "SIM-001");
      assert.equal(a.namespace, "simulation");
      assert.equal(a.revision, 1);
      assert.equal(a.status.state, "live");
      assert.equal(a.unique, 6);
      assert.equal(a.total, 7);
      assert.equal(a.triage.overdue, 1);
      assert.equal(a.triage.escalations, 2);
      assert.deepEqual(
        a.triage.cases.map((item: { count: number }) => item.count),
        [3, 2, 1],
      );
      const firstCase = a.triage.cases[0];
      const analysis = await app.inject({
        method: "POST",
        headers,
        url:
          "/api/triage/" +
          firstCase.id +
          "/analysis?ns=simulation&revision=" +
          a.revision +
          "&hash=" +
          firstCase.hash,
      });
      assert.equal(analysis.statusCode, 200, analysis.body);
      assert.equal(analysis.json().model, "TF-IDF · TextRank");
      assert.ok(
        analysis
          .json()
          .evidence.every((e: { id: string }) => e.id.startsWith("SIM-AUTH-")),
      );
      assert.deepEqual((await read("me")).sources, ["simulation"]);
      assert.equal((await read("me")).user.username, "owner");
      assert.deepEqual(
        (await read("health")).sources.map((s: any) => s.namespace),
        ["simulation"],
      );
      const legacy = await view(
        base + "/api/simulation/stream",
        undefined,
        headers.cookie,
      );
      const stream = await view(
        base + "/api/stream?ns=simulation&cursor=1",
        undefined,
        headers.cookie,
      );
      assert.equal((await legacy.next()).runId, a.simulation.runId);
      assert.equal((await stream.frame()).event, "ready");
      legacy.close();
      const frame = await stream.frame();
      assert.equal(frame.event, "revision");
      assert.equal(frame.data.revision, 2);
      const critical = await read("dashboard?q=платежей");
      assert.equal(critical.groups.critical.count, 1);
      assert.equal(critical.groups.critical.items[0].revision, 2);
      assert.deepEqual(critical.events[0].reasons, ["critical"]);
      await stream.frame();
      const assigned = await read("dashboard");
      assert.equal(assigned.unique, 7);
      assert.equal(assigned.groups.coordinators.items[0].id, "SIM-001");
      assert.equal(
        (await read("dashboard?coordinators=1")).groups.coordinators.items
          .length,
        0,
      );
      const detail = await read("incident/SIM-001");
      assert.ok(detail.itsmMock);
      assert.equal(detail.itsm, "/itsm/SIM-001");
      assert.equal(detail.history[0].kind, "updated");
      assert.ok(detail.history[0].changed.includes("assignedGroupName"));
      const oldNotification = (await read("notifications?offset=1")).items[0];
      assert.equal(oldNotification.snapshot.team, "Сопровождение платежей");
      assert.equal(oldNotification.read, false);
      for (const path of [
        "demo",
        "analysis/SIM-001",
        "notifications/read",
        "import/preview",
        "import/commit",
        "preferences",
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/api/" + path + "?ns=simulation",
          headers,
          payload: {},
        });
        assert.equal(response.statusCode, 403, path);
      }
      while ((await stream.frame()).data.revision < 6) {}
      assert.equal((await read("dashboard")).simulation.currentId, "SIM-002");
      const archive = await read("incidents?history=1");
      assert.equal(archive.items[0].id, "SIM-001");
      const archived = await read("incident/SIM-001");
      assert.equal(archived.incident.stateId, 7);
      assert.deepEqual(
        archived.history.map((h: any) => h.revision),
        [5, 4, 3, 2, 1],
      );
      assert.equal((await read("export")).length, 8);
      const reconnected = await view(
        base + "/api/stream?ns=simulation&cursor=0",
        undefined,
        headers.cookie,
      );
      assert.equal((await reconnected.frame()).event, "resync");
      assert.equal(queries, 0);
    } finally {
      await app.close();
    }
  },
);

test(
  "a long-running stream keeps 24 frozen event records while ticket identities advance",
  { timeout: 10_000 },
  async () => {
    const app = Fastify();
    registerJurySimulation(app, true, { stepDelays: [2, 2, 2, 2, 2], arrivalRandom: () => 0.5 });
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

test("model arrivals enter the same export and read view as the scripted incident", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-arrivals-test-"));
  const app = Fastify();
  const jury = registerJurySimulation(app, true, {
    temporaryRoot: root, stepDelays: [80, 500, 500, 500, 500], arrivalRandom: () => 0.0001,
  });
  const url = (await app.listen({ host: "127.0.0.1", port: 0 })) + "/api/simulation/stream";
  try {
    const reader = await view(url);
    assert.equal((await reader.next()).arrivals.generated, 0);
    const next = await reader.next();
    assert.equal(next.incidents[0].id, "SIM-001");
    assert.ok(next.arrivals.generated > 0);
    assert.equal(jury.latest()?.simulation.arrivals.latestId, next.arrivals.latestId);
    const directory = (await readdir(root))[0];
    const raw = JSON.parse(await readFile(join(root, directory, "incidents.json"), "utf8"));
    const created = raw.filter((row: { id: string }) => row.id.startsWith("SIM-FLOW-"));
    assert.equal(created.length, next.arrivals.generated);
    assert.equal(created.at(-1).id, next.arrivals.latestId);
    assert.ok([...jury.latest()!.rows.values()].some(r => r.id === next.arrivals.latestId && !r.quarantined));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("coordinators share versioned training edits, routing and resolution with read-only viewers", { timeout: 12_000 }, async () => {
  const auth = new Auth();
  for (const [username, role] of [["anna", "coordinator"], ["ivan", "coordinator"], ["reader", "viewer"]] as const) {
    auth.sessions.set(auth.digest(username), { username, role, csrf: username, expires: Date.now() + 60_000 });
  }
  const headers = (name: string) => ({ cookie: "wm_session=" + name, "x-csrf-token": name });
  const blocked = async () => { throw new Error("workspace DB accessed"); };
  const workspace = new Store({ query: blocked, transaction: blocked, close: blocked }, "workspace");
  const app = await createApp({
    auth, publicDemo: true, secure: false, origin: "http://localhost",
    stores: new Map([["workspace", workspace]]), sources: new Map(),
    jurySimulation: { stepDelays: [650, 150, 120, 120, 120], arrivalRandom: () => 0.5 },
  });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const reader = await view(base + "/api/simulation/stream", undefined, headers("reader").cookie);
    const first = await reader.next();
    const stream = await view(base + "/api/stream?ns=simulation&cursor=1", undefined, headers("ivan").cookie);
    assert.equal((await stream.frame()).event, "ready");
    const id = first.incidents[0].id;
    const url = "/api/simulation/incidents/" + id;
    const command = (who: string, body: object, ns = "simulation", csrf = who) => app.inject({
      method: "POST", url: url + "?ns=" + ns, headers: { ...headers(who), "x-csrf-token": csrf },
      payload: { runId: first.runId, expectedRevision: 1, ...body },
    });
    const edit = { action: "edit", header: "Учебная ошибка", description: "Проверен журнал операции." };
    const changed = await command("anna", edit);
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().incident.raw.header, edit.header);
    assert.equal(changed.json().incident.revision, 2);
    const edited = await reader.next();
    assert.equal(edited.revision, 2);
    assert.equal(edited.incidents[0].description, edit.description);
    assert.equal(edited.nextAt, first.nextAt);
    assert.equal((await stream.frame()).data.revision, 2);
    assert.equal((await command("reader", edit)).statusCode, 403);
    assert.equal((await command("anna", edit, "simulation", "wrong")).statusCode, 403);
    assert.equal((await command("anna", edit, "workspace")).statusCode, 403);
    assert.equal((await command("ivan", { ...edit, runId: "stale-run" })).statusCode, 409);
    assert.equal((await command("anna", { action: "edit", expectedRevision: 2 })).statusCode, 400);
    assert.equal((await command("anna", { action: "route", team: "Несуществующая", expectedRevision: 2 })).statusCode, 400);
    const route = { action: "route", expectedRevision: 2, team: "Мобильная платформа" };
    const concurrent = await Promise.all([command("anna", route), command("ivan", route)]);
    assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal(concurrent.find(r => r.statusCode === 409)!.json().revision, 3);
    const routed = await reader.next();
    assert.equal(routed.incidents[0].team, route.team);
    assert.equal(routed.incidents[0].assignee, null);
    const background = await app.inject({ method: "POST", url: "/api/simulation/incidents/SIM-NET-02?ns=simulation",
      headers: headers("ivan"), payload: { runId: first.runId, expectedRevision: 1, action: "edit", header: "Второй инцидент" } });
    assert.equal(background.statusCode, 200, background.body);
    const editedBackground = await reader.next();
    assert.equal(editedBackground.revision, 4);
    assert.equal(editedBackground.incidents.find(row => row.id === "SIM-NET-02")?.header, "Второй инцидент");
    // The second ticket's edit and both scripted ticks preserve the coordinator's fields.
    let tick = await reader.next();
    while (tick.step < 2) tick = await reader.next();
    assert.equal(tick.incidents[0].team, route.team);
    assert.equal(tick.incidents[0].description, edit.description);
    const detail = async () => (await app.inject({ url: "/api/incident/" + id + "?ns=simulation", headers: headers("reader") })).json();
    const current = await detail();
    assert.equal((await command("ivan", { action: "resolve", expectedRevision: current.incident.revision, solution: "X".repeat(2001) })).statusCode, 400);
    const resolved = await command("ivan", { action: "resolve", expectedRevision: current.incident.revision, solution: "  Доступ восстановлен.  " });
    assert.equal(resolved.statusCode, 200, resolved.body);
    assert.equal(resolved.json().incident.stateId, 7);
    assert.ok(resolved.json().incident.dates.completionDate);
    assert.equal(resolved.json().incident.raw.solution, "Доступ восстановлен.");
    const resolvedView = await reader.next();
    assert.equal(resolvedView.incidents[0].state, "Завершён");
    assert.deepEqual(resolvedView.events[0].reasons, ["critical-resolved"]);
    while ((await reader.next()).step !== 0) {}
    const archived = await detail();
    assert.equal(archived.incident.revision, resolved.json().revision);
    assert.equal(archived.incident.raw.description, edit.description);
    assert.equal(archived.history[0].actor, "ivan");
    assert.equal(archived.history[0].action, "resolve");
    assert.equal(archived.history.find((h: { action: string }) => h.action === "edit").before_doc.raw.header, first.incidents[0].header);
  } finally {
    await app.close();
  }
});

test("training history is bounded and repeated ticket IDs start fresh in a new run", { timeout: 12_000 }, async () => {
  const app = Fastify();
  const jury = registerJurySimulation(app, true, { stepDelays: [60_000, 60_000, 60_000, 60_000, 60_000], graceMs: 40 });
  registerTrainingActions(app, jury, () => ({ username: "coordinator" }));
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const stream = await view(base + "/api/simulation/stream");
    const start = await stream.next();
    const item = start.incidents[0];
    const post = (runId: string, expectedRevision: number, header: string) => app.inject({
      method: "POST", url: "/api/simulation/incidents/" + item.id, payload: { runId, expectedRevision, action: "edit", header },
    });
    for (let revision = 1; revision < 55; revision++) {
      const accepted = await post(start.runId, revision, "Версия " + revision);
      assert.equal(accepted.statusCode, 200, accepted.body);
    }
    const history = jury.latest()!.history(item.key);
    assert.equal(history.length, 50);
    assert.equal(history[0].revision, 55);
    assert.equal(history.at(-1)!.revision, 6);
    stream.close();
    for (let i = 0; i < 100 && jury.latest(); i++) await delay(10);
    assert.equal(jury.latest(), undefined);
    const restarted = await view(base + "/api/simulation/stream");
    const fresh = await restarted.next();
    assert.notEqual(fresh.runId, start.runId);
    assert.equal(fresh.incidents[0].id, item.id);
    assert.equal((await post(start.runId, fresh.incidents[0].revision, "Чужая сессия")).statusCode, 409);
    assert.equal(jury.latest()!.rows.get(fresh.incidents[0].key)!.raw.header, item.header);
    assert.equal(jury.latest()!.history(fresh.incidents[0].key).length, 1);
  } finally {
    await app.close();
  }
});

test("early coordinator resolutions keep tickets referenced by the retained alert journal", { timeout: 15_000 }, async () => {
  const app = Fastify();
  const jury = registerJurySimulation(app, true, { stepDelays: [160, 10, 10, 10, 10], arrivalRandom: () => 0.5 });
  registerTrainingActions(app, jury, () => ({ username: "coordinator" }));
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const stream = await view(base + "/api/simulation/stream");
    const start = await stream.next();
    let tick = await stream.next();
    while (tick.incidents[0].id !== "SIM-015") {
      if (tick.step === 0 && tick.incidents[0].state !== "Завершён") {
        const ticket = tick.incidents[0];
        const resolved = await app.inject({ method: "POST", url: "/api/simulation/incidents/" + ticket.id,
          payload: { runId: start.runId, expectedRevision: ticket.revision, action: "resolve" } });
        assert.equal(resolved.statusCode, 200, resolved.body);
      }
      tick = await stream.next();
    }
    const firstEvent = tick.events.find(event => event.id === start.incidents[0].id);
    assert.ok(firstEvent);
    assert.ok(jury.latest()!.rows.has(firstEvent.key));
    assert.ok(jury.latest()!.history(firstEvent.key).some(version => version.revision === firstEvent.revision));
  } finally {
    await app.close();
  }
});
