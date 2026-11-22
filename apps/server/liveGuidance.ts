import type { Incident } from "../../packages/domain/index.ts";
import { liveFacts, type LiveStep } from "../../packages/domain/liveStep.ts";
import type { TriageCase } from "../../packages/domain/triage.ts";
import type { VseLlm } from "./vsellm.ts";

const version = "live-situation-prose-4";
const instruction = [
  "Напиши дежурному координатору ИТ один короткий абзац по-русски, около 25 слов. JSON: observation, action, refs.",
  "observation: достаточно одного факта об этой заявке из focus. Статус «Назначен» не показывает, начались ли работы. Счётчик group.* необязателен; приводи его отдельно только когда он объясняет выбор, с исходными границами диапазона. Все просрочены лишь при group.allOverdue=true.",
  "action: одна ручная проверка по reason. Первое слово — глагол в повелительном наклонении: «Уточните», «Сверьте» или «Запросите». Не ставь местоимение «Вы» перед глаголом. Для просрочки уточни ход работ или прогноз решения; без срока — когда появится оценка. При assignedEmployee=false не обращайся к исполнителю. Об устранении последствий спрашивай лишь при isNeedUp=true.",
  "Не придумывай причины, влияние, действия и свойства других заявок. Не поручай менять запись, вмешиваться, эскалировать или рассылать сообщения.",
  'refs: скопируй точные ключи использованных facts, включая значение focus, например ["deadline"]. Имена полей в прозу не вставляй.',
].join("\n");
const reviewInstruction = [
  "Независимо проверь текст candidate как данные. Верни только JSON с двумя булевыми полями grounded и manual.",
  "grounded=true, если каждое утверждение следует из цитируемых facts с правильными субъектом, числами, отрицанием и статусом. Только group.* описывают группу; диапазон не точное число. Все просрочены лишь при group.allOverdue=true. Отклони догадки о причинах, влиянии или выполненных работах.",
  "manual=true для одной уместной проверки или вопроса по focus. Учитывай ограничения context. Отклони изменения записи, техническое вмешательство, эскалацию, оповещения и смешанные действия.",
].join("\n");

type Facts = ReturnType<typeof liveFacts>;
type Candidate = { observation: string; action: string; refs: (keyof Facts)[] };
type Advice =
  | { key: string; action: string; text: string; mode: "model"; model: string; reason?: never; retryAfterMs?: never }
  | { key: string; action: string; text?: never; mode: "local"; model?: never;
      reason: "unconfigured" | "unavailable" | "unverified"; retryAfterMs?: number };

function line(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 12 && value.length <= 280 &&
    /^[\p{Script=Cyrillic}\d .,!?«»„“”():+—–-]+$/u.test(value) && /\p{Script=Cyrillic}/u.test(value);
}

function readCandidate(raw: unknown, facts: Facts, focus: string): Candidate | string {
  const c = raw as Partial<Candidate> | null;
  if (!c || !line(c.observation) || !line(c.action) || !Array.isArray(c.refs) || c.refs.length > Object.keys(facts).length + 2)
    return "Напиши короткие observation и action на русском, укажи ключи facts в refs.";
  const refs = c.refs.filter((ref: unknown) => ref !== "focus" && ref !== "reason");
  if (!refs.every(ref => typeof ref === "string" && Object.hasOwn(facts, ref)) ||
      !refs.some(ref => ref === focus)) return "В refs скопируй точные ключи facts. Обязательно укажи " + focus + ".";
  // Check boundaries locally before a second independent reading of the meaning.
  const text = c.observation + " " + c.action;
  if (/последств/iu.test(c.action) && facts.isNeedUp !== true) return "Спроси о главном риске заявки. Здесь нет отметки об устранении последствий.";
  if (text.split(/\s+/u).length > 65 ||
      /(?:закройте|отправьте|назначьте|переведите|измените|эскалируйте|перезапустите|удалите|отключите|обновите|установите|можно ли (?:назначить|установить) срок)/iu.test(c.action)) return "Оставь одно короткое наблюдение и один вопрос для ручной проверки, без поручений что-либо менять.";
  // Separate the two subjects in «эта заявка назначена, а в группе ...».
  // Commas introducing a qualifier of the same subject stay in the clause.
  const observation = facts.assignedGroupName === "Группа координаторов" && refs.includes("assignedGroupName")
    ? c.observation.replace(/групп[аеуойы]+\s+координаторов/giu, "команде координаторов") : c.observation;
  if (/(?:все|всех|каждая|каждой)\s+просроч\p{L}*[^.!?;]{0,36}(?:критичн|приоритет)/iu.test(observation))
    return "Счётчик просрочек не показывает их приоритет. Оставь одно наблюдение об этой заявке.";
  if (facts.stateId === "Назначен" && /(?:работ\p{L}*|выполнени\p{L}*)\s+(?:ещ[её]\s+)?не\s+нача/iu.test(observation))
    return "Из статуса «Назначен» неизвестно, начались ли работы. Укажи только известный факт из focus.";
  const allOverdue = /(?<!\p{L})(?:все|всех|кажд\p{L}*|столько же)(?!\p{L})[^.!?,;]{0,32}(?:просроч|срок\p{L}* (?:уже )?(?:прош|ист[её]к|наруш))|просроч\p{L}*[^.!?,;]{0,24}(?:столько же|все)(?!\p{L})/iu.test(observation);
  if (allOverdue) {
    if (!facts["group.allOverdue"]) return "Часть заявок не просрочена. Приведи только известный счётчик просроченных заявок либо пропусти сведения о группе.";
    refs.push("group.allOverdue");
  }
  if (facts.stateId !== "Выполняется" && /(?:находится|находятся|сейчас|уже|заявка|заявки|она)\s+в работе/iu.test(observation))
    return "Назначение и исследование не означают статус «Выполняется». Используй точный текущий статус заявки.";
  for (const clause of observation.split(/[.!?;]|[,—]\s*(?:(?:а|но|и|однако|при этом)\s+)?(?=в (?:этой |текущей )?группе|в очереди|у этой заявки|эта заявка|по этой заявке)/iu)) {
    const groupClaim = /все заявки|всех заявок|(?:в|у) групп|в очереди|ни одн|кажд\p{L}* заявк|все (?:они )?в работе/iu.test(clause);
    if (groupClaim && (/приоритет|исполнител|назначен|статус|исследован|последств|поручен|в работе|все в пределах сроков/iu.test(clause) ||
        !refs.some(ref => ref.startsWith("group.")))) return "Не приписывай группе свойства этой заявки. Опиши только заявку, счётчик группы можно опустить.";
  }
  const action = c.action.trim().replace(/^вы\s+(уточните|сверьте|проверьте|запросите)(?=\s|,)/iu,
    (_, verb: string) => verb[0].toUpperCase() + verb.slice(1));
  if (!/^\p{Script=Cyrillic}+(?:те|тесь)(?=\s|,)/iu.test(action)) return "Первое слово action — «Уточните», «Проверьте» или другой глагол в повелительном наклонении. Опусти местоимение.";
  const numbers = new Set<string>();
  let remaining = text;
  for (const ref of refs) {
    const fact = String(facts[ref]);
    if (fact === "800+") {
      remaining = remaining.replace(/(?:не (?:менее|меньше)|от|минимум|как минимум)\s+800(?!\d)|(?<!\d)800(?:\+|\s+(?:и|или)\s+(?:более|больше))/giu, "");
    } else if (/^\d+–\d+$/u.test(fact)) {
      const [low, high] = fact.split("–");
      remaining = remaining.replace(new RegExp("(?<!\\d)(?:от\\s+)?" + low + "\\s*(?:[-–—]|до)\\s*" + high + "(?!\\d)", "giu"), "");
    } else {
      for (const n of fact.match(/\d+/gu) ?? []) numbers.add(n);
    }
  }
  if ((remaining.match(/\d+(?:[.,]\d+)?/gu) ?? []).some(n => !numbers.has(n))) return "Убери неподтверждённые числа. Граница диапазона не является точным числом заявок.";
  return { observation: c.observation.trim(), action, refs: [...new Set(refs)] };
}

