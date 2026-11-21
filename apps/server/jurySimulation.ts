import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import {
  FIELDS,
  PRIORITIES,
  STATES,
  TEAM,
  parseSnapshot,
  transition,
  type Group,
  type Incident,
  type Raw,
} from "../../packages/domain/index.ts";
import { atomicWrite } from "./demo.ts";

export interface JuryIncident {
  id: string;
  key: string;
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
  revision: number;
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
}

interface SimulationOptions {
  stepDelays?: readonly [number, number, number, number, number];
  temporaryRoot?: string;
  graceMs?: number;
}

const defaultDelays = [5_000, 9_000, 10_000, 9_000, 9_000] as const;
const maxEvents = 24;
const maxViewers = 80;

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

async function runSimulation(
  signal: AbortSignal,
  publish: (snapshot: JurySnapshot) => void,
  options: SimulationOptions,
) {
  const directory = await mkdtemp(
    join(options.temporaryRoot ?? tmpdir(), "watermelon-jury-"),
  );
  const file = join(directory, "incidents.json");
  const delays = options.stepDelays ?? defaultDelays;
  const runId = randomUUID();
  let raw: Raw = {};
  let previous: Incident | undefined;
  let events: JuryEvent[] = [];
  try {
    for (let revision = 1; !signal.aborted; revision++) {
      const step = (revision - 1) % delays.length;
      const cycle = Math.floor((revision - 1) / delays.length) + 1;
      raw = sourceRow(raw, step, runId, cycle, Date.now());
      await atomicWrite(file, JSON.stringify([raw]));

      const [accepted] = parseSnapshot(
        await readFile(file, "utf8"),
        "simulation",
      ).rows;
      const { incident, reasons } = transition(
        previous?.key === accepted.key ? previous : undefined,
        accepted,
      );
      previous = incident;
      const row = forViewer(incident);
      const now = Date.now();
      const time = new Date(now).toISOString();
      if (reasons.length) {
        events = [{ ...row, reasons, revision, at: time }, ...events].slice(
          0,
          maxEvents,
        );
      }
      if (signal.aborted) break;
      publish({
        runId,
        revision,
        step,
        incidents: [row],
        events,
        time,
        nextAt: new Date(now + delays[step]).toISOString(),
      });
      await wait(delays[step], undefined, { signal });
    }
  } catch (error) {
    if (!(signal.aborted && (error as Error).name === "AbortError"))
      throw error;
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

export function registerJurySimulation(
  app: FastifyInstance,
  publicDemo: boolean,
  options: SimulationOptions = {},
) {
  const viewers = new Set<ServerResponse>();
  let current: { controller: AbortController; done: Promise<void> } | undefined;
  let latest: JurySnapshot | undefined;
  let grace: NodeJS.Timeout | undefined;
  let closing = false;

  function encode(snapshot: JurySnapshot) {
    return `id: ${snapshot.runId}:${snapshot.revision}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
  }

  function write(viewer: ServerResponse, frame: string) {
    // EventSource reconnects with a complete snapshot if a slow client falls behind.
    if (viewer.writableNeedDrain) viewer.destroy();
    else if (!viewer.destroyed && !viewer.writableEnded) viewer.write(frame);
  }

  function endViewers() {
    for (const viewer of viewers) {
      if (viewer.writableNeedDrain) viewer.destroy();
      else viewer.end();
    }
    viewers.clear();
  }

  function start() {
    if (current || closing || !viewers.size) return;
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      for (const viewer of viewers) write(viewer, ": heartbeat\n\n");
    }, 15_000);
    const done = runSimulation(
      controller.signal,
      (snapshot) => {
        latest = snapshot;
        const frame = encode(snapshot);
        for (const viewer of viewers) write(viewer, frame);
      },
      options,
    )
      .catch((error: unknown) => {
        app.log.error({ err: error }, "Jury simulation stopped");
        endViewers();
      })
      .finally(() => {
        clearInterval(heartbeat);
        latest = undefined;
        current = undefined;
        // A viewer may have arrived while the previous run was cleaning up.
        start();
      });
    current = { controller, done };
  }

  app.get(
    "/api/simulation/stream",
    { exposeHeadRoute: false },
    async (_req, reply) => {
      if (!publicDemo)
        return reply.code(404).send({ message: "Учебный эфир отключён" });
      if (closing || viewers.size >= maxViewers)
        return reply
          .code(503)
          .send({ message: "Учебный эфир временно недоступен" });
      const viewer = reply.raw;
      reply.hijack();
      viewer.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      viewer.write("retry: 3000\n\n");
      clearTimeout(grace);
      viewers.add(viewer);
      viewer.once("close", () => {
        if (!viewers.delete(viewer) || viewers.size || closing) return;
        grace = setTimeout(
          () => current?.controller.abort(),
          options.graceMs ?? 12_000,
        );
      });
      if (latest && !current?.controller.signal.aborted) {
        write(viewer, encode({ ...latest, time: new Date().toISOString() }));
      }
      start();
    },
  );

  app.addHook("preClose", async () => {
    closing = true;
    clearTimeout(grace);
    current?.controller.abort();
    endViewers();
    await current?.done;
  });
}
