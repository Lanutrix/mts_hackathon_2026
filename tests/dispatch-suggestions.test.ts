import test from "node:test";
import assert from "node:assert/strict";
import { normalize, TEAM } from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { dispatchSuggestions } from "../apps/server/dispatchSuggestions.ts";
import { insightDefinitions } from "../packages/contracts/answerInsights.ts";
import { buildAnswerInsights } from "../apps/server/answerInsights.ts";
import { filterDashboard } from "../packages/domain/triage.ts";

const now = Date.parse("2026-11-21T09:00:00Z");
const raw = {
  ...generate(1).rows[0],
  id: "PRIVATE-INC",
  header: "PRIVATE-NARRATIVE",
  assignedGroupName: "PRIVATE-TEAM",
  assignedEmployee: "PRIVATE-NAME",
  productName: "PRIVATE-PRODUCT",
  isNeedUp: true,
  isReason: false,
  isEffect: true,
};
const incident = normalize(raw, "workspace");
const catalog = {
  teams: [
    { name: TEAM, both: 20, product: 25, symptom: 21, members: [] },
    { name: "PRIVATE-TEAM", both: 2, product: 4, symptom: 2, members: [] },
  ],
};
test("routing suggestions use only scoped candidates, protect raw fields and return reviewable comment drafts", async () => {
  let posted = "";
  const client = new VseLlm("fixture", "planning-model", async (_u, o) => {
    posted = String(o?.body);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              teams: ["T1"],
              comments: ["aftermath", "scope"],
            }),
          },
        },
      ],
    });
  });
  const data = await dispatchSuggestions(
    incident,
    catalog,
    "stamp",
    "PRIVATE-TEAM",
    client,
    now,
  );
  assert.equal(data.mode, "model");
  assert.equal(data.snapshot, "stamp");
  assert.equal(data.model, "planning-model");
  assert.deepEqual(
    data.teams.map((t) => t.name),
    ["PRIVATE-TEAM"],
  );
  assert.match(data.teams[0].reason, /2/);
  assert.match(data.comments[0].text, /устранение последствий/);
  assert.equal(data.comments.length, 2);
  assert.ok(!posted.includes("PRIVATE"));
  assert.deepEqual(incident.raw, raw);
  const invalid = new VseLlm("fixture", "test", async () =>
    Response.json({
      choices: [
        { message: { content: '{"teams":["UNKNOWN"],"comments":["scope"]}' } },
      ],
    }),
  );
  assert.equal(
    (
      await dispatchSuggestions(
        incident,
        catalog,
        "stamp",
        undefined,
        invalid,
        now,
      )
    ).mode,
    "local",
  );
  const empty = await dispatchSuggestions(
    incident,
    { teams: [] },
    "stamp",
    undefined,
    undefined,
    now,
  );
  assert.deepEqual(empty.teams, []);
  assert.ok(empty.comments.length);
});
test("official relation flags and historical service type filters retain the source meaning", () => {
  const selected = [
    incident,
    normalize(
      { ...raw, id: "other", isEffect: false, isReason: true },
      "workspace",
    ),
    normalize(
      { ...raw, id: "third", isEffect: false, isReason: true },
      "workspace",
    ),
  ];
  assert.equal(
    buildAnswerInsights(insightDefinitions.causes.title, selected, now)[0]
      .value,
    "1",
  );
  assert.equal(
    buildAnswerInsights(insightDefinitions.effects.title, selected, now)[0]
      .value,
    "2",
  );
  const records = [
    normalize({ ...raw, id: "INC1", serviceTypeId: 10 }, "original"),
    normalize({ ...raw, id: "INC2", serviceTypeId: 20 }, "original"),
    normalize(
      {
        ...raw,
        id: "DEMO-42-00001",
        serviceTypeId: 2,
        serviceType: "Клиентский",
      },
      "demo",
    ),
  ];
  assert.deepEqual(
    filterDashboard(records, { service: "10" }).map((r) => r.id),
    ["INC1", "DEMO-42-00001"],
  );
  assert.deepEqual(
    filterDashboard(records, { service: "2" }).map((r) => r.id),
    ["INC1", "DEMO-42-00001"],
  );
});
