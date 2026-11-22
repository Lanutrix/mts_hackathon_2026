import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { STATES, TEAM, type Incident, type Raw } from "../../packages/domain/index.ts";
import type { Role } from "./auth.ts";
import type { registerJurySimulation } from "./jurySimulation.ts";

export const trainingActionRoute = "/api/simulation/incidents/:id";

export type TrainingCommand = { runId: string; expectedRevision: number } & (
  | { action: "edit"; header?: string; description?: string }
  | { action: "route"; team: string }
  | { action: "resolve"; solution?: string }
);

export class TrainingError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly runId?: string,
    readonly revision?: number,
  ) {
    super(message);
  }
}

function parseCommand(input: unknown): TrainingCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TrainingError(400, "Укажите учебное действие.");
  const body = input as Record<string, unknown>;
  if (typeof body.runId !== "string" || !body.runId.trim() || body.runId.length > 80 ||
      typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)
    throw new TrainingError(400, "Укажите учебную сессию и версию инцидента.");
  const base = { runId: body.runId, expectedRevision: body.expectedRevision };
  const fields = Object.keys(body).filter(key => !["runId", "expectedRevision", "action"].includes(key));
  if (body.action === "resolve" && fields.every(key => key === "solution")) {
    if (body.solution !== undefined && (typeof body.solution !== "string" || body.solution.length > 2000))
      throw new TrainingError(400, "Результат может содержать до 2000 символов.");
    return { ...base, action: "resolve", solution: body.solution?.trim() };
  }
  if (body.action === "route" && fields.length === 1 &&
      typeof body.team === "string" && body.team.trim() && body.team.length <= 200)
    return { ...base, action: "route", team: body.team.trim() };
  if (body.action === "edit" && fields.length && fields.every(key => ["header", "description"].includes(key))) {
    const edit: TrainingCommand = { ...base, action: "edit" };
    if ("header" in body) {
      if (typeof body.header !== "string" || !body.header.trim() || body.header.length > 300)
        throw new TrainingError(400, "Укажите заголовок до 300 символов.");
      edit.header = body.header.trim();
    }
    if ("description" in body) {
      if (typeof body.description !== "string" || body.description.length > 4000)
        throw new TrainingError(400, "Описание может содержать до 4000 символов.");
      edit.description = body.description.trim();
    }
    return edit;
  }
  throw new TrainingError(400, "Проверьте действие и поля учебного инцидента.");
}

// Only these synthetic ITSM fields can be changed. Clear the previous team's
// assignee when transferring a ticket to another team.
export function trainingPatch(command: TrainingCommand, ticket: Incident, rows: Map<string, Incident>): Raw {
  switch (command.action) {
    case "edit":
      return {
        ...(command.header === undefined ? {} : { header: command.header }),
        ...(command.description === undefined ? {} : { description: command.description }),
      };
    case "route":
      if (command.team === ticket.team) return {};
      if (command.team !== TEAM && ![...rows.values()].some(row => row.team === command.team))
        throw new TrainingError(400, "Выберите команду из учебной выгрузки.");
      return {
        assignedGroupName: command.team, assignedEmployee: null, assignedEmployeeLogin: null,
        lastAssignmentToTeamDateTime: new Date().toISOString(),
      };
    case "resolve":
      if (ticket.stateId === 7 || ticket.stateId === 10) return {};
      return {
        stateId: 7, stateEnum: STATES[7].enum, state: STATES[7].label,
        completionDate: new Date().toISOString(), solution: command.solution || "Завершено координатором в учебном режиме.",
      };
  }
}

export function registerTrainingActions(
  app: FastifyInstance,
  jury: ReturnType<typeof registerJurySimulation>,
  requireRole: (req: FastifyRequest, reply: FastifyReply, roles: Role[]) => { username: string } | null,
) {
  app.post(trainingActionRoute, { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const ns = (req.query as { ns?: string }).ns;
    if (ns !== undefined && ns !== "simulation")
      return reply.code(403).send({ message: "Это действие доступно только в учебной сессии." });
    const user = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!user) return;
    try {
      const command = parseCommand(req.body);
      return await jury.change(reply, (req.params as { id: string }).id, command, user.username);
    } catch (error) {
      if (!(error instanceof TrainingError)) throw error;
      return reply.code(error.statusCode).send({ message: error.message, runId: error.runId, revision: error.revision });
    }
  });
}
