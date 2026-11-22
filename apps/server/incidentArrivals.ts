import profile from "./arrivalProfile.json" with { type: "json" };
import { FIELDS, PRIORITIES, STATES, type Raw } from "../../packages/domain/index.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const DEMO_SPEED = 30;
const mondayMorning = Date.UTC(2016, 2, 7, 9);
const sum = (weights: number[]) => weights.reduce((a, b) => a + b, 0);
const byCategory = profile.groupCountsByCategory;
const categoryTotals = byCategory.map(sum);
const total = sum(categoryTotals);
const groupPriors = profile.groups.map((_, i) =>
  (byCategory.reduce((n, counts) => n + counts[i], 0) + 0.5) / (total + profile.groups.length / 2),
);
const groupWeights = byCategory.map(row =>
  row.map((count, i) => count + profile.groupPriorWeight * groupPriors[i]),
);
const categoryWeights = profile.categoryCountsBySlot.map(row =>
  row.map((count, i) => count + profile.categoryPriorWeight * categoryTotals[i] / total),
);
const meanRates = profile.categoryCountsBySlot.map((row, i) => sum(row) / profile.exposureDays[Math.floor(i / 24)]);
const emptyFields = Object.fromEntries(FIELDS.map(name => [name, null]));

function weightedIndex(weights: number[], random: () => number) {
  let target = random() * sum(weights);
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target < 0) return i;
  }
  return weights.length - 1;
}

function calendar(time: number) {
  // UTC arithmetic represents the source's local calendar without inventing its time zone.
  const stamp = new Date(time);
  const weekend = stamp.getUTCDay() === 0 || stamp.getUTCDay() === 6;
  return { dayType: Number(weekend), slot: Number(weekend) * 24 + stamp.getUTCHours() };
}

const symptoms = [
  "При открытии формы возникает ошибка",
  "Сервис долго отвечает на запрос",
  "Не загружается список операций",
  "После подтверждения не меняется статус",
];

export class IncidentArrivals {
  private time: number;
  private loadedDay = -1;
  private dayCounts: number[] = [];
  private loadedHour = -1;
  private offsets: number[] = [];
  private generated = 0;
  private latestId: string | null = null;

  constructor(
    private readonly runId: string,
    private readonly random: () => number = Math.random,
    start = mondayMorning,
  ) {
    this.time = start;
  }

  status() {
    return {
      source: "UCI 498",
      speed: DEMO_SPEED,
      modelTime: new Date(this.time).toISOString(),
      meanPerHour: meanRates[calendar(this.time).slot],
      generated: this.generated,
      latestId: this.latestId,
    };
  }

  private loadHour(hourStart: number) {
    if (hourStart === this.loadedHour) return;
    const day = Math.floor(hourStart / DAY);
    if (day !== this.loadedDay) {
      const days = profile.daysByType[calendar(hourStart).dayType];
      this.dayCounts = days[Math.floor(this.random() * days.length)];
      this.loadedDay = day;
    }
    const count = this.dayCounts[new Date(hourStart).getUTCHours()];
    this.offsets = Array.from({ length: count }, () => Math.floor(this.random() * HOUR)).sort((a, b) => a - b);
    this.loadedHour = hourStart;
  }

  advance(displayElapsedMs: number, wallNow: number): Raw[] {
    const end = this.time + displayElapsedMs * DEMO_SPEED;
    const arrivals: Raw[] = [];
    while (this.time < end) {
      const hourStart = Math.floor(this.time / HOUR) * HOUR;
      const until = Math.min(hourStart + HOUR, end);
      this.loadHour(hourStart);
      const { slot } = calendar(hourStart);
      for (const offset of this.offsets) {
        const at = hourStart + offset;
        if (at >= this.time && at < until)
          arrivals.push(this.ticket(slot, wallNow - (end - at) / DEMO_SPEED));
      }
      this.time = until;
    }
    return arrivals;
  }

  private ticket(slot: number, wallTime: number): Raw {
    const categoryIndex = weightedIndex(categoryWeights[slot], this.random);
    const category = profile.categories[categoryIndex];
    const group = profile.groups[weightedIndex(groupWeights[categoryIndex], this.random)];
    const team = group.startsWith("Group ") ? group.replace("Group ", "Учебная группа ") : null;
    // UCI P1 is critical. The local ITSM export numbers priorities in the opposite order.
    const priority = 4 - weightedIndex(profile.priorityCounts, this.random);
    const at = new Date(wallTime).toISOString();
    const product = category === "?" ? "Учебный сервис" : category.replace("Category ", "Учебный сервис ");
    const header = symptoms[Math.floor(this.random() * symptoms.length)];
    this.generated++;
    this.latestId = "SIM-FLOW-" + String(this.generated).padStart(5, "0");
    return {
      ...emptyFields,
      sysId: this.runId + "-flow-" + this.generated,
      id: this.latestId,
      header, productName: product,
      description: header + ". Синтетическое обращение для тренировки первичного разбора.",
      scenarioName: "Поток по журналу UCI 498",
      submitDate: at,
      assignedGroupName: team,
      lastAssignmentToTeamDateTime: team ? at : null,
      stateId: 0, stateEnum: STATES[0].enum, state: STATES[0].label,
      priorityId: priority, priority: PRIORITIES[priority],
    };
  }
}
