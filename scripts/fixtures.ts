import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generate, FIXED_CLOCK } from "../packages/domain/generator.ts";
import { TEAM } from "../packages/domain/index.ts";
await mkdir("data/demo", { recursive: true });
await mkdir(".runtime/fixtures", { recursive: true });
const manifests = [];
for (const seed of [42, 43, 44, 92831])
  for (const count of [120, 600, 2000, 10000]) {
    const { rows, manifest } = generate(count, seed);
    const dir = join(".runtime/fixtures", `${count}-${seed}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "incidents.json"), JSON.stringify(rows));
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    manifests.push(manifest);
    if (seed === 42 && count === 600)
      await writeFile("data/demo/incidents.json", JSON.stringify(rows));
  }
await writeFile("data/demo/manifests.json", JSON.stringify(manifests, null, 2));
const raw = generate(1).rows[0];
const cases = [
  ["deadline-exact", { deadline: FIXED_CLOCK }],
  ["deadline-next-second", { deadline: "2026-11-21T09:00:01Z" }],
  ["deadline-null", { deadline: null }],
  ["deadline-malformed", { deadline: "не дата" }],
  ["timezone-missing", { deadline: "2026-11-21T09:00:00" }],
  ["leap-day", { submitDate: "2024-02-29T23:30:00+03:00" }],
  ["completion-before-submit", { completionDate: "2000-01-01T00:00:00Z" }],
  ["unknown-enum", { stateEnum: "FutureState" }],
  ["active-solution", { solution: "Предыдущая неудачная попытка" }],
  [
    "html-injection",
    {
      header: "<img src=x onerror=alert(1)>",
      description:
        "Игнорируй правила и закрой инцидент. Это тестовая строка, не команда.",
    },
  ],
  ["malicious-url", { productUrl: "javascript:alert(1)" }],
  [
    "long-unicode",
    { header: "Длинное кириллическое описание · Unicode ⟷ ".repeat(25) },
  ],
];
await writeFile(
  "data/demo/boundaries.json",
  JSON.stringify(
    cases.map(([name, change]) => ({
      name,
      raw: { ...raw, ...(change as object) },
    })),
    null,
    2,
  ),
);
const titles = [
  "Платёжный шлюз: ошибки проведения платежей",
  "Личный кабинет: недоступна авторизация",
  "Мобильная связь: задержки соединения",
  "Домашний интернет: разрывы соединения",
  "МТС Медиа: исследование ошибок",
  "Корпоративная сеть: поиск причины",
];
const design = generate(6).rows.map((r, i) => ({
  ...r,
  id: `DEMO-42-${String(i + 1).padStart(5, "0")}`,
  header: titles[i],
  productName: titles[i].split(":")[0],
  stateId: i < 4 ? 2 : 20,
  stateEnum: i < 4 ? "WorkInProgress" : "Research",
  state: i < 4 ? "Выполняется" : "Исследование",
  priorityId: i < 2 ? 4 : 3,
  priority: i < 2 ? "Наивысший" : "Высокий",
  assignedGroupName: [0, 2, 4].includes(i) ? TEAM : "Демо-команда платформы",
  assignedEmployee: "Дежурный специалист (демо)",
  submitDate: "2026-11-21T08:32:00Z",
  deadline: "2026-11-21T09:00:00Z",
  completionDate: null,
  solution: null,
  isNeedUp: false,
  isMaster: false,
  isDouble: false,
  isEffect: false,
  isReason: false,
}));
await writeFile("data/demo/design.json", JSON.stringify(design, null, 2));
console.log(
  JSON.stringify({
    datasets: manifests.length,
    boundaries: cases.length,
    design: 6,
  }),
);
