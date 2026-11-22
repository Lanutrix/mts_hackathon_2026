import type { Incident } from "../../packages/domain/index.ts";
import { knownSymptom, reportedClauses, type SymptomEvidence, type SymptomTheme } from "../../packages/domain/symptoms.ts";
import type { VseLlm } from "./vsellm.ts";

// Only vocabulary constants and symbolic field references cross the provider boundary.
// Keep object and effect cues separate: two tickets can describe exports but report
// entirely different failures. The model can leave ambiguous tickets ungrouped.
const areas = {
  export: { label: "Экспорт данных", cues: { export: /экспорт/u, download: /скач(?:а|ив)/u, extract: /выгруз/u, report: /отчет/u },
    inspect: "Сверьте параметры выборки и содержимое результата в обеих заявках." },
  import: { label: "Импорт данных", cues: { import: /импорт/u, upload: /загрузк\p{L}* файл|загрузить файл|при загрузке/u },
    inspect: "Сверьте формат файла и этап импорта в обеих заявках." },
  search: { label: "Поиск", cues: { search: /поиск/u, results: /выдач/u, find: /найти|находит/u },
    inspect: "Сверьте поисковые запросы и ожидаемые результаты в обеих заявках." },
  update: { label: "Обновление данных", cues: { sync: /синхронизац/u, refresh: /обновл/u, save: /сохран/u },
    inspect: "Сверьте момент записи и значение после повторного чтения в обеих заявках." },
  access: { label: "Доступ", cues: { login: /логин|авторизац|вход/u, account: /аккаунт|кабинет/u, session: /сесси/u },
    inspect: "Сопоставьте шаги доступа и ответ сервиса в обеих заявках." },
};
const effects = {
  empty: { label: "Пустой результат", cues: { empty: /пуст(?:о|а|ы|ую|ая|ой)/u, missingRows: /нет (?:ни одной )?(?:строк|запис|результат)|ни (?:одной строки|одной записи)/u, blank: /без содержим|ничего не (?:наш|нашл|показыва|вывод)/u } },
  stuck: { label: "Ожидание без завершения", cues: { freezes: /завис|застря/u, spinning: /бесконечн\p{L}* (?:загруз|ожидан)|крутится/u, pending: /не заверша|не заканчива/u } },
  repeated: { label: "Повтор операции", cues: { repeats: /повторяет|повторно|снова/u, loop: /по кругу|зацикл|циклическ/u, duplicate: /дублиру|дважды/u } },
  denied: { label: "Отказ при выполнении", cues: { denied: /отказ|запрещ|отклон/u, permission: /не хватает прав|нет прав|недостаточно прав/u, blocked: /блокир|заблокирован/u } },
};
type Area = keyof typeof areas;
type Effect = keyof typeof effects;
type Clues<K extends string> = { id: K; cues: string[] }[];
function clues<K extends string>(dictionary: Record<K, { cues: Record<string, RegExp> }>, text: string): Clues<K> {
  const found: Clues<K> = [];
  for (const id of Object.keys(dictionary) as K[]) {
    const cues = Object.entries(dictionary[id].cues).filter(([, pattern]) => pattern.test(text)).map(([cue]) => cue);
    if (cues.length) found.push({ id, cues });
  }
  return found;
}
function candidate(row: Incident) {
  if (knownSymptom(row)) return;
  for (const { field, text, quote } of reportedClauses(row)) {
    if (quote.length > 240 || /(?:не|перестал\p{L}*) (?:пуст|завис|застр|блокир|повторя|зацикл)|без (?:завис|повтор|отказ)|(?:выгрузка|импорт|поиск) (?:работает|выполнен\p{L}* успешно)/u.test(text)) continue;
    const objects = clues(areas, text), appearances = clues(effects, text);
    if (objects.length && appearances.length)
      return { evidence: { id: row.id, field, value: quote }, objects, appearances };
  }
}

const version = "semantic-observations-1";
const instruction = 'Сопоставь обезличенные наблюдения об ИТ-инцидентах по смыслу. objects содержит возможные этапы, appearances — проявления; cues передают наблюдаемые признаки. Объединяй только совместимые описания одного проявления на том же этапе. При сомнении оставь заявку отдельно. У каждого ref одна группа. Группа включает хотя бы два разных ref. area и effect должны встречаться у каждого её участника. Это сходство жалоб, причина и дубли неизвестны. Только JSON {"groups":[{"area":"код из objects","effect":"код из appearances","refs":["T1.header","T2.description"]}]}.';

export async function groupObservations(rows: Incident[], client?: VseLlm) {
  if (!client || rows.length < 2) return;
  const records = new Map<string, NonNullable<ReturnType<typeof candidate>>>();
  for (const row of rows) {
    const found = candidate(row);
    if (found) records.set("T" + (records.size + 1) + "." + found.evidence.field, found);
    if (records.size === 24) break;
  }
  if (records.size < 2) return;
  const observations = [...records].map(([ref, { objects, appearances }]) => ({ ref, objects, appearances }));
  const packet = { observations };
  const reply = await client.json(version, instruction, packet, 5000);
  if (!("json" in reply)) return;
  const groups = (reply.json as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups) || groups.length > records.size / 2) return;
  const assigned = new Map<string, { key: string; label: string }>();
  const themes: SymptomTheme[] = [];
  const keys = new Set<string>();
  for (const group of groups) {
    if (typeof group !== "object" || !group || typeof group.area !== "string" || typeof group.effect !== "string" ||
        !Object.hasOwn(areas, group.area) || !Object.hasOwn(effects, group.effect)) return;
    const area = group.area as Area, effect = group.effect as Effect;
    const key = "observed:" + area + ":" + effect;
    const label = areas[area].label + " · " + effects[effect].label;
    if (keys.has(key) || !Array.isArray(group.refs) || group.refs.length < 2 || group.refs.length > records.size) return;
    keys.add(key);
    const examples: SymptomEvidence[] = [];
    for (const ref of group.refs) {
      const item = records.get(ref);
      if (!item || assigned.has(item.evidence.id) || !item.objects.some(hit => hit.id === area) ||
          !item.appearances.some(hit => hit.id === effect)) {
        client.rejectJson(version, packet);
        return;
      }
      assigned.set(item.evidence.id, { key, label });
      if (examples.length < 2) examples.push(item.evidence);
    }
    themes.push({ label, count: group.refs.length, check: areas[area].inspect, examples });
  }
  if (!themes.length) return;
  themes.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
  return { assigned, sampled: records.size, themes };
}
