import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/api.ts";
import { AnalysisService } from "../apps/server/analysis.ts";
import { Auth } from "../apps/server/auth.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { Store } from "../apps/worker/ingestion.ts";
import type { DB } from "../apps/server/db.ts";
import { normalize } from "../packages/domain/index.ts";

const database: DB = { query: async () => ({rows: []}), close: async () => {}, transaction: async () => { throw Error(); } };
function ticket(n: number, description: string) {
  return normalize({id: "PRIVATE-" + n, sysId: String(n), header: "Обращение клиента",
    description, productName: "PRIVATE_PRODUCT", stateId: 2, stateEnum: "WorkInProgress",
    state: "Выполняется", priorityId: 3, priority: "Высокий"}, "workspace");
}
async function fixture(remote?: VseLlm) {
  const store = new Store(database, "workspace");
  const auth = new Auth();
  for (const role of ["coordinator", "viewer"] as const) auth.sessions.set(auth.digest(role),
    {username: role, role, csrf:"csrf", expires: Date.now() + 60_000});
  const ai = new AnalysisService(database, undefined, 500, undefined, remote);
  const app = await createApp({auth, publicDemo:false, origin:"", secure:false, stores:new Map([["workspace",store]]), sources:new Map(), ai});
  const put = (...rows: ReturnType<typeof ticket>[]) => {
    store.rows = new Map(rows.map(row => [row.key, row])); store.revision++;
  };
  const get = async (url: string, role = "coordinator") =>
    (await app.inject({url, headers:{cookie:"wm_session=" + role}})).json();
  const board = (params = "", role?: string) => get("/api/dashboard?ns=workspace&register=1" + params, role);
  return {app, store, put, board, get};
}

test("live groups follow descriptions and have exact members after an edit", async t => {
  const {app, put, board} = await fixture();
  t.after(() => app.close());
  const a = ticket(1,"Не удаётся войти в кабинет."), b = ticket(2,"Ошибка авторизации."),
    c = ticket(3,"SMS с кодом не доставлено.");
  put(a,b,c);
  let result = await board();
  assert.equal(result.triage.groupBy, "semantic");
  assert.deepEqual(result.triage.cases.map((c:any) => c.count).sort(), [1,2]);
  assert.equal(new Set(result.triage.cases.map((c:any) => c.icon)).size, 2);
  assert.ok(result.triage.cases.every((c:any) => c.origin === "local"));
  const login = result.triage.cases.find((c:any) => c.count === 2);
  assert.match(login.label, /авторизац|вход/iu);
  const after = ticket(2,"SMS с кодом не доставлено.");
  put(a,after,c, ticket(4,"Скачанный отчёт пустой."));
  result = await board("&case=" + login.id);
  assert.deepEqual(result.register.items.map((r:any)=>r.id), ["PRIVATE-1"]);
  assert.equal(result.triage.cases.length, 3);
});

test("a bounded asynchronous model partition changes membership and titles using only symbolic profiles", async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let sent = "", calls = 0;
  const remote = new VseLlm("key","fixture",async (_url, init) => {
    sent = JSON.parse(String(init?.body)).messages[1].content;
    const {profiles} = JSON.parse(sent);
    calls++;
    await hold;
    const groups = profiles.filter((p:any)=> p.signs.includes("login")).map((p:any) => ({
      basis: p.signs.includes("portal") ? ["login","portal"] : ["login"],
      title: p.signs.includes("portal") ? "Сбои входа в кабинет" : "Сбои входа",
      icon:"login", profiles:[p.ref],
    }));
    return Response.json({choices:[{message:{content:JSON.stringify({groups})}}]});
  });
  const {app, put, board, get} = await fixture(remote);
  t.after(() => app.close());
  const a = ticket(1,"Не удаётся войти в кабинет. Иванов PRIVATE_SECRET"), b = ticket(2,"Ошибка авторизации.");
  put(a,b);
  assert.equal((await board("", "viewer")).triage.cases.length, 1);
  assert.equal(calls, 0);
  const initial = await board();
  assert.equal(initial.triage.cases.length, 1);
  await board();
  assert.equal(calls, 1);
  assert.doesNotMatch(sent, /Иванов|PRIVATE|Обращение клиента|Не удаётся войти|Ошибка авторизации\./iu);
  release(); await new Promise(resolve => setImmediate(resolve));
  const fresh = await board();
  assert.deepEqual(fresh.triage.cases.map((c:any) => c.label).sort(), ["Сбои входа","Сбои входа в кабинет"]);
  for (const group of fresh.triage.cases) {
    assert.equal(group.origin, "model");
    const selected = await board("&case=" + group.id);
    const detail = await get("/api/triage/"+group.id+"?ns=workspace&groupBy=semantic&revision=1&hash="+group.hash);
    assert.deepEqual(detail.items.map((r:any)=>r.id), selected.register.items.map((r:any)=>r.id));
    assert.equal(detail.total, 1);
  }
  put(ticket(1,"Не приходит код подтверждения."));
  const changed = await board();
  assert.equal(changed.triage.cases.length, 1);
  assert.match(changed.triage.cases[0].label, /уведомлен/iu);
});

