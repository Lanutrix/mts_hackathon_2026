import assert from "node:assert/strict";
import { test } from "node:test";
import { IncidentArrivals, DEMO_SPEED } from "../apps/server/incidentArrivals.ts";
import { normalize } from "../packages/domain/index.ts";
import profile from "../apps/server/arrivalProfile.json" with { type: "json" };

const hour = 3_600_000;
const start = Date.UTC(2016, 2, 7, 9);

test("the empirical calendar delivers each sampled hourly count once, with wall-clock timestamps", () => {
  const random = () => 0.5;
  const flow = new IncidentArrivals("run", random, start);
  const example = profile.daysByType[0][Math.floor(profile.daysByType[0].length * 0.5)];
  const half = hour / DEMO_SPEED / 2;
  const wall = Date.UTC(2026, 5, 1, 9);
  assert.deepEqual(flow.advance(0, wall), []);
  assert.deepEqual(flow.advance(half, wall + half), []);
  const rows = flow.advance(half, wall + half * 2);
  assert.equal(rows.length, example[9]);
  assert.ok(rows.length > 0);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.ok(rows.every(r => r.submitDate === new Date(wall + half).toISOString()));
  assert.ok(rows.every(r => !normalize(r, "simulation").quarantined));
  assert.ok(rows.every(r => String(r.assignedGroupName).startsWith("Учебная группа ")));
  assert.equal(flow.status().generated, rows.length);
  const next = flow.advance(hour / DEMO_SPEED, wall + half * 4);
  assert.equal(next.length, example[10]);
  assert.equal(flow.status().modelTime, new Date(start + 2 * hour).toISOString());
});

test("a full virtual day rolls from a Friday to a weekend workload", () => {
  const flow = new IncidentArrivals("weekend", () => 0.5, Date.UTC(2016, 2, 11, 23));
  const elapsed = 25 * hour / DEMO_SPEED;
  const rows = flow.advance(elapsed, Date.UTC(2026, 1, 2));
  const friday = profile.daysByType[0][Math.floor(profile.daysByType[0].length / 2)];
  const saturday = profile.daysByType[1][Math.floor(profile.daysByType[1].length / 2)];
  assert.equal(rows.length, friday[23] + saturday.reduce((a, b) => a + b));
  assert.equal(flow.status().generated, rows.length);
});

test("sampled team mix retains different primary groups for different service categories", () => {
  let seed = 271828;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const flow = new IncidentArrivals("mix", random, start);
  const rows = flow.advance(28 * 24 * hour / DEMO_SPEED, Date.UTC(2026, 5, 1));
  const group = profile.groups.indexOf("Group 70");
  for (const category of ["26", "46"]) {
    const sample = rows.filter(row => row.productName === "Учебный сервис " + category);
    const counts = profile.groupCountsByCategory[profile.categories.indexOf("Category " + category)];
    const rate = counts[group] / counts.reduce((a, b) => a + b, 0);
    const observed = sample.filter(row => row.assignedGroupName === "Учебная группа 70").length / sample.length;
    assert.ok(sample.length > 200);
    assert.ok(Math.abs(observed - rate) < 0.07, `category ${category}, observed ${observed}, expected ${rate}`);
  }
});
