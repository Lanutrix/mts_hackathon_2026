import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  FIELDS,
  PRIORITIES,
  STATES,
  TEAM,
  canonical,
  parseSnapshot,
  transition,
  type Group,
  type Incident,
  type Raw,
} from "../../packages/domain/index.ts";
import { atomicWrite } from "./demo.ts";
import { IncidentArrivals } from "./incidentArrivals.ts";
import { TrainingError, trainingPatch, type TrainingCommand } from "./trainingActions.ts";

export interface JuryIncident {
  id: string;
  key: string;
  revision: number;
  header: string;
  product: string;
  team: string;
  assignee: string | null;
  state: string;
  priority: string;
  deadline: string | null;
  groups: Group[];
  description: string;
}

export interface JuryEvent extends JuryIncident {
  reasons: string[];
  at: string;
}

export interface JurySnapshot {
  runId: string;
  revision: number;
  step: number;
  nextAt: string | null;
  incidents: JuryIncident[];
  events: JuryEvent[];
  time: string;
  arrivals: ReturnType<IncidentArrivals["status"]>;
}

export interface SimulationOptions {
  stepDelays?: readonly [number, number, number, number, number];
  temporaryRoot?: string;
  graceMs?: number;
  arrivalRandom?: () => number;
}

const defaultDelays = [5_000, 9_000, 10_000, 9_000, 9_000] as const;
const maxEvents = 24;
const maxViewers = 80;

// These six synthetic tickets enter through the same export as the moving
// ticket. The initial import establishes their baseline without notifications.
function backgroundTickets(identity: string, now: number): Raw[] {
  const seeds = [
    [
      "AUTH-01",
      "Личный кабинет",
      "Ошибки авторизации",
      "При вводе верного пароля форма входа снова запрашивает пароль.",
      "Команда идентификации",
      4,
      -8,
      true,
      2,
    ],
    [
      "AUTH-02",
      "Мобильное приложение",
      "Ошибка входа в приложение",
      "Вход по коду возвращает ошибку при обмене токена.",
      "Мобильная платформа",
      3,
      12,
      false,
      2,
    ],
    [
      "AUTH-03",
      "Личный кабинет",
      "Не удаётся войти в кабинет",
      "После подтверждения кода клиент снова видит экран входа.",
      "Команда идентификации",
      3,
      45,
      null,
      2,
    ],
    [
      "NET-01",
      "Домашний интернет",
      "Рост времени ответа",
      "Замеры из двух точек показывают задержку ответа узла доступа.",
      "Транспортная сеть",
      3,
      9,
      true,
      2,
    ],
    [
      "NET-02",
      "Домашний интернет",
      "Задержка ответа узла",
      "Во время проверки узел доступа отвечал медленнее обычного.",
      "Транспортная сеть",
      2,
      null,
      false,
      20,
    ],
    [
      "PAY-01",
      "Платёжный шлюз",
      "Ошибка при оплате",
      "При подтверждении оплаты шлюз возвращает отказ. Идентификаторы операций переданы на проверку.",
      "Сопровождение платежей",
      3,
      55,
      false,
      0,
    ],
  ] as const;
  return seeds.map(
    (
      [id, product, header, description, team, priority, minutes, up, state],
      index,
    ) => ({
      ...Object.fromEntries(FIELDS.map((field) => [field, null])),
      sysId: identity + "-bg-" + id,
      id: "SIM-" + id,
      productName: product,
      header,
      description,
      assignedGroupName: team,
      stateId: state,
      stateEnum: STATES[state].enum,
      state: STATES[state].label,
      priorityId: priority,
      priority: PRIORITIES[priority],
      isNeedUp: up,
      serviceTypeId: index < 3 ? 10 : 30,
      serviceType: index < 3 ? "Клиентский" : "Технологический",
      submitDate: new Date(now - (62 - index) * 60_000).toISOString(),
      deadline:
        minutes === null
          ? null
          : new Date(now + minutes * 60_000).toISOString(),
    }),
  );
}

