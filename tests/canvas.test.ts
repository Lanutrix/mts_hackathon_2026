import test from "node:test";
import assert from "node:assert/strict";
import type { LightMyRequestResponse } from "fastify";
import { createApp } from "../apps/server/api.ts";
import { Auth } from "../apps/server/auth.ts";
import { AnalysisService } from "../apps/server/analysis.ts";
import {
  answerInsightIds,
  insightDefinitions,
} from "../packages/contracts/answerInsights.ts";
import { CanvasService } from "../apps/server/canvas.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { Store } from "../apps/worker/ingestion.ts";
import type { DB } from "../apps/server/db.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, PRIORITIES } from "../packages/domain/index.ts";
import type { CanvasResult, CanvasPage } from "../packages/contracts/canvas.ts";

const db: DB = {
  query: async () => ({ rows: [] }),
  transaction: async () => {
    throw Error("Unexpected write");
  },
  close: async () => {},
};
async function setup(publicDemo = true) {
  let reply: unknown = {
    supported: true,
    groupBy: "product",
    layout: "comparison",
  };
  const prompts: string[] = [];
  const provider = new VseLlm("test", "test-model", async (_, options) => {
    prompts.push(String(options?.body));
    return Response.json({
      choices: [{ message: { content: JSON.stringify(reply) } }],
    });
  });
  const auth = new Auth();
  for (const role of ["viewer", "coordinator"] as const)
    auth.sessions.set(auth.digest(role), {
      username: role,
      role,
      csrf: "token",
      expires: Date.now() + 60000,
    });
  const stores = new Map(
    ["demo", "workspace"].map((ns) => {
      const store = new Store(db, ns);
      for (let i = 0; i < 47; i++) {
        const priorityId = (i % 4) + 1;
        const row = normalize(
          {
            ...generate(1).rows[0],
            id: "PRIVATE-ID-" + i,
            sysId: "sys-" + i,
            priorityId,
            priority: PRIORITIES[priorityId],
            stateEnum: "Assigned",
            stateId: 0,
            assignedGroupName: "PRIVATE-TEAM",
            productName: i === 46 ? "PRIVATE-LONE" : "PRIVATE-PRODUCT",
            assignedEmployee: "PRIVATE-PERSON",
            header: "PRIVATE-HEADER",
            description: "PRIVATE-TEXT",
            deadline:
              i % 2 === 0 ? "2020-01-01T00:00:00Z" : "2100-01-01T00:00:00Z",
            isNeedUp: i % 3 === 0,
          },
          ns,
        );
        store.rows.set(row.key, row);
      }
      return [ns, store] as const;
    }),
  );
  const app = await createApp({
    stores,
    sources: new Map(),
    auth,
    publicDemo,
    secure: false,
    origin: "http://local",
    ai: new AnalysisService(db, undefined, 100, undefined, provider),
  });
  const headers = (role = "coordinator") => ({
    cookie: "wm_session=" + role,
    "x-csrf-token": "token",
  });
  const ask = (
    question: string,
    context?: unknown,
    ns = "workspace",
    role = "coordinator",
  ) =>
    app.inject({
      method: "POST",
      url: "/api/canvas?ns=" + ns,
      headers: headers(role),
      payload: { question, context },
    });
  return {
    app,
    ask,
    headers,
    stores,
    prompts,
    respond: (value: unknown) => {
      reply = value;
    },
  };
}
test("canvas counts all open source IDs, pages stable selections and validates model plans", async () => {
  const { app, ask, headers, stores, prompts, respond } = await setup();
  try {
    const response = await app.inject({
      url: "/api/canvas?ns=workspace",
      headers: headers(),
    });
    assert.equal(response.statusCode, 200, response.body);
    const start = response.json<CanvasResult>();
    assert.equal(start.mode, "snapshot");
    assert.equal(start.total, 47);
    assert.equal(start.blocks[0]?.presentation, "deadline");
    assert.equal(
      start.blocks[0].groups.reduce((sum, group) => sum + group.count, 0),
      start.total,
    );
    const emptyStarter = await new CanvasService().read(
      { namespace: "unused", revision: 0, rows: new Map() },
      "viewer",
    );
    assert.deepEqual(emptyStarter.blocks, []);
    assert.equal(prompts.length, 0);
    const compared = (
      await ask("Сравни продукты по числу заявок")
    ).json<CanvasResult>();
    assert.equal(compared.mode, "model");
    assert.equal(compared.intent.layout, "comparison");
    assert.equal(compared.groups[0].count, 46);
    respond({ supported: true, filters: { deadline: "overdue" } });
    const follow = (
      await ask("А теперь только просроченные", compared.intent)
    ).json<CanvasResult>();
    assert.equal(follow.intent.groupBy, "product");
    assert.equal(follow.total, 24);
    assert.equal(follow.groups[0].overdue, 23);
    respond({ supported: true, groupBy: "team", layout: "groups" });
    const teams = (
      await ask("А по командам?", follow.intent)
    ).json<CanvasResult>();
    assert.equal(teams.total, 24);
    assert.equal(teams.groups[0].label, "PRIVATE-TEAM");
    stores.get("workspace")!.rows.clear();
    const url =
      "/api/canvas/tickets?ns=workspace&selection=" +
      compared.selection +
      "&group=" +
      compared.groups[0].key;
    let offset: number | null = 0;
    const ids = new Set<string>();
    do {
      const res: LightMyRequestResponse = await app.inject({
        url: url + "&offset=" + offset,
        headers: headers(),
      });
      assert.equal(res.statusCode, 200, res.body);
      const page: CanvasPage = res.json();
      assert.equal(page.total, 46);
      for (const item of page.items) ids.add(item.id);
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(ids.size, 46);
    respond({ supported: true, groupBy: "DROP", layout: "groups" });
    const invalid = (
      await ask("Покажи заявки с доработкой по командам")
    ).json<CanvasResult>();
    assert.equal(invalid.mode, "fallback");
    assert.equal(invalid.total, 0);
    assert.deepEqual(invalid.tickets, []);
  } finally {
    await app.close();
  }
});
test("named source values and private text stay local, even across turns", async () => {
  const { app, ask, prompts, respond } = await setup();
  try {
    respond({ supported: true, groupBy: "team", layout: "groups" });
    const r = (
      await ask(
        "Сгруппируй по командам для PRIVATE-LONE, PRIVATE-PERSON PRIVATE-HEADER PRIVATE-TEXT",
      )
    ).json<CanvasResult>();
    assert.equal(r.total, 1);
    assert.deepEqual(r.intent.filters.products, ["PRIVATE-LONE"]);
    const r2 = (
      await ask("А теперь по приоритету?", r.intent)
    ).json<CanvasResult>();
    assert.equal(r2.total, 1);
    assert.doesNotMatch(prompts.join(""), /PRIVATE-|sys-\d/);
    respond({ supported: false });
    const unsupported = (
      await ask("Сколько денег мы потеряли?")
    ).json<CanvasResult>();
    assert.equal(unsupported.mode, "unsupported");
    assert.ok(unsupported.suggestions.length > 0);
    assert.equal(unsupported.tickets.length, 0);
  } finally {
    await app.close();
  }
});
test("contextual VseLLM chart patches work without repeating the support flag", async () => {
  const { app, ask, respond } = await setup();
  try {
    let context = (
      await ask("Что такое инцидент?", {
        groupBy: "symptom",
        layout: "groups",
        filters: { products: ["PRIVATE-PRODUCT"] },
        blocks: [
          { groupBy: "deadline", layout: "groups", presentation: "deadline" },
        ],
      })
    ).json<CanvasResult>().intent;
    for (const [question, presentation] of [
      ["Покажи доли команд круговой диаграммой", "orbit"],
      ["Построй схему по командам", "flow"],
      ["Покажи матрицу по командам", "matrix"],
    ]) {
      respond(
        presentation === "orbit"
          ? { groupBy: "team", layout: "groups", presentation }
          : { presentation },
      );
      const result = (await ask(question, context)).json<CanvasResult>();
      assert.equal(result.mode, "model", question);
      assert.equal(result.provider, "VseLLM");
      assert.equal(result.intent.presentation, presentation);
      assert.equal(result.total, 46);
      assert.equal(result.intent.groupBy, "team");
      context = result.intent;
    }
    for (const [question, invalid] of [
      ["Покажи схему по статусам", {}],
      ["Покажи схему по продуктам", { presentation: "fake" }],
      ["Покажи схему по срокам", { presentation: "flow", supported: "true" }],
      ["Покажи схему по приоритетам", { presentation: "flow", script: "bad" }],
    ] as const) {
      respond(invalid);
      const result = (await ask(question, context)).json<CanvasResult>();
      assert.equal(result.mode, "fallback");
    }
  } finally {
    await app.close();
  }
});
test("questions about starting a shift and the most urgent work use the guide and current source queue", async () => {
  const { app, ask, respond, prompts } = await setup();
  try {
    respond({
      supported: true,
      groupBy: "deadline",
      layout: "groups",
      presentation: "spotlight",
      filters: { deadline: ["soon"] },
    });
    const shift = (await ask("С чего мне начать смену?")).json<CanvasResult>();
    assert.equal(shift.mode, "knowledge");
    assert.equal(shift.answer?.topic, "shift");
    assert.ok(shift.answer.sections.some((s) => s.role === "steps"));
    const urgent = (
      await ask("Что у нас сейчас самое срочное?", shift.intent)
    ).json<CanvasResult>();
    assert.equal(urgent.mode, "model");
    assert.equal(urgent.intent.presentation, "spotlight");
    assert.deepEqual(urgent.intent.filters, {});
    assert.equal(urgent.tickets[0].priority, PRIORITIES[4]);
    assert.equal(urgent.total, 47);
    assert.match(
      JSON.parse(JSON.parse(prompts.at(-1)!).messages[1].content).question,
      /срочн/u,
    );
    const soon = (
      await ask("Отбери заявки, у которых скоро истекает срок")
    ).json<CanvasResult>();
    assert.equal(soon.mode, "model");
    assert.equal(soon.intent.filters.deadline, "soon");
    respond({ supported: true, filters: { deadline: ["overdue", "soon"] } });
    const ambiguous = (
      await ask("Покажи ближайшие сроки")
    ).json<CanvasResult>();
    assert.equal(ambiguous.mode, "fallback");
  } finally {
    await app.close();
  }
});
test("post-resolution follow-up is measurable while escalation counts have no data field", async () => {
  const { app, ask, respond } = await setup();
  try {
    respond({
      supported: true,
      groupBy: "team",
      filters: { escalation: "yes" },
    });
    for (const question of [
      "Сколько эскалаций?",
      "Покажи эскалации по командам",
      "Какие заявки эскалированы?",
    ]) {
      const missing = (await ask(question)).json<CanvasResult>();
      assert.equal(missing.mode, "unsupported", question);
      assert.match(missing.notice ?? "", /эскалац/iu);
      assert.deepEqual(missing.tickets, []);
    }
    respond({ supported: true, groupBy: "team" });
    for (const question of [
      "Какие заявки требуют устранения последствий?",
      "Покажи заявки с доработкой после решения",
    ]) {
      const follow = (await ask(question)).json<CanvasResult>();
      assert.equal(follow.intent.filters.escalation, "yes", question);
      assert.equal(follow.total, 16, question);
    }
    const no = (
      await ask("Заявки без необходимости устранять последствия")
    ).json<CanvasResult>();
    assert.equal(no.intent.filters.escalation, "no");
    assert.equal(no.total, 31);
    const split = (
      await ask("Сгруппируй по необходимости устранения последствий")
    ).json<CanvasResult>();
    assert.equal(split.intent.groupBy, "escalation");
    assert.deepEqual(
      split.groups.map((item) => item.count),
      [31, 16],
    );
  } finally {
    await app.close();
  }
});
test("explicit overdue refinement survives contradictory VseLLM filters, clear and reset", async () => {
  const { app, ask, prompts, respond } = await setup();
  try {
    const context = {
      groupBy: "team",
      layout: "groups",
      blocks: [{ groupBy: "deadline", layout: "groups" }],
      filters: { products: ["PRIVATE-PRODUCT"] },
    };
    respond({
      supported: true,
      filters: { deadline: "unset" },
      reset: true,
      clear: ["products", "deadline"],
      blocks: [],
    });
    const result = (
      await ask("А теперь только просроченные", context)
    ).json<CanvasResult>();
    assert.deepEqual(result.intent, {
      ...context,
      filters: { ...context.filters, deadline: "overdue" },
    });
    assert.equal(result.total, 23);
    assert.ok(result.tickets.every((t) => t.overdue));
    assert.equal(result.blocks[0].groups[0].key, "overdue");
    const packet = JSON.parse(JSON.parse(prompts[0]).messages[1].content);
    assert.match(packet.question, /только просроченные/u);
    assert.doesNotMatch(prompts[0], /PRIVATE-/);
    respond({
      supported: true,
      clear: ["deadline"],
      groupBy: "priority",
      layout: "comparison",
    });
    const cleared = (
      await ask("Сними фильтр по срокам и сравни приоритеты", result.intent)
    ).json<CanvasResult>();
    assert.deepEqual(cleared.intent.filters, context.filters);
    assert.equal(cleared.total, 46);
    assert.equal(cleared.intent.groupBy, "priority");
  } finally {
    await app.close();
  }
});

test("compound views share an overdue refinement even when VseLLM repeats it inside a block", async () => {
  const { app, ask, respond } = await setup();
  try {
    const deadlineBlock = { groupBy: "deadline", layout: "groups" };
    respond({
      supported: true,
      groupBy: "team",
      layout: "groups",
      blocks: [deadlineBlock],
    });
    const first = (
      await ask("Сгруппируй по командам и рядом покажи сроки.")
    ).json<CanvasResult>();
    assert.equal(first.mode, "model");
    assert.equal(first.blocks.length, 1);
    for (const [question, blockFilters, expected] of [
      ["А теперь только просроченные", { deadline: "overdue" }, "model"],
      ["Оставь только просроченные заявки", { deadline: ["overdue"] }, "model"],
      [
        "Только заявки с просроченным дедлайном",
        { deadline: "soon" },
        "fallback",
      ],
      ["Отфильтруй просроченные инциденты", { unknown: "overdue" }, "fallback"],
    ] as const) {
      respond({
        supported: true,
        groupBy: "team",
        layout: "groups",
        filters: { deadline: "overdue" },
        blocks: [{ ...deadlineBlock, filters: blockFilters }],
      });
      const scoped = (await ask(question, first.intent)).json<CanvasResult>();
      assert.equal(scoped.mode, expected, question);
      assert.deepEqual(
        scoped.intent.filters,
        { deadline: "overdue" },
        question,
      );
      assert.deepEqual(scoped.intent.blocks, [deadlineBlock], question);
      assert.equal(scoped.total, 24, question);
      assert.deepEqual(
        scoped.blocks[0].groups.map((g) => [g.key, g.count]),
        [["overdue", 24]],
        question,
      );
    }
  } finally {
    await app.close();
  }
});
test("canvas session, CSRF, training toggle, role and context guards", async () => {
  const { app, ask, headers } = await setup();
  try {
    assert.equal(
      (await app.inject({ url: "/api/canvas?ns=demo" })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/canvas?ns=demo",
          method: "POST",
          headers: { cookie: headers("viewer").cookie },
          payload: { question: "Покажи просрочки" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await ask("Сравни продукты", undefined, "demo", "viewer")).statusCode,
      200,
    );
    assert.equal(
      (await ask("Сравни продукты", undefined, "simulation", "viewer"))
        .statusCode,
      200,
    );
    assert.equal(
      (await ask("Сравни продукты", undefined, "workspace", "viewer"))
        .statusCode,
      403,
    );
    assert.equal(
      (await ask("Сравни продукты", { groupBy: "SQL", filters: {} }))
        .statusCode,
      400,
    );
    const r = (
      await ask("Сравни продукты", undefined, "demo", "viewer")
    ).json<CanvasResult>();
    assert.equal(
      (
        await app.inject({
          url: "/api/canvas/tickets?ns=workspace&selection=" + r.selection,
          headers: headers("viewer"),
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
  const disabled = await setup(false);
  try {
    assert.equal(
      (await disabled.ask("Сравни продукты", undefined, "demo", "viewer"))
        .statusCode,
      403,
    );
    assert.equal(
      (await disabled.ask("Сравни продукты", undefined, "simulation", "viewer"))
        .statusCode,
      404,
    );
  } finally {
    await disabled.app.close();
  }
});
test("compound views count the same scope and drill into the selected dimension", async () => {
  const { app, ask, headers, respond } = await setup();
  try {
    const blocks = [
      { groupBy: "deadline", layout: "groups" },
      { groupBy: "priority", layout: "comparison" },
    ];
    respond({ supported: true, groupBy: "team", layout: "groups", blocks });
    const question =
      "Сгруппируй по командам и рядом покажи сроки, а также сравни приоритеты";
    const result = (await ask(question)).json<CanvasResult>();
    assert.equal(result.mode, "model");
    assert.deepEqual(result.intent.blocks, blocks);
    assert.equal(result.groups.length, 1);
    assert.equal(result.blocks.length, 2);
    for (const block of result.blocks) {
      assert.equal(
        block.groups.reduce((n, g) => n + g.count, 0),
        result.total,
      );
      assert.notEqual(block.selection, result.selection);
    }
    const deadline = result.blocks[0];
    const page = (
      await app.inject({
        url:
          "/api/canvas/tickets?ns=workspace&selection=" +
          deadline.selection +
          "&group=overdue",
        headers: headers(),
      })
    ).json<CanvasPage>();
    assert.equal(page.total, 24);
    assert.ok(page.items.every((t) => t.overdue));
    respond({
      supported: true,
      groupBy: "team",
      layout: "groups",
      blocks: [{ groupBy: "javascript", layout: "groups" }],
    });
    const fallback = (
      await ask("По командам и отдельно сроки")
    ).json<CanvasResult>();
    assert.equal(fallback.mode, "fallback");
    assert.equal(fallback.intent.groupBy, "team");
    assert.equal(fallback.blocks[0].groupBy, "deadline");
    assert.match(fallback.notice ?? "", /не прошёл проверку/);
    respond({ supported: true, filters: { products: ["E999"] } });
    const fabricated = (
      await ask("Сгруппируй по продуктам")
    ).json<CanvasResult>();
    assert.equal(fabricated.mode, "fallback");
    assert.equal(fabricated.total, 47);
  } finally {
    await app.close();
  }
});

test("the model can compose independently weighted plots and an explicit area metric leaves scope intact", async () => {
  const { app, ask, respond } = await setup();
  try {
    respond({
      supported: true,
      groupBy: "team",
      layout: "groups",
      weightBy: "overdue",
      blocks: [
        { groupBy: "priority", layout: "groups", weightBy: "escalated" },
      ],
    });
    const planned = (
      await ask("Сгруппируй заявки по командам")
    ).json<CanvasResult>();
    assert.equal(planned.mode, "model");
    assert.equal(planned.intent.weightBy, "overdue");
    assert.equal(planned.blocks[0].weightBy, "escalated");
    assert.deepEqual(
      planned.groups.map((g) => g.overdue),
      planned.groups.map((g) => g.overdue).sort((a, b) => b - a),
    );
    respond({
      supported: true,
      groupBy: "team",
      layout: "groups",
      weightBy: "count",
      filters: { deadline: "overdue" },
    });
    const explicit = (
      await ask("Сгруппируй по командам, размер по числу просроченных")
    ).json<CanvasResult>();
    assert.equal(explicit.intent.weightBy, "overdue");
    assert.equal(explicit.intent.filters.deadline, undefined);
    assert.equal(explicit.total, planned.total);
    respond({ supported: true, weightBy: "arbitrary-field" });
    const invalid = (
      await ask("Размер групп по числу доработок", explicit.intent)
    ).json<CanvasResult>();
    assert.equal(invalid.mode, "fallback");
    assert.equal(invalid.intent.weightBy, "escalated");
    assert.deepEqual(invalid.intent.filters, {});
  } finally {
    await app.close();
  }
});
test("counts use present, validated and distinct source IDs across dashboard lanes", async () => {
  const { app, ask, headers, stores, respond } = await setup();
  try {
    const store = stores.get("workspace")!;
    const first = [...store.rows.values()][0];
    store.rows.set("duplicate", { ...first, key: "duplicate" });
    for (const [id, st, extra] of [
      ["RESEARCH", 20, {}],
      ["CLOSED", 10, {}],
      ["MISSING", 0, { sourcePresent: false }],
      ["BAD", 0, { quarantined: true }],
    ] as const) {
      store.rows.set(id, { ...first, id, stateId: st, ...extra });
    }
    const result = (
      await app.inject({ url: "/api/canvas?ns=workspace", headers: headers() })
    ).json<CanvasResult>();
    assert.equal(result.total, 48);
    assert.equal(result.sourceTotal, 49);
    respond({
      supported: true,
      groupBy: "status",
      layout: "groups",
      filters: { states: [0, 2] },
    });
    const active = (
      await ask("Покажи активные заявки по статусам")
    ).json<CanvasResult>();
    assert.equal(active.total, 47);
  } finally {
    await app.close();
  }
});
test("refresh keeps the intent, recalculates fresh rows without a model, and pins every large compound block", async () => {
  const { app, headers, stores, prompts } = await setup();
  try {
    const source = stores.get("workspace")!;
    const first = [...source.rows.values()][0];
    source.rows.clear();
    for (let i = 0; i < 20_000; i++) {
      const id = "LARGE-" + i;
      source.rows.set(id, { ...first, key: id, id });
    }
    const context = {
      groupBy: "team",
      layout: "groups",
      filters: { deadline: "overdue" },
      blocks: [
        { groupBy: "deadline", layout: "groups" },
        { groupBy: "priority", layout: "comparison" },
      ],
    };
    const refresh = () =>
      app.inject({
        url: "/api/canvas?ns=workspace",
        method: "POST",
        headers: headers(),
        payload: { refresh: true, context },
      });
    const current = (await refresh()).json<CanvasResult>();
    assert.equal(current.mode, "snapshot");
    assert.deepEqual(current.intent, context);
    assert.equal(current.total, 20_000);
    assert.equal(current.blocks.length, 2);
    source.rows.delete("LARGE-0");
    const updated = (await refresh()).json<CanvasResult>();
    assert.equal(updated.total, 19_999);
    for (const block of [
      current,
      ...current.blocks,
      updated,
      ...updated.blocks,
    ]) {
      const page = await app.inject({
        url:
          "/api/canvas/tickets?ns=workspace&selection=" +
          block.selection +
          "&group=" +
          block.groups[0].key,
        headers: headers(),
      });
      assert.equal(page.statusCode, 200, page.body);
      assert.equal(page.json<CanvasPage>().total, block.groups[0].count);
    }
    assert.equal(prompts.length, 0);
  } finally {
    await app.close();
  }
});

test("definitions, examples and platform actions answer immediately from help and keep the analytical scope", async () => {
  const { app, ask, prompts, headers } = await setup();
  try {
    const filtered = {
      groupBy: "team",
      layout: "groups",
      filters: { deadline: "overdue" },
    };
    const incident = (
      await ask("Что такое инцидент?", filtered)
    ).json<CanvasResult>();
    assert.equal(incident.mode, "knowledge");
    assert.equal(incident.answer?.topic, "incident");
    assert.match(incident.answer!.lead, /незапланированный сбой/);
    assert.ok(
      incident.answer!.links.some((link) => link.anchor === "incident"),
    );
    assert.equal(incident.selection, "");
    assert.deepEqual(incident.groups, []);
    assert.deepEqual(incident.metrics, []);
    assert.deepEqual(incident.intent.filters, filtered.filters);
    const follow = (
      await ask("А можешь привести пример?", incident.intent)
    ).json<CanvasResult>();
    assert.equal(follow.answer?.topic, "incident");
    assert.deepEqual(
      follow.answer?.sections.map((section) => section.role),
      ["example"],
    );
    const refreshed = (
      await app.inject({
        method: "POST",
        url: "/api/canvas?ns=workspace",
        headers: headers(),
        payload: { refresh: true, context: follow.intent },
      })
    ).json<CanvasResult>();
    assert.deepEqual(refreshed.answer, follow.answer);
    assert.equal(refreshed.total, 0);
    for (const [question, topic] of [
      ["Инцидент — это что?", "incident"],
      ["Объясни разницу между проблемой и инцидентом", "problem"],
      ["Чем отличается инцидент от запроса на обслуживание?", "serviceRequest"],
      ["Что означает массовый сбой?", "massIncident"],
      ["Срез сам закрывает инциденты, верно?", "recommendation"],
      ["Как назначить исполнителя?", "assignment"],
      ["Что означает SLA?", "sla"],
      ["Что делать с инцидентом?", "lifecycle"],
      ["Привет!", "assistant"],
    ]) {
      const reply = (await ask(question)).json<CanvasResult>();
      assert.equal(reply.answer?.topic, topic, question);
      assert.ok(reply.answer!.sections.length, question);
    }
    for (const [question, topic, role] of [
      [
        "Как объяснить коллеге, чем авария в сервисе отличается от сообщения пользователя?",
        "incident",
        "distinction",
      ],
      [
        "Что именно я должен проверить перед эскалацией?",
        "escalation",
        "steps",
      ],
      [
        "Коллега спрашивает, чем отказ услуги отличается от обращения?",
        "incident",
        "distinction",
      ],
      [
        "Какие шаги нужны перед передачей тикета другому уровню поддержки для эскалации?",
        "escalation",
        "steps",
      ],
    ]) {
      const response = (await ask(question)).json<CanvasResult>();
      assert.equal(response.answer?.topic, topic, question);
      assert.ok(
        response.answer.sections.some((section) => section.role === role),
        question,
      );
      assert.ok(
        response.answer.links.some((link) => link.anchor === "ticket"),
        question,
      );
    }
    const double = (
      await ask("Что такое инцидент и что такое эскалация?")
    ).json<CanvasResult>();
    assert.deepEqual(double.intent.related, ["escalation"]);
    assert.ok(
      double.answer!.sections.some((section) =>
        section.body?.includes("другого уровня поддержки"),
      ),
    );
    assert.equal(prompts.length, 0);
    const data = (
      await ask("А теперь по командам", follow.intent)
    ).json<CanvasResult>();
    assert.equal(data.answer, undefined);
    assert.equal(data.intent.topic, undefined);
    assert.equal(data.total, 24);
  } finally {
    await app.close();
  }
});

test("mixed questions preserve explanatory links and calculate only from the requested analytical clause", async () => {
  const { app, ask, respond } = await setup();
  try {
    respond({ supported: true, groupBy: "team", layout: "groups" });
    for (const question of [
      "Что такое эскалация и покажи просроченные по командам",
      "Покажи просроченные по командам, а затем объясни что такое эскалация",
    ]) {
      const r = (await ask(question)).json<CanvasResult>();
      assert.equal(r.answer?.topic, "escalation", question);
      assert.equal(r.answer?.kind, "mixed");
      assert.equal(r.mode, "model");
      assert.deepEqual(r.intent.filters, { deadline: "overdue" });
      assert.equal(r.total, 24);
      assert.equal(r.groups[0].count, 24);
      assert.ok(r.selection);
    }
    const r = (
      await ask("Что такое инцидент и сколько денег мы потеряли?")
    ).json<CanvasResult>();
    assert.equal(r.answer?.kind, "knowledge");
    assert.match(r.notice ?? "", /недостаточно/);
    assert.equal(r.metrics.length, 0);
    const unknown = (
      await ask("Почему выросло число инцидентов?")
    ).json<CanvasResult>();
    assert.equal(unknown.mode, "unsupported");
    assert.equal(unknown.answer, undefined);
  } finally {
    await app.close();
  }
});

test("model routing accepts reviewed help ids only and never renders model-supplied prose or URLs", async () => {
  const { app, ask, respond, prompts } = await setup();
  try {
    respond({
      supported: true,
      guide: { topic: "assignment", focus: "steps" },
    });
    const reply = (
      await ask("Кому передают ответственность?")
    ).json<CanvasResult>();
    assert.equal(reply.mode, "model");
    assert.equal(reply.answer?.topic, "assignment");
    assert.ok(reply.answer?.sections[0].items?.length);
    assert.ok(prompts.length);
    respond({
      supported: true,
      guide: { topic: "assignment", href: "https://invalid.test" },
    });
    const invalid = (
      await ask("Кто берет ответственность?")
    ).json<CanvasResult>();
    assert.equal(invalid.answer, undefined);
    assert.doesNotMatch(JSON.stringify(invalid), /invalid\.test/);
    for (const context of [
      { topic: "__proto__" },
      { guideOnly: true },
      { presentation: "raw-svg" },
      { exhibits: ["median-load", "median-load"] },
    ])
      assert.equal(
        (
          await ask("Ещё", {
            groupBy: "team",
            layout: "groups",
            filters: {},
            ...context,
          })
        ).statusCode,
        400,
      );
  } finally {
    await app.close();
  }
});

test("presentation and evidence follow the question in model and offline paths; charts retain real group membership", async () => {
  const { app, ask, stores, respond } = await setup();
  try {
    respond({
      supported: true,
      groupBy: "product",
      layout: "groups",
      presentation: "squares",
    });
    const q = "Покажи схему по командам с медианой нагрузки";
    const model = (await ask(q)).json<CanvasResult>();
    assert.equal(model.intent.groupBy, "team");
    assert.equal(model.intent.presentation, "flow");
    assert.deepEqual(model.intent.exhibits, ["median-load"]);
    assert.equal(model.total, 47);
    const service = new CanvasService();
    const store = stores.get("workspace")!;
    for (const [question, presentation] of [
      ["Нарисуй круговую диаграмму по продуктам", "orbit"],
      ["Покажи рейтинг команд", "bars"],
      ["Выведи по командам тепловую карту", "matrix"],
      ["Нарисуй группы карточками", "cards"],
      ["Покажи команды в виде карточек групп", "cards"],
      [q, "flow"],
      ["Покажи шкалу сроков", "deadline"],
      ["Покажи заявки реестром", "register"],
      ["Резюме нагрузки", "brief"],
      ["Покажи одну конкретную заявку", "spotlight"],
    ]) {
      const result = await service.read(store, "operator", question);
      assert.equal(result.intent.presentation, presentation, question);
      assert.equal(result.total, 47, question);
    }
    const stats = await service.read(
      store,
      "operator",
      "Какова доля просрочек по командам?",
    );
    assert.equal(stats.total, 47);
    assert.equal(stats.intent.filters.deadline, undefined);
    assert.deepEqual(stats.intent.exhibits, ["overdue-rate"]);
    const follow = await service.read(
      store,
      "operator",
      "А теперь только просроченные",
      model.intent,
    );
    assert.equal(follow.intent.presentation, "flow");
    assert.deepEqual(follow.intent.exhibits, ["median-load"]);
    assert.equal(follow.total, 24);
    const knowledge = await service.read(
      store,
      "operator",
      "Что такое инцидент?",
    );
    assert.equal(knowledge.answer?.topic, "incident");
  } finally {
    await app.close();
  }
});

test("every source metric can be requested by its name, including completed and historical denominators", async () => {
  const { app, stores, ask, respond } = await setup();
  try {
    const store = stores.get("workspace")!;
    const row = [...store.rows.values()][0];
    store.rows.set("CLOSED", {
      ...row,
      key: "CLOSED",
      id: "CLOSED",
      stateId: 10,
    });
    store.rows.set("RESOLVED", {
      ...row,
      key: "RESOLVED",
      id: "RESOLVED",
      stateId: 7,
    });
    const offline = new CanvasService();
    for (const id of answerInsightIds) {
      const r = await offline.read(
        store,
        "operator",
        insightDefinitions[id].title,
      );
      assert.equal(r.insights?.[0]?.id, id, insightDefinitions[id].title);
      assert.deepEqual(r.intent.insightIds, [id], id);
    }
    const finished = await offline.read(
      store,
      "operator",
      "Медианное время решения",
    );
    assert.deepEqual(finished.intent.filters.states, [7, 10]);
    assert.equal(finished.total, 2);
    const latest = await offline.read(
      store,
      "operator",
      "Возраст очереди",
      finished.intent,
    );
    assert.equal(latest.total, 47);
    assert.equal(latest.intent.filters.states, undefined);
    const cards = await offline.read(
      store,
      "operator",
      "Покажи команды в виде карточек групп",
      (await offline.read(store, "operator")).intent,
    );
    const newMetric = await offline.read(
      store,
      "operator",
      "Возраст очереди",
      cards.intent,
    );
    assert.ok(newMetric.insights?.length);
    assert.equal(newMetric.intent.presentation, undefined);
    assert.deepEqual(newMetric.blocks, []);
    respond({ supported: true, groupBy: "team", presentation: "cards" });
    const modelNewMetric = (
      await ask("Возраст очереди", cards.intent)
    ).json<CanvasResult>();
    assert.equal(modelNewMetric.intent.presentation, undefined);
    assert.equal(modelNewMetric.insights?.[0].id, newMetric.insights?.[0].id);
    const combined = await offline.read(
      store,
      "operator",
      "Возраст очереди и тепловая карта команд",
      cards.intent,
    );
    assert.equal(combined.intent.presentation, "matrix");
    assert.equal(combined.insights?.[0].id, newMetric.insights?.[0].id);
    const intake = await offline.read(
      store,
      "operator",
      "Поступления за семь дней",
    );
    assert.equal(intake.total, 49);
    const explicit = await offline.read(
      store,
      "operator",
      "Медианное время решения среди открытых заявок",
    );
    assert.deepEqual(explicit.intent.filters.states, [0, 2, 20]);
    const ratio = await offline.read(
      store,
      "operator",
      "Полнота отметки о доработке",
    );
    assert.equal(ratio.intent.filters.escalation, undefined);
    assert.equal(ratio.total, 47);
    const scoped = await offline.read(
      store,
      "operator",
      "А теперь только просроченные",
      ratio.intent,
    );
    assert.deepEqual(scoped.intent.insightIds, ratio.intent.insightIds);
    assert.equal(scoped.total, 24);
    const refreshed = await offline.read(
      store,
      "operator",
      undefined,
      scoped.intent,
    );
    assert.deepEqual(refreshed.insights, scoped.insights);
    respond({
      supported: true,
      groupBy: "symptom",
      layout: "groups",
      insightIds: ["by-owner"],
    });
    const route = (await ask("Проанализируй нагрузку")).json<CanvasResult>();
    assert.equal(route.insights?.[0].id, "by-owner");
    assert.equal(route.mode, "model");
    respond({
      supported: true,
      groupBy: "status",
      filters: { escalation: "yes", states: [2] },
      insightIds: ["escalation-known"],
    });
    const corrected = (
      await ask("Полнота отметки о доработке")
    ).json<CanvasResult>();
    assert.equal(corrected.total, 47);
    const denied = (
      await ask(
        "Покажи доход и сколько денег потеряли, медианный возраст заявок",
      )
    ).json<CanvasResult>();
    assert.equal(denied.mode, "unsupported");
  } finally {
    await app.close();
  }
});
