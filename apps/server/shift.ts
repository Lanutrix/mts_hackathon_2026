import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Incident } from "../../packages/domain/index.ts";
import { compareResponse, responseBands, responseRank } from "../../packages/domain/responseOrder.ts";
import type { Facet } from "../../packages/domain/triage.ts";
import type { ShiftOwner, ShiftTicket, ShiftView } from "../../packages/contracts/shift.ts";
import type { DB } from "./db.ts";
import type { Role } from "./auth.ts";
import type { LiveClusters } from "./liveClusters.ts";

const activeFor = 60_000;
const pageSize = 12;
type Source = { namespace: string; rows: Map<string, Incident>; simulation?: { runId: string } };
type ShiftEntry = ShiftOwner & { key: string };
const eligible = (row: Incident) =>
  row.sourcePresent && !row.quarantined && [0, 2, 20].includes(row.stateId!);

export function allocateShift(
  rows: Incident[],
  owners: Map<string, ShiftOwner>,
  active: string[],
  cluster: (ticket: Incident) => Facet,
  now: number,
) {
  const members = [...new Set(active)].sort().map((name) => ({ name, load: 0, clusters: new Set<string>() }));
  const ordered = rows.filter(eligible).sort((a, b) => compareResponse(a, b, now));
  const tasks = ordered.map((row) => {
    const { owner, version } = owners.get(row.key) ?? { owner: null, version: 0 };
    const facet = cluster(row);
    const rank = responseRank(row, now);
    const weight = rank <= 1 ? 3 : rank <= 3 ? 2 : 1;
    const holder = members.find((member) => member.name === owner);
    if (holder) {
      holder.load += weight;
      holder.clusters.add(facet.key);
    }
    const task: ShiftTicket = {
      id: row.id,
      header: String(row.raw.header || row.id),
      owner,
      version,
      suggested: null,
      basis: responseBands[rank].basis,
      cluster: facet.label,
      model: facet.origin === "model",
    };
    return { task, facet, weight };
  });
  for (const { task, facet, weight } of tasks) {
    if (task.owner || !members.length) continue;
    const least = Math.min(...members.map((m) => m.load));
    const available = members.filter((m) => m.load === least);
    const related = available.find((m) => m.clusters.has(facet.key));
    const next = related ?? available[0];
    task.suggested = next.name;
    task.basis +=
      related && available.length > 1
        ? " При равной нагрузке учтена работа с похожими заявками."
        : members.length > 1
          ? " Учтена нагрузка координаторов с поправкой на срочность."
          : " Сейчас на смене один координатор.";
    next.load += weight;
    next.clusters.add(facet.key);
  }
  return tasks.map((t) => t.task);
}