// The synthetic exporter changes only raw ITSM fields. It has no access to the
// observer's normalized incidents, group membership or notification journal.
function sourceRow(
  row: Raw,
  step: number,
  identity: string,
  cycle: number,
  now: number,
): Raw {
  const at = new Date(now).toISOString();
  switch (step) {
    case 0:
      return {
        ...Object.fromEntries(FIELDS.map((field) => [field, null])),
        sysId: `${identity}-${cycle}`,
        id: `SIM-${String(cycle).padStart(3, "0")}`,
        header: "Часть платежей не проходит",
        productName: "Платёжный шлюз",
        description:
          "Мониторинг обнаружил ошибки при оплате. Дежурный инженер проверяет ответы платёжного шлюза.",
        assignedGroupName: "Сопровождение платежей",
        assignedEmployee: "Дежурный инженер",
        stateId: 0,
        stateEnum: STATES[0].enum,
        state: STATES[0].label,
        priorityId: 2,
        priority: PRIORITIES[2],
        submitDate: at,
        lastAssignmentToTeamDateTime: at,
        deadline: new Date(now + 30 * 60_000).toISOString(),
        receivingChannel: "Мониторинг",
      };
    case 1:
      return {
        ...row,
        priorityId: 4,
        priority: PRIORITIES[4],
        stateId: 2,
        stateEnum: STATES[2].enum,
        state: STATES[2].label,
        description:
          "Доля неуспешных операций выросла. Команда платёжного шлюза проверяет соединение с банком.",
      };
    case 2:
      return {
        ...row,
        assignedGroupName: TEAM,
        assignedEmployee: "Дежурный координатор",
        lastAssignmentToTeamDateTime: at,
        description:
          "В учебной выгрузке изменились группа и исполнитель. Инцидент назначен дежурной группе координаторов.",
      };
    case 3:
      return { ...row, deadline: new Date(now + 10 * 60_000).toISOString() };
    case 4:
      return {
        ...row,
        stateId: 7,
        stateEnum: STATES[7].enum,
        state: STATES[7].label,
        completionDate: at,
        solution: "Платёжный трафик переведён на резервное соединение.",
        description:
          "Платёжный трафик переведён на резервное соединение. Контрольные операции прошли успешно.",
      };
    default:
      throw new Error("Неизвестный шаг симуляции");
  }
}

function forViewer(item: Incident): JuryIncident {
  return {
    id: item.id,
    key: item.key,
    revision: item.revision,
    header: String(item.raw.header),
    product: String(item.raw.productName),
    team: item.team,
    assignee:
      typeof item.raw.assignedEmployee === "string"
        ? item.raw.assignedEmployee
        : null,
    state: item.stateLabel,
    priority: item.priorityLabel,
    deadline: item.dates.deadline,
    groups: item.groups,
    description: String(item.raw.description),
  };
}

interface Version {
  revision: number;
  kind: "created" | "updated";
  at: string;
  changed: string[];
  before_doc: Incident | null;
  after_doc: Incident;
  actor?: string;
  action?: TrainingCommand["action"];
}

interface Accepted {
  snapshot: JurySnapshot;
  rows: Map<string, Incident>;
  versions: Map<string, Version[]>;
}

type TrainingOperation = { id: string; actor: string; action: TrainingCommand["action"] };

// Keep the JSON export and its queryable ticket history bounded together.
// Every event in the 24-item journal still has a corresponding ticket.
const maxTickets = 12;

function retainRecent(rows: Raw[], limit: number, referenced: Set<string>): Raw[] {
  const cutoff = rows.length - limit;
  return cutoff > 0
    ? rows.filter((row, index) => index >= cutoff || referenced.has(String(row.id)))
    : rows;
}

