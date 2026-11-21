import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  TEAM,
  hash,
  spaces,
  type Incident,
} from "../../packages/domain/index.ts";
import { facet } from "../../packages/domain/triage.ts";
import type { Role } from "./auth.ts";
import type { DB } from "./db.ts";

type Member = { id: string; label: string };
export type DispatchTeam = {
  name: string;
  product: number;
  symptom: number;
  both: number;
  members: Member[];
};
export type DispatchDecision = {
  version: number;
  actor: string;
  at: string;
  team: string;
  member: string | null;
  note: string;
  incidentRevision: number;
  sourceRevision: number;
};
export type DispatchView = {
  snapshot: string;
  incidentRevision: number;
  sourceRevision: number;
  recommended: string | null;
  product: string;
  symptom: string;
  teams: DispatchTeam[];
  history: DispatchDecision[];
  canSave: boolean;
  readOnlyReason: string;
};
type EvidenceStore = {
  namespace: string;
  rows: Map<string, Incident>;
  revision: number;
  acceptedAt: string;
  lastHash?: string;
};
type Session = { username: string; role: Role };
type Context = {
  db: DB;
  readStoreFor: (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<EvidenceStore | null | undefined>;
  identity: (req: FastifyRequest) => Session | null;
  requireRole: (
    req: FastifyRequest,
    reply: FastifyReply,
    roles: Role[],
  ) => Session | null;
};
type Command = {
  requestId: string;
  expectedVersion: number;
  snapshot: string;
  team: string;
  member: string | null;
  note: string;
};

const writers: Role[] = ["coordinator", "demo-admin"];
const writable = (ns: string) => ns === "workspace" || ns === "demo";
const textOrder = (a: string, b: string) =>
  a.localeCompare(b, "ru") || (a < b ? -1 : a > b ? 1 : 0);
const sourceToken = (
  namespace: string,
  ticketId: string,
  revision: number,
  at: string,
  digest: string,
) => hash([namespace, ticketId, revision, at, digest]);
const route = "/api/incident/:id/dispatch";

function evidence(
  rows: Map<string, Incident>,
  target: Incident,
  includeMembers: boolean,
) {
  const product = facet(target, "product");
  const symptom = facet(target, "symptom");
  const teams = new Map<string, DispatchTeam>();
  const roster = new Map<string, Map<string, Member>>();
  for (const r of rows.values()) {
    if (!r.sourcePresent || r.quarantined || !r.team) continue;
    let team = teams.get(r.team);
    if (!team) {
      team = { name: r.team, product: 0, symptom: 0, both: 0, members: [] };
      teams.set(r.team, team);
      roster.set(r.team, new Map());
    }
    if (includeMembers) {
      const login = spaces(r.raw.assignedEmployeeLogin);
      const name = spaces(r.raw.assignedEmployee);
      if (login || name) {
        const id = login ? "login:" + login : "name:" + name;
        roster
          .get(r.team)!
          .set(id, {
            id,
            label: name && login ? name + " (" + login + ")" : name || login,
          });
      }
    }
    // The ticket's own assignment belongs to the catalogue, never to its evidence.
    if (r.key === target.key) continue;
    const sameProduct =
      !!product.key && facet(r, "product").key === product.key;
    const sameSymptom =
      symptom.key !== "unknown" && facet(r, "symptom").key === symptom.key;
    if (sameProduct) team.product++;
    if (sameSymptom) team.symptom++;
    if (sameProduct && sameSymptom) team.both++;
  }
  const ranked = [...teams.values()].sort(
    (a, b) =>
      b.both - a.both ||
      b.symptom - a.symptom ||
      b.product - a.product ||
      textOrder(a.name, b.name),
  );
  for (const team of ranked)
    team.members = [...roster.get(team.name)!.values()].sort((a, b) =>
      textOrder(a.label, b.label),
    );
  const matched = ranked.filter((t) => t.product || t.symptom);
  // A matching specialist group is a destination even if the dispatch desk
  // currently owns more tickets while they are waiting to be routed.
  const recommended =
    (matched.find((t) => t.name !== TEAM) ?? matched[0])?.name ?? null;
  return {
    teams: ranked,
    recommended,
    product: product.label,
    symptom: symptom.label,
  };
}

function unavailable(ticket: Incident) {
  if (!ticket.sourcePresent) return "Обращение отсутствует в текущей выгрузке.";
  if (ticket.quarantined) return "Поля обращения требуют сверки.";
  if (ticket.stateId === 7 || ticket.stateId === 10)
    return "Обращение завершено или закрыто.";
  return "";
}

function validCommand(value: unknown): value is Command {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Command>;
  return (
    typeof b.requestId === "string" &&
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(b.requestId) &&
    Number.isSafeInteger(b.expectedVersion) &&
    b.expectedVersion! >= 0 &&
    typeof b.snapshot === "string" &&
    /^[\da-f]{64}$/.test(b.snapshot) &&
    typeof b.team === "string" &&
    !!b.team &&
    (b.member === null || typeof b.member === "string") &&
    typeof b.note === "string" &&
    b.note.length <= 500
  );
}

class DispatchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const conflict = () =>
  new DispatchError(
    409,
    "Исходные данные или решение изменились. Обновите маршрут и проверьте выбор.",
  );
function fail(reply: FastifyReply, error: unknown) {
  return error instanceof DispatchError
    ? reply.code(error.status).send({ message: error.message })
    : reply
        .code(503)
        .send({
          message:
            "Журнал маршрутизации временно недоступен. Повторите запрос.",
        });
}

export function registerDispatch(app: FastifyInstance, ctx: Context) {
  app.get(route, async (req, reply) => {
    const store = await ctx.readStoreFor(req, reply);
    if (!store) return;
    const ticket = [...store.rows.values()].find(
      (i) => i.id === (req.params as { id: string }).id,
    );
    if (!ticket) return reply.code(404).send({ message: "Инцидент не найден" });
    const user = ctx.identity(req);
    const privileged =
      writable(store.namespace) && !!user && writers.includes(user.role);
    const catalog = evidence(store.rows, ticket, privileged);
    const readOnlyReason = !writable(store.namespace)
      ? "Источник доступен только для просмотра."
      : !privileged
        ? "Сохранение решения доступно координатору и администратору."
        : unavailable(ticket) ||
          (catalog.teams.length ? "" : "В выгрузке нет назначенных команд.");
    const view: DispatchView = {
      ...catalog,
      snapshot: sourceToken(
        store.namespace,
        ticket.id,
        store.revision,
        store.acceptedAt,
        store.lastHash || "",
      ),
      incidentRevision: ticket.revision,
      sourceRevision: store.revision,
      history: [],
      canSave: !readOnlyReason,
      readOnlyReason,
    };
    if (privileged) {
      try {
        const { rows } = await ctx.db.query<{ decision: DispatchDecision }>(
          "SELECT decision FROM dispatch_decisions WHERE namespace=$1 AND key=$2 ORDER BY version DESC LIMIT 20",
          [store.namespace, ticket.key],
        );
        view.history = rows.map((r) => r.decision);
      } catch (error) {
        return fail(reply, error);
      }
    }
    return view;
  });

  app.post(route, { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const user = ctx.requireRole(req, reply, writers);
    if (!user) return;
    const store = await ctx.readStoreFor(req, reply);
    if (!store) return;
    const ns = store.namespace;
    if (!writable(ns))
      return reply
        .code(403)
        .send({ message: "Источник доступен только для просмотра." });
    const b = req.body;
    if (!validCommand(b))
      return reply
        .code(400)
        .send({
          message:
            "Проверьте команду, версию и длину комментария (до 500 символов).",
        });
    const id = (req.params as { id: string }).id;
    const rows = store.rows;
    const snapshot = sourceToken(
      ns,
      id,
      store.revision,
      store.acceptedAt,
      store.lastHash || "",
    );
    const requestHash = hash([
      b.expectedVersion,
      b.snapshot,
      b.team,
      b.member,
      b.note,
    ]);
    try {
      return await ctx.db.transaction(async (tx) => {
        // Serialize decisions for this incident and synchronize with ingestion/reset.
        const row = (
          await tx.query<{ doc: Incident }>(
            "SELECT doc FROM incidents WHERE namespace=$1 AND id=$2 FOR UPDATE",
            [ns, id],
          )
        ).rows[0]?.doc;
        if (!row) throw new DispatchError(404, "Инцидент не найден");
        const replay = (
          await tx.query<{ decision: DispatchDecision; request_hash: string }>(
            "SELECT decision, request_hash FROM dispatch_decisions WHERE namespace=$1 AND key=$2 AND actor=$3 AND request_id=$4",
            [ns, row.key, user.username, b.requestId],
          )
        ).rows[0];
        if (replay) {
          if (replay.request_hash !== requestHash) throw conflict();
          return { decision: replay.decision };
        }
        const mark = (
          await tx.query(
            "SELECT revision,accepted_at,hash FROM watermarks WHERE namespace=$1 FOR SHARE",
            [ns],
          )
        ).rows[0];
        if (
          !mark ||
          snapshot !== b.snapshot ||
          sourceToken(ns, id, mark.revision, mark.accepted_at, mark.hash) !==
            b.snapshot
        )
          throw conflict();
        if (unavailable(row)) throw new DispatchError(409, unavailable(row));
        const last =
          (
            await tx.query<{ version: number }>(
              "SELECT version FROM dispatch_decisions WHERE namespace=$1 AND key=$2 ORDER BY version DESC LIMIT 1",
              [ns, row.key],
            )
          ).rows[0]?.version ?? 0;
        if (last !== b.expectedVersion) throw conflict();
        const team = evidence(rows, row, true).teams.find(
          (t) => t.name === b.team,
        );
        const member = team?.members.find((m) => m.id === b.member);
        if (!team || (b.member !== null && !member))
          throw new DispatchError(
            400,
            "Выберите команду и её исполнителя из текущей выгрузки.",
          );
        const decision: DispatchDecision = {
          version: last + 1,
          actor: user.username,
          at: new Date().toISOString(),
          team: team.name,
          member: member?.label ?? null,
          note: b.note.trim(),
          incidentRevision: row.revision,
          sourceRevision: mark.revision,
        };
        await tx.query(
          "INSERT INTO dispatch_decisions(namespace,key,version,actor,request_id,request_hash,decision) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            ns,
            row.key,
            decision.version,
            user.username,
            b.requestId,
            requestHash,
            JSON.stringify(decision),
          ],
        );
        return { decision };
      });
    } catch (error) {
      return fail(reply, error);
    }
  });
  return route;
}
