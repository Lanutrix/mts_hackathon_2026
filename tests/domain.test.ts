import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseSnapshot,
  normalize,
  membership,
  transition,
  deadlineStatus,
  safeItsm,
  FIELDS,
  STATES,
  TEAM,
} from "../packages/domain/index.ts";
import { generate, FIXED_CLOCK } from "../packages/domain/generator.ts";
test("F01 independent original oracle 0/2/1/5 when ORIGINAL_PATH provided", async (t) => {
  if (!process.env.ORIGINAL_PATH) {
    t.skip("Оригинал не публикуется; задайте ORIGINAL_PATH");
    return;
  }
  const { rows } = parseSnapshot(
    await readFile(process.env.ORIGINAL_PATH, "utf8"),
    "original",
  );
  assert.equal(rows.length, 44);
  assert.deepEqual(
    ["critical", "coordinators", "high", "research"].map(
      (g) => rows.filter((r) => r.groups.includes(g as any)).length,
    ),
    [0, 2, 1, 5],
  );
  assert.ok(rows.every((r) => Object.keys(r.raw).length === 46));
});
for (const seed of [42, 43, 44, 92831])
  test(`F01 F12 F13 independent oracle 120 combinations seed ${seed}`, () => {
    const { rows, manifest } = generate(120, seed);
    const parsed = parseSnapshot(JSON.stringify(rows), "demo");
    for (const g of ["critical", "coordinators", "high", "research"] as const)
      assert.deepEqual(
        parsed.rows.filter((r) => r.groups.includes(g)).map((r) => r.id),
        manifest.expected[g],
      );
    assert.equal(
      new Set(
        rows.map((r) =>
          [
            r.stateId,
            r.priorityId,
            r.assignedGroupName === TEAM,
            r.serviceTypeId,
          ].join(","),
        ),
      ).size,
      120,
    );
  });
test("F28 F33 all 46 fields and future field roundtrip, precise IDs, date offsets", () => {
  const { rows } = generate(1);
  rows[0].future = { value: "будущее" };
  rows[0].submitDate = "2024-02-29T23:30:00+03:00";
  const {
    rows: [r],
  } = parseSnapshot(JSON.stringify(rows), "demo");
  assert.deepEqual(r.raw, rows[0]);
  assert.equal(typeof r.raw.sysId, "string");
  assert.equal(String(r.raw.sysId).length, 18);
  assert.equal(r.dates.submitDate, "2024-02-29T20:30:00.000Z");
  assert.equal(r.dates.waitingExitDate, null);
  assert.equal(FIELDS.length, 46);
  assert.ok(FIELDS.every((f) => f in r.raw));
});
test("F28 active solution does not resolve; unknown status, conflict and bad dates quarantine", () => {
  const raw = generate(1).rows[0];
  raw.solution = "Предыдущая попытка";
  assert.equal(normalize(raw, "x").stateId, 0);
  assert.ok(
    normalize(raw, "x").issues.some((i) => i.code === "active-solution"),
  );
  for (const change of [
    { stateId: 99 },
    { stateEnum: "Closed" },
    { deadline: "2026-11-21T10:00:00" },
    { deadline: "2026-02-30T00:00:00Z" },
    { completionDate: "2000-01-01T00:00:00Z" },
  ]) {
    const i = normalize({ ...raw, ...change }, "x");
    assert.equal(i.quarantined, true);
    assert.deepEqual(i.groups, []);
  }
});
test("F02 F03 F04 F09 F10 transition reasons merged, state7 reopens; closed conflicts", () => {
  const raw = {
    ...generate(1).rows[0],
    priorityId: 4,
    priority: "Наивысший",
    assignedGroupName: TEAM,
  };
  const a = normalize(raw, "demo");
  assert.deepEqual(transition(undefined, a).reasons, [
    "critical",
    "assigned-coordinators",
  ]);
  const b = normalize({ ...raw, stateId: 7, stateEnum: "Resolved" }, "demo");
  assert.deepEqual(transition(a, b).reasons, ["critical-resolved"]);
  assert.deepEqual(transition(b, a).reasons, [
    "critical-reopened",
    "assigned-coordinators",
  ]);
  const c = normalize({ ...raw, stateId: 10, stateEnum: "Closed" }, "demo");
  assert.equal(transition(c, a).incident.quarantined, true);
});
test("F05 F06 F07 F08 deadlines untouched on priority changes and exact clock boundaries", () => {
  const raw = { ...generate(2).rows[1] };
  const first = normalize(raw, "x"),
    next = normalize({ ...raw, priorityId: 4 }, "x");
  assert.equal(next.dates.deadline, first.dates.deadline);
  const now = Date.parse(FIXED_CLOCK);
  assert.equal(deadlineStatus(null, now), "unset");
  assert.equal(deadlineStatus(FIXED_CLOCK, now), "soon");
  assert.equal(deadlineStatus(new Date(now - 1).toISOString(), now), "overdue");
});
test("F14 flags retain true false null; no invented links", () => {
  for (const v of [true, false, null]) {
    const raw = {
      ...generate(1).rows[0],
      isNeedUp: v,
      isMaster: v,
      isDouble: v,
      isEffect: v,
      isReason: v,
    };
    const row = normalize(raw, "x");
    for (const f of [
      "isNeedUp",
      "isMaster",
      "isDouble",
      "isEffect",
      "isReason",
    ])
      assert.equal(row.raw[f], v);
    assert.equal("parentId" in row, false);
  }
});
test("F24 rejected root, invalid JSON, duplicate identity, numeric ID; fallback diagnostic", () => {
  for (const s of [
    "{",
    "{}",
    "[null]",
    JSON.stringify([{ id: 123 }]),
    JSON.stringify([generate(1).rows[0], generate(1).rows[0]]),
  ])
    assert.throws(() => parseSnapshot(s, "x"));
  const { sysId, ...r } = generate(1).rows[0];
  assert.ok(normalize(r, "x").issues.some((i) => i.code === "fallback"));
});
test("F15 safe ITSM link uses same id, rejects executable and credential URL", () => {
  assert.equal(safeItsm("DEMO-01"), "/itsm/DEMO-01");
  assert.throws(() => safeItsm("x", "javascript:alert(1)"));
  assert.throws(() => safeItsm("x", "https://user:password@example.invalid"));
  assert.equal(
    new URL(
      safeItsm("DEMO-01", "https://itsm.example.invalid/incident"),
    ).searchParams.get("incident"),
    "DEMO-01",
  );
});