function accept(
  previous: Accepted | undefined,
  candidates: Incident[],
  runId: string,
  revision: number,
  step: number,
  nextAt: string,
  currentId: string,
  arrivals: ReturnType<IncidentArrivals["status"]>,
  operation?: TrainingOperation,
) {
  const now = Date.now();
  const time = new Date(now).toISOString();
  const rows = new Map<string, Incident>();
  const versions = new Map<string, Version[]>();
  let events = previous?.snapshot.events ?? [];
  for (const candidate of candidates) {
    const before = previous?.rows.get(candidate.key);
    const history = previous?.versions.get(candidate.key) ?? [];
    if (before?.hash === candidate.hash) {
      rows.set(candidate.key, before);
      versions.set(candidate.key, history);
      continue;
    }
    const { incident, reasons } = transition(before, candidate);
    incident.revision = revision;
    incident.updatedAt = time;
    rows.set(incident.key, incident);
    const changed = Object.keys({ ...before?.raw, ...incident.raw }).filter(
      (field) =>
        canonical(before?.raw[field]) !== canonical(incident.raw[field]),
    );
    const entry: Version = {
      revision,
      kind: before ? "updated" : "created",
      at: time,
      changed,
      before_doc: before ?? null,
      after_doc: incident,
      ...(operation?.id === incident.id ? { actor: operation.actor, action: operation.action } : {}),
    };
    versions.set(incident.key, [entry, ...history].slice(0, 50));
    if (previous && reasons.length) {
      events = [
        { ...forViewer(incident), reasons, revision, at: time },
        ...events,
      ].slice(0, maxEvents);
    }
  }
  const active = [...rows.values()].find((r) => r.id === currentId)!;
  const incidents = [forViewer(active)];
  if (operation && operation.id !== currentId) {
    const edited = candidates.find(row => row.id === operation.id)!;
    incidents.push(forViewer(rows.get(edited.key)!));
  }
  const snapshot: JurySnapshot = {
    runId,
    revision,
    step,
    nextAt,
    incidents,
    events,
    time,
    arrivals,
  };
  return {
    namespace: "simulation",
    revision,
    acceptedAt: time,
    rows,
    versions,
    snapshot,
    simulation: { runId, step, nextAt, currentId: active.id, arrivals },
    status: {
      state: "live" as const,
      checkedAt: time,
      error: null,
      metrics: {},
    },
    history(key: string, maxRevision = revision) {
      return (versions.get(key) ?? []).filter(
        (entry) => entry.revision <= maxRevision,
      );
    },
    statusChanges(keys: string[], maxRevision: number) {
      const state = (row: Incident | null) => row?.sourcePresent && !row.quarantined ? row.stateId : null;
      return keys.flatMap(key => (versions.get(key) ?? []).filter(entry => entry.revision <= maxRevision)
        .map(entry => ({ key, at: entry.at, fromState: state(entry.before_doc), toState: state(entry.after_doc) }))
        .reverse());
    },
    notificationCounts(_user: string, maxRevision: number) {
      const total = events.filter(event => event.revision <= maxRevision).length;
      return { total, unread: total };
    },
    notifications(
      _user: string,
      after = 0,
      maxRevision = revision,
      offset = 0,
    ) {
      return events
        .filter(
          (event) => event.revision > after && event.revision <= maxRevision,
        )
        .slice(offset, offset + 200)
        .map((event) => ({
          ...event,
          namespace: "simulation",
          read: false,
          snapshot: event,
        }));
    },
  };
}

type ReadView = ReturnType<typeof accept>;

