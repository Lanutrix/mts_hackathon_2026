import { lstat, readFile } from "node:fs/promises";
import {
  normalize,
  parseSnapshot,
  type Incident,
} from "../../packages/domain/index.ts";
import { intakeByteLimit, intakeRecordLimit, type IntakeReceipt } from "../../packages/contracts/intake.ts";
import type { FileSource } from "../worker/ingestion.ts";
import { atomicWrite } from "./demo.ts";

export class IntakeError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const staleSource = () =>
  new IntakeError(
    409,
    "Источник изменился. Повторите отправку после обновления снимка.",
  );

function validateRows(body: unknown, ns: string, publicDemo: boolean) {
  const input = Array.isArray(body) ? body : [body];
  if (!input.length || input.length > intakeRecordLimit)
    throw new IntakeError(400, "Передайте от 1 до 20 000 записей.");
  return input.map((raw, i) => {
    const label = `Запись ${i + 1}${typeof raw?.id === "string" ? " (" + raw.id + ")" : ""}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new IntakeError(400, label + " должна быть объектом.");
    let row: Incident;
    try {
      row = normalize(raw, ns);
    } catch (error) {
      throw new IntakeError(400, label + " · " + (error as Error).message);
    }
    const problem = row.issues.find((issue) => issue.severity === "error");
    if (problem)
      throw new IntakeError(
        400,
        label + " · " + problem.field + " — " + problem.message,
      );
    if (publicDemo && ns === "demo" && !row.id.startsWith("DEMO-"))
      throw new IntakeError(
        400,
        label + " · Для демо нужен синтетический ID с префиксом DEMO-.",
      );
    return row;
  });
}

export async function appendIncidents(
  source: FileSource,
  body: unknown,
  publicDemo: boolean,
): Promise<IntakeReceipt> {
  const { store, path } = source;
  const namespace = store.namespace;
  const input = validateRows(body, namespace, publicDemo);
  return source.exclusive(async () => {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(intakeByteLimit))
      throw new IntakeError(503, "Рабочий файл недоступен для приёма.");
    const before = await readFile(path, "utf8");
    const current = parseSnapshot(before, namespace);
    if (current.hash !== store.lastHash) throw staleSource();
    const byKey = new Map(store.rows);
    const byId = new Map([...store.rows.values()].map((r) => [r.id, r]));
    const additions: Incident[] = [];
    const existing: string[] = [];
    for (const [index, row] of input.entries()) {
      const previous = byId.get(row.id) ?? byKey.get(row.key);
      if (previous) {
        if (
          !previous.sourcePresent ||
          previous.key !== row.key ||
          previous.hash !== row.hash
        )
          throw new IntakeError(
            409,
            `Запись ${index + 1} (${row.id}) · ID или sysId уже занят инцидентом ${previous.id}. Проверьте исходные поля и историю.`,
          );
        existing.push(row.id);
      } else {
        additions.push(row);
        byId.set(row.id, row);
        byKey.set(row.key, row);
      }
    }
    if (additions.length) {
      if (current.rows.length + additions.length > 20_000)
        throw new IntakeError(
          400,
          "После добавления в источнике будет больше 20 000 записей.",
        );
      // Keep the source's original bytes, including numeric literals and field order.
      const closingBracket = before.lastIndexOf("]");
      const appended = additions.map((r) => JSON.stringify(r.raw)).join(",");
      const text =
        before.slice(0, closingBracket) +
        (current.rows.length ? "," : "") +
        appended +
        before.slice(closingBracket);
      if (Buffer.byteLength(text) > intakeByteLimit)
        throw new IntakeError(
          413,
          "После добавления размер источника превысит 20 МиБ.",
        );
      // Source snapshots may also be replaced by the external file producer.
      await atomicWrite(path, text, undefined, async () => {
        const latest = await lstat(path, { bigint: true });
        if (
          stat.ino !== latest.ino ||
          stat.size !== latest.size ||
          stat.ctimeNs !== latest.ctimeNs
        )
          throw staleSource();
      });
      try {
        await store.ingest(text);
      } catch (error) {
        await atomicWrite(path, before, undefined, async () => {
          if ((await readFile(path, "utf8")) !== text) throw staleSource();
        });
        throw error;
      }
    }
    return {
      namespace,
      revision: store.revision,
      added: additions.map((r) => r.id),
      existing,
    };
  });
}