export const shiftWrite = "/api/shift/:id/owner";
export const shiftRead = "/api/shift";
type Context = {
  db: DB;
  clusters: LiveClusters;
  readStoreFor(req: FastifyRequest, reply: FastifyReply): Promise<Source | null | undefined>;
  requireRole(
    req: FastifyRequest,
    reply: FastifyReply,
    roles: Role[],
  ): { username: string; role: Role } | null;
};
export function registerShift(app: FastifyInstance, ctx: Context) {
  const seen = new Map<string, Map<string, number>>();
  let trainingRun = "";
  const trainingOwners = new Map<string, ShiftOwner>();
  function sourceState(source: Source, user: string) {
    const runId = source.simulation?.runId ?? "";
    if (runId && runId !== trainingRun) {
      seen.delete("simulation/" + trainingRun);
      trainingOwners.clear();
      trainingRun = runId;
    }
    const scope = source.namespace + "/" + runId;
    const roster = seen.get(scope) ?? new Map<string, number>();
    const now = Date.now();
    for (const [name, time] of roster) if (now - time >= activeFor) roster.delete(name);
    roster.set(user, now);
    seen.set(scope, roster);
    return { runId, roster, scope, now };
  }
  app.get(shiftRead, async (req, reply) => {
    const user = ctx.requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!user) return;
    const source = await ctx.readStoreFor(req, reply);
    if (!source) return;
    const state = sourceState(source, user.username);
    const q = req.query as Record<string, string>;
    if (state.runId)
      for (const key of trainingOwners.keys()) if (!source.rows.has(key)) trainingOwners.delete(key);
    const entries = state.runId
      ? trainingOwners
      : new Map(
          (
            await ctx.db.query<ShiftEntry>("SELECT key,owner,version FROM shift_owners WHERE namespace=$1", [
              source.namespace,
            ])
          ).rows.map((row) => [row.key, row]),
        );
    const cluster = ctx.clusters.read(state.scope, source.rows, true);
    const tasks = allocateShift(
      [...source.rows.values()],
      entries,
      [...state.roster.keys()],
      cluster,
      state.now,
    );
    const names = new Set(state.roster.keys());
    const counts = new Map<string, { taken: number; suggested: number }>();
    for (const t of tasks) {
      const who = t.owner ?? t.suggested;
      if (!who) continue;
      names.add(who);
      const c = counts.get(who) ?? { taken: 0, suggested: 0 };
      if (t.owner) c.taken++;
      else c.suggested++;
      counts.set(who, c);
    }
    const members = [...names]
      .sort()
      .map((name) => ({
        name,
        active: state.roster.has(name),
        ...(counts.get(name) ?? { taken: 0, suggested: 0 }),
      }));
    const list = tasks.filter((t) =>
      q.tab === "team"
        ? !!t.owner && t.owner !== user.username
        : q.tab === "mine"
          ? t.owner === user.username
          : !t.owner && t.suggested === user.username,
    );
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    return {
      runId: state.runId,
      members,
      rows: list.slice(offset, offset + pageSize),
      total: list.length,
      ticket: q.ticket ? (tasks.find((t) => t.id === q.ticket) ?? null) : null,
    } satisfies ShiftView;
  });
  app.post(shiftWrite, { bodyLimit: 4096 }, async (req, reply) => {
    const user = ctx.requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!user) return;
    const source = await ctx.readStoreFor(req, reply);
    if (!source) return;
    const { runId, roster } = sourceState(source, user.username);
    const b = req.body as { runId?: unknown; version?: number; owner?: unknown } | null;
    if (
      !b ||
      !Number.isSafeInteger(b.version) ||
      b.version! < 0 ||
      !(b.owner === null || typeof b.owner === "string")
    )
      return reply.code(400).send({ message: "Укажите версию назначения и получателя." });
    const conflict = () =>
      reply.code(409).send({ message: "Состояние смены изменилось. Проверьте обновлённую очередь." });
    if (runId !== b.runId) return conflict();
    const row = [...source.rows.values()].find((v) => v.id === (req.params as { id: string }).id);
    if (!row || !eligible(row)) return conflict();
    const requested = b.owner;
    if (requested !== null && !roster.has(requested))
      return reply.code(409).send({ message: "Получатель сейчас вне смены." });
    function allowed(previous?: ShiftOwner) {
      if ((previous?.version ?? 0) !== b!.version) return false;
      if (!previous?.owner) return requested === user!.username;
      return (
        previous.owner === user!.username ||
        user!.role === "demo-admin" ||
        (requested === user!.username && !roster.has(previous.owner))
      );
    }
    if (runId) {
      if (!allowed(trainingOwners.get(row.key))) return conflict();
      trainingOwners.set(row.key, { owner: requested, version: b.version! + 1 });
    } else {
      const saved = await ctx.db.transaction(async (db) => {
        // Serialize the first claim and every later transfer against one existing incident.
        const incident = await db.query<{ doc: Incident }>(
          "SELECT doc FROM incidents WHERE namespace=$1 AND key=$2 FOR UPDATE",
          [source.namespace, row.key],
        );
        if (!incident.rows[0] || !eligible(incident.rows[0].doc)) return false;
        const old = await db.query<ShiftOwner>(
          "SELECT owner,version FROM shift_owners WHERE namespace=$1 AND key=$2",
          [source.namespace, row.key],
        );
        if (!allowed(old.rows[0])) return false;
        await db.query(
          "INSERT INTO shift_owners(namespace,key,owner,version) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,key) DO UPDATE SET owner=EXCLUDED.owner,version=EXCLUDED.version",
          [source.namespace, row.key, requested, b.version! + 1],
        );
        await db.query(
          "INSERT INTO audit(at,actor,action,namespace,detail) VALUES($1,$2,'shift.owner',$3,$4)",
          [
            new Date().toISOString(),
            user.username,
            source.namespace,
            JSON.stringify({ id: row.id, owner: requested, version: b.version! + 1 }),
          ],
        );
        return true;
      });
      if (!saved) return conflict();
    }
    return { owner: requested, version: b.version! + 1 };
  });
}