function startRun(
  signal: AbortSignal,
  publish: (view: ReadView) => void,
  options: SimulationOptions,
) {
  const runId = randomUUID();
  const model = new IncidentArrivals(runId, options.arrivalRandom);
  const overrides = new Map<string, Raw>();
  let latest: ReadView | undefined;
  let file: string;
  let pending: Promise<unknown> = Promise.resolve();

  // Both a generator tick and a coordinator action replace one file, accept
  // its entire contents and publish one immutable revision before the next writer.
  function exclusive<T>(operation: () => Promise<T>) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }

  async function commit(
    rows: Raw[], step: number, nextAt: string, currentId: string,
    operation?: TrainingOperation,
  ) {
    if (signal.aborted) throw new TrainingError(409, "Учебная сессия завершилась.");
    await atomicWrite(file, JSON.stringify(rows));
    const parsed = parseSnapshot(await readFile(file, "utf8"), "simulation");
    if (signal.aborted) throw new TrainingError(409, "Учебная сессия завершилась.");
    latest = accept(latest, parsed.rows, runId, (latest?.revision ?? 0) + 1, step, nextAt, currentId, model.status(), operation);
    publish(latest);
    return latest;
  }

  function change(id: string, command: TrainingCommand, actor: string) {
    return exclusive(async () => {
      const view = latest;
      if (signal.aborted || !view || command.runId !== runId)
        throw new TrainingError(409, "Учебная сессия сменилась. Обновите карточку.", runId);
      const ticket = [...view.rows.values()].find(row => row.id === id);
      if (!ticket) throw new TrainingError(404, "Учебный инцидент не найден.");
      if (command.expectedRevision !== ticket.revision)
        throw new TrainingError(409, "Инцидент изменился. Обновите карточку.", runId, ticket.revision);
      const patch = trainingPatch(command, ticket, view.rows);
      if (Object.keys(patch).every(field => patch[field] === ticket.raw[field]))
        return { runId, revision: ticket.revision, incident: ticket };
      const raw = { ...ticket.raw, ...patch };
      const rows = [...view.rows.values()].map(other => other.key === ticket.key ? raw : other.raw);
      const { step, nextAt, currentId } = view.simulation;
      const updated = await commit(rows, step, nextAt, currentId, { id, actor, action: command.action });
      // Keep explicitly edited fields during subsequent scripted updates. A
      // manually resolved ticket has a final record and no later scripted steps.
      overrides.set(id, command.action === "resolve" ? raw : { ...overrides.get(id), ...patch });
      const incident = updated.rows.get(ticket.key)!;
      return { runId, revision: incident.revision, incident };
    });
  }

  async function generate() {
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "watermelon-jury-"));
    file = join(directory, "incidents.json");
    const delays = options.stepDelays ?? defaultDelays;
    let modelRows: Raw[] = [];
    let displayElapsed = 0;
    let records: Raw[] = [];
    const background = backgroundTickets(runId, Date.now());
    try {
      for (let tick = 0; !signal.aborted; tick++) {
        const step = tick % delays.length;
        const cycle = Math.floor(tick / delays.length) + 1;
        await exclusive(async () => {
          const now = Date.now();
          const last = records.at(-1) ?? {};
          // This step specifically narrates a reassignment. Skip it when a
          // coordinator already chose the team, including its generated text.
          const routed = step === 2 && overrides.get(String(last.id))?.assignedGroupName !== undefined;
          const raw = routed ? last : sourceRow(last, step, runId, cycle, now);
          if (step === 0) records.push(raw);
          else records[records.length - 1] = raw;
          modelRows.push(...model.advance(displayElapsed, now));
          const pinned = new Set(latest?.snapshot.events.map(event => event.id));
          records = retainRecent(records, maxTickets, pinned);
          modelRows = retainRecent(modelRows, 96, pinned);
          const batch = [...modelRows, ...records, ...background];
          const rows = batch.map(row => {
            const patch = overrides.get(String(row.id));
            return patch ? { ...row, ...patch } : row;
          });
          await commit(rows, step, new Date(now + delays[step]).toISOString(), String(raw.id));
          const presentIds = new Set(batch.map(row => String(row.id)));
          for (const id of overrides.keys()) if (!presentIds.has(id)) overrides.delete(id);
        });
        displayElapsed = delays[step];
        await wait(delays[step], undefined, { signal });
      }
    } catch (error) {
      if (!(signal.aborted && ((error as Error).name === "AbortError" || error instanceof TrainingError))) throw error;
    } finally {
      await pending;
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
  return { done: generate(), change };
}

