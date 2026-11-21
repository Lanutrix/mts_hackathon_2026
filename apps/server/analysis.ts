import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { hash, type Incident } from "../../packages/domain/index.ts";
import type { DB } from "./db.ts";
export const MODEL =
  "Xenova/multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78/q8";
export const PROMPT_VERSION = "extractive-evidence-1";
export interface Analysis {
  summary: string[];
  evidence: { claim: number; fields: string[] }[];
  uncertainties: string[];
  suggestedTeams: { name: string; reason: string }[];
  model: string;
  provider: string;
  inputRevision: number;
  generatedAt: string;
  promptVersion: string;
  stale: boolean;
  mode: "model" | "fallback";
  error?: string;
  dimensions?: number;
}
export type Runner = (
  sentences: string[],
  query: string,
) => Promise<{ indices: number[]; dimensions: number }>;
const clean = (x: unknown) =>
  String(x ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001f]/gu, " ")
    .slice(0, 5000);
export class AnalysisService {
  private worker: Worker | undefined;
  private busy = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(
    public db: DB,
    public cacheDir = resolve(".runtime/models"),
    public timeout = 60_000,
    private runner?: Runner,
  ) {}
  async run(sentences: string[], query: string) {
    if (this.runner) return this.runner(sentences, query);
    clearTimeout(this.idle);
    this.worker ??= new Worker(new URL("./inference.mjs", import.meta.url), {
      workerData: { cacheDir: this.cacheDir },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const w = this.worker;
    return new Promise<{ indices: number[]; dimensions: number }>(
      (res, rej) => {
        const timer = setTimeout(() => {
          cleanup();
          void w.terminate();
          if (this.worker === w) this.worker = undefined;
          rej(new Error("Модель не ответила вовремя"));
        }, this.timeout);
        const cleanup = () => {
          clearTimeout(timer);
          w.off("message", onMessage);
          w.off("error", onError);
        };
        const onError = () => {
          cleanup();
          this.worker = undefined;
          rej(new Error("Модель недоступна"));
        };
        const onMessage = (data: any) => {
          cleanup();
          if (data.error) rej(new Error(data.error));
          else res(data);
          this.idle = setTimeout(() => void this.close(), 60_000);
          this.idle.unref();
        };
        w.once("message", onMessage);
        w.once("error", onError);
        w.postMessage({ sentences, query });
      },
    );
  }
  async analyze(
    incident: Incident,
    current: () => Incident,
    changed: string[] = [],
  ): Promise<Analysis> {
    const relevant = {
      header: clean(incident.raw.header),
      description: clean(incident.raw.description),
      product: clean(incident.raw.productName),
      team: incident.team,
      state: incident.stateLabel,
      deadline: incident.dates.deadline,
      changed,
    };
    const key = hash({ relevant, MODEL, PROMPT_VERSION });
    const cached = (
      await this.db.query("SELECT doc FROM ai_cache WHERE cache_key=$1", [key])
    ).rows[0]?.doc;
    if (cached)
      return {
        ...cached,
        inputRevision: incident.revision,
        stale: current()?.hash !== incident.hash,
      };
    const summary = [
      `${relevant.product || "Продукт не указан"}. ${relevant.header || "Заголовок не указан"}`,
      `Статус: ${relevant.state}. Команда: ${relevant.team || "не указана"}.`,
      `Срок: ${relevant.deadline ?? "не задан"}.`,
    ];
    const evidence = [
      { claim: 0, fields: ["productName", "header"] },
      { claim: 1, fields: ["stateId", "assignedGroupName"] },
      { claim: 2, fields: ["deadline"] },
    ];
    if (changed.length) {
      summary.push(`Изменены поля: ${changed.join(", ")}.`);
      evidence.push({ claim: summary.length - 1, fields: ["history.changed"] });
    }
    const base: Analysis = {
      summary,
      evidence,
      uncertainties: [
        "Причина и масштаб влияния не подтверждены; сводка опирается только на поля источника.",
        ...(incident.quarantined
          ? ["В исходных данных есть конфликт: требуется сверка."]
          : []),
      ],
      suggestedTeams: [],
      model: MODEL,
      provider: "Локальный ONNX Runtime (CPU)",
      inputRevision: incident.revision,
      generatedAt: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      stale: false,
      mode: "fallback",
    };
    if (this.busy)
      return { ...base, error: "Модель занята. Показана сводка полей без ИИ." };
    const sentences = (relevant.description.match(/[^.!?]+[.!?]?/gu) ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!sentences.length)
      return { ...base, error: "Недостаточно описания для анализа" };
    this.busy = true;
    const jobId = randomUUID();
    try {
      await this.db.query(
        "INSERT INTO ai_jobs(id,cache_key,input_revision,started_at,status) VALUES($1,$2,$3,$4,'running')",
        [jobId, key, incident.revision, new Date().toISOString()],
      );
      const result = await Promise.race([
        this.run(
          sentences,
          `Что произошло с ${relevant.product}? Симптомы сбоя и влияние на пользователей.`,
        ),
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error("Модель не ответила вовремя")),
            this.timeout + 100,
          );
          t.unref();
        }),
      ]);
      if (
        !Array.isArray(result.indices) ||
        !result.indices.length ||
        result.indices.length > 2 ||
        result.indices.some(
          (n) => !Number.isInteger(n) || n < 0 || n >= sentences.length,
        ) ||
        result.dimensions !== 384
      )
        throw new Error("Некорректный ответ модели");
      for (const i of result.indices) {
        base.summary.push(sentences[i]);
        base.evidence.push({
          claim: base.summary.length - 1,
          fields: [`description:sentence:${i}`],
        });
      }
      base.mode = "model";
      base.dimensions = result.dimensions;
      base.stale = current()?.hash !== incident.hash;
      await this.db.query(
        "INSERT INTO ai_cache(cache_key,doc) VALUES($1,$2) ON CONFLICT(cache_key) DO NOTHING",
        [key, JSON.stringify(base)],
      );
      await this.db.query(
        "UPDATE ai_jobs SET status='done',finished_at=$2 WHERE id=$1",
        [jobId, new Date().toISOString()],
      );
      return base;
    } catch (e) {
      await this.db
        .query(
          "UPDATE ai_jobs SET status='fallback',finished_at=$2 WHERE id=$1",
          [jobId, new Date().toISOString()],
        )
        .catch(() => {});
      return {
        ...base,
        stale: current()?.hash !== incident.hash,
        error: (e as Error).message + "; показана сводка полей без ИИ.",
      };
    } finally {
      this.busy = false;
    }
  }
  async close() {
    clearTimeout(this.idle);
    const w = this.worker;
    this.worker = undefined;
    await w?.terminate();
  }
}