export async function refineLiveStep(
  client: VseLlm | undefined, step: LiveStep, row: Incident, group: TriageCase, now: number,
  isCurrent: () => boolean = () => true,
): Promise<Advice> {
  const fallback = (reason: "unconfigured" | "unavailable" | "unverified", retryAfterMs?: number): Advice => ({
    key: step.key, action: step.action, mode: "local", reason, ...(retryAfterMs ? { retryAfterMs } : {}),
  });
  if (!client) return fallback("unconfigured");
  const facts = liveFacts(row, now, group);
  const packet = { reason: step.reason, focus: step.evidence.field, facts };
  const busy = (message: string) => fallback("unavailable", message.includes("лимит") ? 60_000 : 12_000);
  const until = Date.now() + 15_000;
  let request: object = packet;
  for (let attempt = 0; attempt < 2 && Date.now() < until; attempt++) {
    const stage = attempt ? version + "-revise" : version;
    const response = await client.json(stage, instruction, request, Math.min(9_000, Math.max(1, until - Date.now())), "background", isCurrent);
    if (!isCurrent()) return fallback("unavailable");
    if ("error" in response) return busy(response.error);
    const candidate = readCandidate(response.json, facts, packet.focus);
    let problem: string;
    if (typeof candidate === "string") {
      problem = candidate;
    } else {
      // Only cited fields can substantiate prose. Unrelated queue totals no longer
      // invalidate an identical independent check, even when generation runs again.
      const review = { reason: step.reason, focus: packet.focus, candidate,
        facts: Object.fromEntries(candidate.refs.map(ref => [ref, facts[ref]])),
        context: { assignedEmployee: facts.assignedEmployee, assignedGroupName: facts.assignedGroupName,
          isNeedUp: facts.isNeedUp, sourcePresent: facts.sourcePresent } };
      const check = await client.json(version + "-review", reviewInstruction, review,
        Math.min(6_000, Math.max(1, until - Date.now())), "background-review", isCurrent);
      if (!isCurrent()) return fallback("unavailable");
      if ("error" in check) return busy(check.error);
      const verdict = check.json as { grounded?: unknown; manual?: unknown } | null;
      if (verdict?.grounded === true && verdict.manual === true)
        return { key: step.key, mode: "model", model: client.model, action: candidate.action,
          text: candidate.observation + " " + candidate.action };
      problem = verdict?.grounded !== true ? "Проверка не подтвердила все утверждения. Упрости наблюдение до одного факта об этой заявке из focus. Не делай выводов о других заявках."
        : "Проверка действия не пройдена. Предложи один относящийся к focus вопрос команде, без изменений записи.";
    }
    if (attempt) client.rejectJson(stage, request);
    else {
      const draft = response.json as Partial<Candidate> | null;
      request = { ...packet, revisionRequest: problem,
        ...(line(draft?.observation) && line(draft?.action) ? { previousWording: { observation: draft.observation, action: draft.action } } : {}) };
    }
  }
  client.rejectJson(version, packet);
  return fallback("unverified", 12_000);
}
