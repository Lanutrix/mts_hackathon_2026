import test from "node:test";
import assert from "node:assert/strict";
import { AnalysisService } from "../apps/server/analysis.ts";
import { analyzeCase } from "../apps/server/caseAnalysis.ts";
import { createApp } from "../apps/server/api.ts";
import { Auth } from "../apps/server/auth.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";
import { buildTriage } from "../packages/domain/triage.ts";
import type { DB } from "../apps/server/db.ts";

const db: DB = {
  query: async () => ({ rows: [] }),
  transaction: async () => {
    throw Error("Unexpected write");
  },
  close: async () => {},
};
const row = normalize(
  {
    ...generate(1).rows[0],
    id: "INC-SECRET",
    sysId: "SYS-SECRET",
    assignedEmployee: "PRIVATE_PERSON",
    assignedGroupName: "PRIVATE_TEAM",
    productName: "PRIVATE_PRODUCT",
    header: "PRIVATE_TITLE",
    description: "PRIVATE_DESCRIPTION",
    priorityId: 4,
    priority: "Наивысший",
    isNeedUp: true,
  },
  "workspace",
);

async function setup() {
  const wire: string[] = [];
  let rejectRefs = false;
  const { VseLlm } = await import("../apps/server/vsellm.ts");
  const provider = new VseLlm(
    "test-placeholder",
    "test-model",
    async (_, options) => {
      wire.push(String(options?.body));
      const answer = {
        answer: "У заявки высший приоритет.",
        nextCheck: "Уточните время следующей проверки.",
        refs: [rejectRefs ? "T99.priorityId" : "T1.priorityId"],
      };
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      });
    },
  );
  const service = new AnalysisService(db, undefined, 100, undefined, provider);
  const store = new Store(db, "workspace");
  store.rows.set(row.key, row);
  const auth = new Auth();
  auth.sessions.set(auth.digest("coordinator"), {
    username: "coord",
    role: "coordinator",
    csrf: "csrf",
    expires: Date.now() + 60_000,
  });
  const app = await createApp({
    stores: new Map([["workspace", store]]),
    sources: new Map(),
    auth,
    publicDemo: false,
    secure: false,
    origin: "http://localhost",
    ai: service,
  });
  const ask = (question: string) =>
    app.inject({
      method: "POST",
      url: "/api/analysis/selection?ns=workspace",
      headers: { cookie: "wm_session=coordinator", "x-csrf-token": "csrf" },
      payload: { ids: [row.id], question, zone: "UTC" },
    });
  return {
    app,
    wire,
    ask,
    service,
    failValidation: () => {
      rejectRefs = true;
    },
  };
}

test("selection answers structured queries locally and sends only safe evidence for private questions", async () => {
  const { app, wire, ask } = await setup();
  try {
    const owners = await ask("Какие команды отвечают за выбранные инциденты?");
    assert.equal(owners.statusCode, 200, owners.body);
    assert.equal(owners.json().mode, "fields");
    assert.match(owners.body, /PRIVATE_TEAM/);
    assert.equal(wire.length, 0);
    const question =
      "Сравни риски по INC-SECRET и поясни приоритет PRIVATE_QUERY";
    const replies = await Promise.all([
      ask(question),
      ask(question),
      ask(question),
    ]);
    for (const reply of replies) {
      assert.equal(reply.statusCode, 200, reply.body);
      const result = reply.json();
      assert.equal(result.provider, "VseLLM");
      assert.match(result.overview.join(" "), /высший приоритет/);
      assert.match(JSON.stringify(result), /INC-SECRET/);
      assert.match(JSON.stringify(result), /priorityId/);
    }
    await ask(question);
    assert.equal(wire.length, 1);
    assert.doesNotMatch(wire[0], /PRIVATE_|INC-SECRET|SYS-SECRET/);
    const task = JSON.parse(JSON.parse(wire[0]).messages[1].content).task;
    assert.match(task, /сравни риски по T1/);
    const unsupported = await ask("Курс японской иены?");
    assert.equal(unsupported.json().mode, "fallback");
    assert.equal(wire.length, 1);
  } finally {
    await app.close();
  }
});

test("the simulation forwards a natural-language question while redacting secrets and addresses", async () => {
  const { operationalReading } = await import(
    "../apps/server/operationalAnalysis.ts"
  );
  const { VseLlm } = await import("../apps/server/vsellm.ts");
  let body = "";
  const client = new VseLlm("test", "test", async (_, opts) => {
    body = String(opts?.body);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "Недостаточно данных.",
              nextCheck: "Сверьте журнал.",
              refs: ["T1.priorityId"],
            }),
          },
        },
      ],
    });
  });
  const sim = normalize(
    { ...generate(1).rows[0], id: "SIM-AUTH-01" },
    "simulation",
  );
  await operationalReading(
    client,
    [sim],
    "simulation",
    "Может ли повторный показ формы означать цикл перенаправления? Контакт person@example.com, token=abcDEF1234567.",
  );
  assert.match(body, /цикл перенаправления/);
  assert.doesNotMatch(body, /person@example|abcDEF1234567/);
});
test("provider rejects new numbers even when the cited source is real", async () => {
  const { VseLlm } = await import("../apps/server/vsellm.ts");
  const client = new VseLlm("test", "test", async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "Пострадали 943 клиента.",
              nextCheck: "Сверьте масштаб.",
              refs: ["T1.priorityId"],
            }),
          },
        },
      ],
    }),
  );
  const result = await client.read({
    task: "Оцени влияние",
    facts: { "T1.priorityId": 4 },
    counts: { tickets: 1 },
  });
  assert.ok("error" in result);
});

test("a post-resolution flag cannot substantiate a provider's claim that a ticket was escalated", async () => {
  const { VseLlm } = await import("../apps/server/vsellm.ts");
  const client = new VseLlm("test", "test", async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "Заявка T1 эскалирована.",
              nextCheck: "Проверьте группу.",
              refs: ["T1.isNeedUp"],
            }),
          },
        },
      ],
    }),
  );
  const result = await client.read({
    task: "Проверьте заявку",
    facts: { "T1.isNeedUp": true },
  });
  assert.ok("error" in result);
  const { app, ask, wire } = await setup();
  try {
    const selection = await ask("Сколько заявок были эскалированы?");
    assert.match(selection.json().overview.join(" "), /источнике нет поля/iu);
    assert.equal(wire.length, 0);
  } finally {
    await app.close();
  }
});

test("private cases return only source-backed references and reject invented citations", async () => {
  const { app, wire, service, failValidation } = await setup();
  try {
    const { cases } = buildTriage([row], "priority", 3, Date.now());
    const result = await analyzeCase(cases[0], [row], service, "workspace");
    assert.equal(result.provider, "VseLLM");
    assert.deepEqual(result.evidence, [
      { id: row.id, field: "priorityId", value: "4" },
    ]);
    assert.doesNotMatch(wire[0], /PRIVATE_|INC-SECRET|SYS-SECRET/);
    failValidation();
    const result2 = await service.analyze(row, () => row, [], "workspace");
    assert.equal(result2.mode, "fallback");
    assert.match(result2.error ?? "", /VseLLM/);
    assert.doesNotMatch(
      JSON.stringify(result2),
      /T99|У заявки высший приоритет/,
    );
  } finally {
    await app.close();
  }
});
