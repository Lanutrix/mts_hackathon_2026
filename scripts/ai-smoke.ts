import { openDB } from "../apps/server/db.ts";
import { AnalysisService } from "../apps/server/analysis.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";
import assert from "node:assert/strict";
const db = await openDB(":memory:"),
  service = new AnalysisService(db, undefined, 300_000),
  incident = normalize(generate(1).rows[0], "smoke");
try {
  const start = performance.now(),
    result = await service.analyze(incident, () => incident);
  assert.equal(result.mode, "model", result.error);
  assert.equal(result.dimensions, 384);
  assert.ok(
    result.evidence.some((e) =>
      e.fields.some((f) => f.startsWith("description:")),
    ),
  );
  console.log(
    JSON.stringify({
      mode: result.mode,
      model: result.model,
      dimensions: result.dimensions,
      claims: result.summary.length,
      latencyMs: Math.round(performance.now() - start),
      stale: result.stale,
    }),
  );
} finally {
  await service.close();
  await db.close();
}
