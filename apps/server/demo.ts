import { writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { generate, FIXED_CLOCK } from "../../packages/domain/generator.ts";
import { trainingRows } from "../../packages/domain/trainingShift.ts";
import {
  STATES,
  TEAM,
  demoTransitions,
  type Raw,
} from "../../packages/domain/index.ts";
import type { FileSource, Store } from "../worker/ingestion.ts";
export async function atomicWrite(path: string, text: string, move = rename, beforeReplace?: () => Promise<void>) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      await beforeReplace?.();
      try {
        await move(temp, path);
        break;
      } catch (e) {
        if (
          attempt >= 5 ||
          !["EPERM", "EBUSY", "EACCES"].includes(
            (e as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw new Error(
            "Не удалось заменить рабочий файл. Повторите импорт; предыдущий снимок сохранён.",
          );
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export class Demo {
  stepIndex = 0;
  playing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  clock = FIXED_CLOCK;
  constructor(
    public store: Store,
    public source: FileSource,
  ) {}
  async action(action: string) {
    if (action === "pause") {
      this.pause();
      return;
    }
    if (action === "play") {
      if (!this.playing) {
        this.playing = true;
        this.timer = setInterval(
          () => void this.step().catch(() => this.pause()),
          3000,
        );
      }
      return;
    }
    if (action === "reset") {
      this.pause();
      await this.source.exclusive(async () => {
        await this.store.reset();
        this.stepIndex = 0;
        await atomicWrite(
          this.source.path,
          JSON.stringify(trainingRows(this.clock)),
        );
      });
      return;
    }
    if (action === "step") {
      await this.step();
      return;
    }
    throw new Error("Неизвестное действие");
  }
  pause() {
    clearInterval(this.timer);
    this.playing = false;
  }
  async step() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.source.exclusive(async () => {
        const rows = [...this.store.rows.values()]
          .filter((r) => r.sourcePresent)
          .map((r) => structuredClone(r.raw));
        let r = rows.find((r) => r.id === "DEMO-SCENARIO");
        const step = this.stepIndex % 9;
        if (!r) {
          r = {
            ...generate(1, 43, this.clock).rows[0],
            id: "DEMO-SCENARIO",
            sysId: "999999999999999999",
            header: "Демонстрация: сбой платежей",
            description:
              "Синтетический сбой. Платежи не проходят. Команда проверяет платёжный шлюз.",
            stateId: 0,
            stateEnum: "Assigned",
            priorityId: 4,
            priority: "Наивысший",
          };
          rows.push(r);
        }
        // A new cycle uses a new identity; Closed is never reopened implicitly.
        if (step === 0 && this.stepIndex > 0) {
          r = {
            ...generate(1, 43, this.clock).rows[0],
            id: `DEMO-SCENARIO-${this.stepIndex}`,
            sysId: `88888888${String(this.stepIndex).padStart(10, "0")}`,
            stateId: 0,
            stateEnum: "Assigned",
            priorityId: 4,
            priority: "Наивысший",
          };
          rows.push(r);
        } else if (this.stepIndex >= 9) {
          r = rows.find(
            (x) =>
              x.id === `DEMO-SCENARIO-${Math.floor(this.stepIndex / 9) * 9}`,
          )!;
        }
        if (step === 1) r.assignedGroupName = TEAM;
        if (step === 2)
          r.deadline = new Date(Date.parse(this.clock) + 600_000).toISOString();
        if (step === 3) {
          r.stateId = 2;
          r.stateEnum = "WorkInProgress";
        }
        if (step === 4) {
          r.stateId = 7;
          r.stateEnum = "Resolved";
          r.completionDate = this.clock;
          r.solution = "Доступность восстановлена (демо).";
        }
        if (step === 5) {
          r.stateId = 2;
          r.stateEnum = "WorkInProgress";
          r.solution = null;
        }
        if (step === 6) {
          r.stateId = 20;
          r.stateEnum = "Research";
        }
        if (step === 7) {
          r.stateId = 10;
          r.stateEnum = "Closed";
        }
        if (step === 8) {
          rows.push({
            ...r,
            id: `DEMO-REPEAT-${this.stepIndex}`,
            sysId: `99999999${String(this.stepIndex).padStart(10, "0")}`,
            stateId: 0,
            stateEnum: "Assigned",
            completionDate: null,
            solution: null,
          });
        }
        r.state = STATES[r.stateId as number].label;
        await atomicWrite(this.source.path, JSON.stringify(rows));
        this.stepIndex++;
      });
    } finally {
      this.busy = false;
    }
  }
  async edit(key: string, state: number) {
    await this.source.exclusive(async () => {
      const item = this.store.rows.get(key);
      if (!item || !demoTransitions[item.stateId!]?.includes(state))
        throw new Error(
          "Переход запрещён политикой демо; Closed требует нового ID",
        );
      const rows = [...this.store.rows.values()]
        .filter((r) => r.sourcePresent)
        .map((r) =>
          r.key === key
            ? {
                ...r.raw,
                stateId: state,
                stateEnum: STATES[state].enum,
                state: STATES[state].label,
                ...(state === 7 ? { completionDate: this.clock } : {}),
              }
            : r.raw,
        );
      await atomicWrite(this.source.path, JSON.stringify(rows));
    });
  }
}
