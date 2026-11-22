import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { atomicWrite } from "../apps/server/demo.ts";
import { parseSnapshot } from "../packages/domain/index.ts";
import { upgradeTraining } from "../packages/domain/upgradeTraining.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "string" }, clock: { type: "string" },
    "preserve-id": { type: "string", multiple: true },
  },
});
if (positionals.length !== 1 || (values.apply && !/^[a-f0-9]{64}$/.test(values.apply)))
  throw new Error("Укажите путь к demo/incidents.json, при записи — --apply SHA256 текущего файла.");
const path = positionals[0];
async function readCurrent() {
  if (!(await lstat(path)).isFile()) throw new Error("Источник должен быть обычным файлом.");
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), text: bytes.toString("utf8") };
}
const source = await readCurrent();
const assertDigest = (digest: string) => {
  if (values.apply && digest !== values.apply) throw new Error("Исходный файл изменился после проверки.");
};
assertDigest(source.sha256);
const clock = values.clock ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(clock))) throw new Error("Требуется корректная дата --clock.");
const input = parseSnapshot(source.text, "demo").rows.map(row => row.raw);
const output = upgradeTraining(input, values["preserve-id"], clock);
const next = JSON.stringify(output);
parseSnapshot(next, "demo");
if (values.apply && output !== input) {
  await atomicWrite(path, next, undefined, async () => assertDigest((await readCurrent()).sha256));
}
console.log(JSON.stringify({
  applied: Boolean(values.apply) && output !== input, sha256: source.sha256, clock,
  before: input.length, after: output.length, retained: input.filter((r, i) => output[i] === r).length,
  teams: new Set(output.map(row => row.assignedGroupName)).size,
}));