function frame(event: string, data: unknown, id?: string | number) {
  return (
    (id === undefined ? "" : `id: ${id}\n`) +
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

type Viewer = {
  authorized: () => boolean;
  protocol: "snapshot" | "dashboard";
  initial: boolean;
  cursor: number;
};

export function registerJurySimulation(
  app: FastifyInstance,
  publicDemo: boolean,
  options: SimulationOptions = {},
  authorized: (request: FastifyRequest) => boolean = () => true,
) {
  const viewers = new Map<ServerResponse, Viewer>();
  let current:
    | {
        controller: AbortController;
        done: Promise<void>;
        first: Promise<ReadView | undefined>;
        change: ReturnType<typeof startRun>["change"];
      }
    | undefined;
  let latest: ReadView | undefined;
  let grace: NodeJS.Timeout | undefined;
  let closing = false;

  function write(viewer: ServerResponse, message: string) {
    if (!viewers.get(viewer)?.authorized()) {
      viewer.end();
      return;
    }
    if (viewer.writableNeedDrain) viewer.destroy();
    else if (!viewer.destroyed && !viewer.writableEnded) viewer.write(message);
  }

  function endViewers() {
    for (const viewer of viewers.keys()) {
      if (viewer.writableNeedDrain) viewer.destroy();
      else viewer.end();
    }
    viewers.clear();
  }

  function idle() {
    clearTimeout(grace);
    if (!closing && !viewers.size)
      grace = setTimeout(
        () => current?.controller.abort(),
        options.graceMs ?? 12_000,
      );
  }

  function deliver(
    response: ServerResponse,
    viewer: Viewer,
    view: ReadView,
    snapshotFrame: string,
  ) {
    if (viewer.protocol === "snapshot") write(response, snapshotFrame);
    else if (viewer.initial) {
      write(
        response,
        frame(
          viewer.cursor === view.revision ? "ready" : "resync",
          {
            revision: view.revision,
            runId: view.simulation.runId,
            reason:
              viewer.cursor > view.revision
                ? "server-reset"
                : "snapshot-required",
          },
          view.revision,
        ),
      );
    } else {
      write(
        response,
        frame(
          "revision",
          {
            revision: view.revision,
            at: view.acceptedAt,
            runId: view.simulation.runId,
          },
          view.revision,
        ),
      );
    }
    viewer.initial = false;
  }

  function start() {
    if (current || closing) return current;
    const controller = new AbortController();
    let resolveFirst!: (view: ReadView | undefined) => void;
    const first = new Promise<ReadView | undefined>((resolve) => {
      resolveFirst = resolve;
    });
    const heartbeat = setInterval(() => {
      for (const [response, viewer] of viewers)
        write(
          response,
          viewer.protocol === "snapshot"
            ? ": heartbeat\n\n"
            : frame("heartbeat", {
                revision: latest?.revision ?? 0,
                at: new Date().toISOString(),
              }),
        );
    }, 10_000);
    const run = startRun(
      controller.signal,
      (view) => {
        latest = view;
        resolveFirst(view);
        const snapshotFrame = frame(
          "snapshot",
          view.snapshot,
          `${view.snapshot.runId}:${view.revision}`,
        );
        for (const [response, viewer] of viewers)
          deliver(response, viewer, view, snapshotFrame);
      },
      options,
    );
    const done = run.done
      .catch((error: unknown) => {
        app.log.error({ err: error }, "Jury simulation stopped");
        for (const [response, viewer] of viewers)
          if (viewer.protocol === "dashboard")
            write(response, frame("status", { state: "error" }));
        endViewers();
      })
      .finally(() => {
        clearInterval(heartbeat);
        resolveFirst(undefined);
        latest = undefined;
        current = undefined;
        if (viewers.size) start();
      });
    current = { controller, done, first, change: run.change };
    return current;
  }

  async function read(reply: FastifyReply) {
    if (!publicDemo) {
      reply.code(404).send({ message: "Учебный эфир отключён" });
      return;
    }
    if (current?.controller.signal.aborted) await current.done;
    const session = start();
    if (session) {
      // The normal dashboard loads JSON and opens SSE concurrently. Polling-only
      // viewers renew the same grace interval on each read.
      idle();
      const view = latest ?? (await session.first);
      if (view) return view;
    }
    reply.code(503).send({ message: "Учебный источник временно недоступен" });
  }

  function stream(
    req: FastifyRequest,
    reply: FastifyReply,
    protocol: Viewer["protocol"],
  ) {
    if (!publicDemo)
      return reply.code(404).send({ message: "Учебный эфир отключён" });
    if (closing || viewers.size >= maxViewers)
      return reply
        .code(503)
        .send({ message: "Учебный эфир временно недоступен" });
    const response = reply.raw;
    reply.hijack();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 3000\n\n");
    clearTimeout(grace);
    const cursor = Number(
      req.headers["last-event-id"] ??
        (req.query as { cursor?: string }).cursor ??
        0,
    );
    const viewer = {
      protocol,
      initial: true,
      cursor,
      authorized: () => authorized(req),
    };
    viewers.set(response, viewer);
    response.once("close", () => {
      if (viewers.delete(response) && !viewers.size) idle();
    });
    if (latest && !current?.controller.signal.aborted) {
      const refreshed = { ...latest.snapshot, time: new Date().toISOString() };
      deliver(
        response,
        viewer,
        latest,
        frame(
          "snapshot",
          refreshed,
          `${refreshed.runId}:${refreshed.revision}`,
        ),
      );
    }
    start();
  }

  app.get(
    "/api/simulation/stream",
    { exposeHeadRoute: false },
    async (req, reply) => stream(req, reply, "snapshot"),
  );
  app.addHook("preClose", async () => {
    closing = true;
    clearTimeout(grace);
    current?.controller.abort();
    endViewers();
    await current?.done;
  });
  async function change(reply: FastifyReply, id: string, command: TrainingCommand, actor: string) {
    if (!(await read(reply))) return;
    if (!current) throw new TrainingError(409, "Учебная сессия завершилась.");
    return current.change(id, command, actor);
  }
  return { read, stream, change, latest: () => latest };
}