test("unfamiliar repeated phrases group local tickets and retain the unrelated singleton", async t => {
  const {app, put, board} = await fixture();
  t.after(() => app.close());
  put(ticket(1,"Пропали синие отметки в карточке."),
    ticket(2,"Исчезли синие отметки из формы."), ticket(3,"Печать накладной завершается аварийно."));
  const result = await board();
  const group = result.triage.cases.find((c:any)=> c.count === 2);
  assert.match(group?.label ?? "", /синие отметки/iu);
  assert.deepEqual((await board("&case="+group.id)).register.items.map((r:any)=>r.id), ["PRIVATE-1","PRIVATE-2"]);
});

test("outdated inference cannot relabel a changed partition and count bands bound request churn", async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const packets: any[] = [];
  const remote = new VseLlm("key","fixture", async (_url,init) => {
    const packet = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    packets.push(packet);
    if (packets.length === 1) await hold;
    const groups = packet.profiles.map((p:any) => p.signs.includes("login")
      ? {basis:["login"],profiles:[p.ref],title:"Сбои входа",icon:"login"}
      : {basis:["message"],profiles:[p.ref],title:"Доставка уведомлений",icon:"bell"});
    return Response.json({choices:[{message:{content:JSON.stringify({groups})}}]});
  });
  const {app,put,board} = await fixture(remote); t.after(() => app.close());
  put(ticket(1,"Ошибка авторизации.")); await board();
  const sms = (n:number) => ticket(n,"SMS с кодом не доставлено.");
  put(sms(1),sms(2)); await board();
  release(); await new Promise(resolve => setImmediate(resolve));
  const current = await board();
  assert.equal(current.triage.cases[0].origin, "local");
  assert.doesNotMatch(current.triage.cases[0].label, /вход/u);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await board()).triage.cases[0].origin, "model");
  put(sms(1),sms(2),sms(3)); await board();
  assert.equal(packets.length, 2);
  put(sms(1),sms(2),sms(3),sms(4),sms(5)); await board();
  assert.equal(packets.length, 3);
  assert.deepEqual(packets.map(p=>p.profiles[0].volume),["1","2–4","5–19"]);
});

test("model rules keep only evidenced members when one reference, title or icon is unsupported", async t => {
  const remote = new VseLlm("key","fixture", async (_url,init) => {
    const packet = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const all = packet.profiles.map((p:any)=>p.ref);
    return Response.json({choices:[{message:{content:JSON.stringify({groups:[
      {basis:["login"], profiles:all, title:"Пожар в дата-центре", icon:"unsafe"},
      {basis:["message"], title:"Доставка уведомлений",icon:"bell"},
    ]})}}]});
  });
  const {app,put,board} = await fixture(remote); t.after(() => app.close());
  put(ticket(1,"Ошибка авторизации."),ticket(2,"Не приходит код подтверждения."));
  await board(); await new Promise(resolve=>setImmediate(resolve));
  const current = await board();
  assert.equal(current.triage.cases.filter((c:any)=>c.origin === "model").length,2);
  const login = current.triage.cases.find((c:any)=>c.label === "Ошибки авторизации");
  assert.equal(login.icon,"login");
  assert.deepEqual((await board("&case="+login.id)).register.items.map((r:any)=>r.id),["PRIVATE-1"]);
  assert.doesNotMatch(JSON.stringify(current.triage.cases),/Пожар|unsafe/u);
});
