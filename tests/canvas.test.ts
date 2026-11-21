import test from "node:test";
import assert from "node:assert/strict";
import type { LightMyRequestResponse } from "fastify";
import { createApp } from "../apps/server/api.ts";
import { Auth } from "../apps/server/auth.ts";
import { AnalysisService } from "../apps/server/analysis.ts";
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
      await ask("Покажи эскалации по командам")
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
