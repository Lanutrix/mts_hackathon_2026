import {
  deadlineStatus,
  spaces,
  type Incident,
} from "../../packages/domain/index.ts";
import {
  knownSymptom,
  type CaseEvidence,
  type TriageCase,
} from "../../packages/domain/triage.ts";
import type { Analysis } from "./analysis.ts";
import { VSELLM_PROMPT, type VseLlm, type EvidencePacket } from "./vsellm.ts";

const concepts: [RegExp, string][] = [
  [
    /почему|причин|вызва|объясн|объясни|поясни/u,
    "Объясни причины только при наличии подтверждения",
  ],
  [
    /приоритет|первую очередь|первы[йм]|срочн|важнее|критич/u,
    "Определи очередность и объясни приоритет",
  ],
  [
    /сравни|сравне|сопостав|отлич|различ|похож|общег|общие|связь|связан/u,
    "Сопоставь сходства и различия между заявками",
  ],
  [/срок|дедлайн|просроч|успе|ближайш|опозда/u, "Оцени сроки решения"],
  [
    /ответствен|исполнител|назнач|команд|владел|владель|кто/u,
    "Проверь назначение и ответственность",
  ],
  [/продукт|сервис|услуг/u, "Сопоставь данные о затронутых продуктах"],
  [
    /устран\p{L}* последств|доработ/u,
    "Проверь отметку о необходимости устранить последствия после решения",
  ],
  [/передать|передач/u, "Проверь указанную ответственную группу"],
  [/риск|опасн|грозит/u, "Оцени операционные риски"],
  [
    /симптом|признак|признаки|прояв|жалоб|описан|не работа|происхо|случил|проблем/u,
    "Опиши симптомы, которые подтверждаются источником",
  ],
  [/оплат|плат[её]ж|платит/u, "Рассмотри ошибки оплаты"],
  [/вход|войти|авторизац|аутентификац/u, "Рассмотри ошибки входа"],
  [
    /таймаут|тайм-аут|задержк|медлен|времени ответа/u,
    "Рассмотри задержки ответа",
  ],
  [/статус|состояни|стади|активн|закрыт|заверш/u, "Проверь текущее состояние"],
  [
    /влияни|клиент|пользовател|масштаб|затронут/u,
    "Оцени подтверждённый масштаб влияния",
  ],
  [
    /сколько|число|количеств|дол[яю]/u,
    "Ответь на вопрос о количестве, если объём известен",
  ],
  [
    /провер|дальше|дальнейш|следующ|рекоменду|совет|делать|действи|начать|план/u,
    "Предложи следующую ручную проверку",
  ],
  [
    /истори|измен|динамик|предыдущ/u,
    "Опиши подтверждённые изменения; без истории укажи, что известен только текущий срез",
  ],
  [
    /дубл|повтор/u,
    "Проверь, имеются ли признаки повтора. Совпадение симптома само по себе не подтверждает дубль",
  ],
  [
    /сводк|резюм|итог|суммар|кратк|разбор|суммируй|сведи/u,
    "Составь короткую операционную сводку",
  ],
];
const quickDeadlines =
  /^(?:у каких инцидентов приближается срок решения|сроки(?: решения)?|(?:какие|у кого|когда) (?:сроки|дедлайн)|какие (?:инциденты|заявки) просрочены)[?!.]*$/u;
const quickOwners =
  /^(?:какие команды отвечают за выбранные инциденты|ответственные|кто (?:отвечает|ответственный|исполнитель)(?: за (?:выбранные )?(?:заявки|инциденты))?)[?!.]*$/u;
const defaultQuestion =
  "Объясни, что происходит, что требует внимания координатора и какую проверку выполнить первой.";
const unknown = "По доступным полям нельзя подтвердить ответ на этот вопрос.";
const uncertainty =
  "Первопричина и число затронутых пользователей требуют отдельного подтверждения.";

// Preserve focus, negation and ordering while forwarding only a closed
// operational vocabulary. Unrecognized words, quoted names and raw IDs never
// become part of the provider request, even in the public demo.
const vocabulary = new Set(
  `
  а в на во к по от до за с со между из и или но если что чем как почему зачем когда где кто у
  не нет без ещё уже только кроме при после раньше позже больше меньше всех прежде сначала затем
  эти этот эту этом для них них ли какой какая какие каких каком сколько есть можно нужно надо
  самый самая самые первым первой первую очередь быстрее наиболее выше ниже одинаковые разные
  сравни сравните сравнить сопоставь поясни объясни обоснуй перечисли назови выдели оцени
  выбери покажи проверь уточни какие какой чем отличаются отличается связаны связать общий общие
  общего одинаковые разные общее причина причины причиной причину почему симптомы симптом признак признаки
  инцидент инциденты инцидента инцидентам инцидентов заявка заявки заявок заявкам тикет тикеты тикетов
  выбранные выбранных риск риски риска выше влияния влияние пользователей клиентов затронуто массовый масштаб
  срок сроки срока просрочена просрочены просрочки просрочка приближается истекает дедлайн минут
  важнее важный критичный критические приоритет приоритеты приоритету наивысший высокий средний низкий
  устранение устранения последствия последствий доработка доработки решения нужна требуется нужен требуют нуждаются
  команда команды команде отвечают отвечает ответственный исполнитель назначена назначение группе группы
  платёж платеж платежи платежей оплата оплате оплаты вход входа авторизация авторизации задержка
  задержки ответа ошибки ошибка статус состоянии состояние действия проверить проверки сверить дальше
  делать начать очередность решения работе работе обработать продукт продукта продукты сервис сервиса
  данные данных информации неизвестно известно хватает отсутствует полей поля история изменения изменилось
  изменилась изменился изменились повтор повторные дубли дублируются одинаковый восстановление восстановлен
  подтверждается подтвердить подтверждена подтверждено потеря потери доступность недоступность
`
    .trim()
    .split(/\s+/),
);
export function safeOperationalWord(word: string) {
  return vocabulary.has(word);
}
export function scrubRehearsalQuestion(question: string) {
  return question
    .slice(0, 500)
    .replace(/[\u0000-\u001f<>]/gu, " ")
    .replace(
      /(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu,
      "[скрыто]",
    )
    .replace(
      /(?:bearer\s+|(?:token|secret|password|api[_ -]?key|ключ|пароль|токен)\s*[:=]\s*)[^\s,;]+/giu,
      "[скрыто]",
    )
    .replace(
      /\b(?:sk-|ghp_|github_pat_|eyJ)[A-Za-z0-9._-]+|\b[A-Za-z0-9+/_=-]{24,}\b/gu,
      "[скрыто]",
    )
    .replace(/(?:\+?\d[\s()-]*){10,}/gu, "[скрыто]");
}
function questionTask(question: string, rows: Incident[], namespace: string) {
  if (!question.trim()) return defaultQuestion;
  if (namespace === "simulation") {
    let query = scrubRehearsalQuestion(question);
    for (const [i, row] of rows.entries())
      query = query.replaceAll(row.id, "T" + (i + 1));
    return "Вопрос координатора по учебной подборке: " + query.trim();
  }
  let lower = question.toLocaleLowerCase("ru");
  const mentions = new Map<string, string[]>();
  for (const [i, row] of rows.entries()) {
    for (const name of [
      row.id,
      row.team,
      spaces(row.raw.productName),
      spaces(row.raw.assignedEmployee),
    ]) {
      if (name.length < 2) continue;
      const key = name.toLocaleLowerCase("ru");
      const refs = mentions.get(key) ?? [];
      const ref = "T" + (i + 1);
      if (!refs.includes(ref)) refs.push(ref);
      mentions.set(key, refs);
    }
  }
  // Longest first so a short ID or name cannot split another one.
  const refs: string[] = [];
  for (const name of [...mentions.keys()].sort((a, b) => b.length - a.length)) {
    if (!lower.includes(name)) continue;
    const token =
      "\u001e" + refs.push(mentions.get(name)!.join("/")) + "\u001f";
    lower = lower.replaceAll(name, token);
  }
  const intents = concepts
    .filter(([pattern]) => pattern.test(lower))
    .map(([, prompt]) => prompt);
  if (!intents.length) return null;
  const shape = (lower.match(/\u001e\d+\u001f|[\p{L}\p{N}_-]+/gu) ?? [])
    .map((token) => {
      if (token.startsWith("\u001e"))
        return refs[Number(token.slice(1, -1)) - 1];
      return vocabulary.has(token) ? token : "…";
    })
    .join(" ")
    .replace(/(?:… ){2,}/gu, "… ");
  return (
    "Вопрос в обезличенной форме: " +
    shape +
    ". Многоточие обозначает скрытые слова; не угадывай их значение. " +
    intents.join(". ") +
    "."
  );
}

function structuredAnswer(
  rows: Incident[],
  question: string,
  zone: string,
  now: number,
): string[] | undefined {
  const q = question.trim().toLocaleLowerCase("ru");
  if (quickOwners.test(q))
    return rows.map(
      (row) =>
        row.id +
        " · " +
        (row.team || "Команда не указана") +
        " · " +
        (spaces(row.raw.assignedEmployee) || "Исполнитель не указан"),
    );
  if (!quickDeadlines.test(q)) return;
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return [...rows]
    .sort((a, b) =>
      (a.dates.deadline ?? "9999").localeCompare(b.dates.deadline ?? "9999"),
    )
    .map((row) => {
      const d = row.dates.deadline;
      return (
        row.id +
        " · " +
        (d
          ? (Date.parse(d) < now ? "Срок прошёл " : "Срок ") +
            fmt.format(Date.parse(d)) +
            " (" +
            zone +
            ")"
          : "Срок не задан")
      );
    });
}

function sourceFacts(rows: Incident[], namespace: string, now: number) {
  const facts: EvidencePacket["facts"] = {};
  const sources = new Map<string, CaseEvidence>();
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))];
  const products = [
    ...new Set(rows.map((r) => spaces(r.raw.productName)).filter(Boolean)),
  ];
  rows.forEach((row, i) => {
    const put = (
      field: string,
      safe: string | number | boolean | null,
      actual: unknown,
    ) => {
      const ref = "T" + (i + 1) + "." + field;
      facts[ref] = safe;
      sources.set(ref, {
        id: row.id,
        field,
        value:
          actual == null || actual === ""
            ? "Не указано"
            : String(actual).slice(0, 360),
      });
    };
    put("priorityId", row.priorityId, row.raw.priorityId);
    put("stateId", row.stateId, row.raw.stateId);
    put("deadline", deadlineStatus(row.dates.deadline, now), row.raw.deadline);
    put(
      "isNeedUp",
      typeof row.raw.isNeedUp === "boolean" ? row.raw.isNeedUp : null,
      row.raw.isNeedUp,
    );
    put(
      "assignedGroupName",
      row.team ? "группа " + (teams.indexOf(row.team) + 1) : null,
      row.team,
    );
    const product = spaces(row.raw.productName);
    put(
      "productName",
      product ? "продукт " + (products.indexOf(product) + 1) : null,
      product,
    );
    put("sourcePresent", row.sourcePresent, row.sourcePresent);
    if (row.quarantined) put("quarantined", true, true);
    // Only the isolated rehearsal is populated exclusively from built-in text.
    // The demo namespace accepts file imports, so treat it like private data.
    if (namespace === "simulation") {
      for (const field of ["header", "description"]) {
        const excerpt = spaces(row.raw[field]).slice(0, 300);
        if (excerpt) put(field, excerpt, excerpt);
      }
    } else {
      const symptom = knownSymptom(row);
      if (symptom) put(symptom.field, symptom.label, row.raw[symptom.field]);
    }
  });
  return { facts, sources };
}

interface OperationalReading {
  summary: string[];
  evidence: CaseEvidence[];
  sampled: number;
}
export async function operationalReading(
  client: VseLlm,
  rows: Incident[],
  namespace: string,
  question: string,
  group?: TriageCase,
  changed: string[] = [],
): Promise<OperationalReading | { error: string }> {
  if (/эскал|escalat/iu.test(question))
    return {
      error:
        "В источнике нет поля, которое показывает передачу заявки на другой уровень поддержки. Проверьте историю в ITSM.",
    };
  let sample = rows;
  if (group && rows.length > 6) {
    const witnesses = new Set([...group.evidence, ...group.themes.flatMap(theme => theme.examples)].map(e => e.id));
    const spread = Array.from(
      { length: 6 },
      (_, i) => rows[Math.floor((i * (rows.length - 1)) / 5)],
    );
    sample = [
      ...new Set([...rows.filter((r) => witnesses.has(r.id)), ...spread]),
    ].slice(0, 6);
  }
  const task = questionTask(question, sample, namespace);
  if (!task) return { error: unknown } as const;
  const { facts, sources } = sourceFacts(sample, namespace, Date.now());
  const trackedChanges = changed.filter((f) =>
    [
      "priorityId",
      "stateId",
      "deadline",
      "isNeedUp",
      "assignedGroupName",
      "productName",
      "header",
      "description",
    ].includes(f),
  );
  if (sample.length === 1 && trackedChanges.length) {
    const value = trackedChanges.join(", ");
    facts["T1.history.changed"] = value;
    sources.set("T1.history.changed", {
      id: sample[0].id,
      field: "history.changed",
      value,
    });
  }
  const counts: Record<string, number> = group
    ? {
        tickets: group.count,
        overdue: group.overdue,
        dueWithin15Min: group.soon,
        noDeadline: group.deadlineMissing,
        needsPostResolutionWork: group.escalations,
        missingFromSource: group.unverified,
      }
    : { tickets: rows.length };
  const result = await client.read({ task, facts, counts });
  if ("error" in result) return { error: result.error } as const;
  // A shared observation or queue attribute cannot establish a common cause.
  // This packet has no confirmed causal relationship or duplicate reference.
  if (group && [result.reading.answer, result.reading.nextCheck].some(line =>
    line.toLowerCase().split(/[.!?;]|,\s*(?:но|однако)\s+/u).some(part =>
      /причин|вызван|из-за|обусловлен|дубликат|являются дублями|один и тот же сбой/u.test(part) &&
      !/не (?:подтвержден|подтвержд[её]н|установлен|выяснен|извест|доказан)|неизвест|нельзя (?:установить|подтвердить|считать)|требу\p{L}* (?:провер|подтвержден)|уточните|проверьте|выясните/u.test(part)))) {
    return { error: "Общая причина требует отдельного подтверждения." } as const;
  }
  const evidence = result.reading.refs.map((ref) => sources.get(ref)!);
  const ids = sample.map((row) => row.id);
  const resolveText = (s: string) =>
    s.replace(/\bT(\d+)\b/g, (_, n: string) => ids[Number(n) - 1]);
  return {
    summary: [
      resolveText(result.reading.answer),
      "Следующая проверка — " + resolveText(result.reading.nextCheck),
    ],
    evidence,
    sampled: sample.length,
  } as const;
}

function fieldAnalysis(row: Incident): Analysis {
  return {
    summary: [
      row.priorityLabel + " приоритет. Статус — " + row.stateLabel + ".",
    ],
    evidence: [{ claim: 0, fields: ["priorityId", "stateId"] }],
    uncertainties: [uncertainty],
    suggestedTeams: [],
    model: "",
    provider: "Поля ITSM",
    inputRevision: row.revision,
    generatedAt: new Date().toISOString(),
    promptVersion: "",
    stale: false,
    mode: "fallback",
  };
}

export async function analyzeSelection(
  rows: Incident[],
  current: (r: Incident) => Incident | undefined,
  namespace: string,
  question: string,
  zone: string,
  client?: VseLlm,
) {
  const fields = structuredAnswer(rows, question, zone, Date.now());
  if (fields)
    return {
      overview: fields,
      items: [],
      mode: "fields" as const,
      provider: "Поля ITSM",
      stale: false,
    };
  const result = client
    ? await operationalReading(client, rows, namespace, question)
    : { error: "VseLLM не настроен." };
  const stale = rows.some((r) => current(r)?.hash !== r.hash);
  if ("error" in result)
    return {
      overview: [result.error, "Ниже приведены поля выбранных заявок."],
      items: rows.map((row) => ({
        id: row.id,
        analysis: {
          ...fieldAnalysis(row),
          stale: current(row)?.hash !== row.hash,
        },
      })),
      mode: "fallback" as const,
      provider: "Поля ITSM",
      stale,
    };
  const cited = [...new Set(result.evidence.map((e) => e.id))];
  const overview = [...result.summary, "Основания — " + cited.join(", ") + "."];
  const items = rows.map((row) => {
    const analysis = fieldAnalysis(row);
    analysis.stale = current(row)?.hash !== row.hash;
    const evidence = result.evidence.filter((e) => e.id === row.id);
    if (evidence.length) {
      analysis.summary = evidence.map((e) => e.value);
      analysis.evidence = evidence.map((e, claim) => ({
        claim,
        fields: [e.field],
      }));
    }
    return { id: row.id, analysis };
  });
  return {
    overview,
    items,
    mode: "model" as const,
    provider: "VseLLM",
    model: client!.model,
    promptVersion: VSELLM_PROMPT,
    stale,
  };
}

export async function analyzeOperationalTicket(
  client: VseLlm | undefined,
  row: Incident,
  current: () => Incident | undefined,
  namespace: string,
  question: string,
  changed: string[],
) {
  const base = fieldAnalysis(row);
  const fields = structuredAnswer([row], question, "Europe/Moscow", Date.now());
  if (fields) {
    base.summary = fields;
    base.evidence = [
      {
        claim: 0,
        fields: quickOwners.test(question.toLocaleLowerCase("ru").trim())
          ? ["assignedGroupName", "assignedEmployee"]
          : ["deadline"],
      },
    ];
    return base;
  }
  if (!client)
    return { ...base, error: "VseLLM не настроен. Показаны поля заявки." };
  const result = await operationalReading(
    client,
    [row],
    namespace,
    question,
    undefined,
    changed,
  );
  base.stale = current()?.hash !== row.hash;
  if ("error" in result) return { ...base, error: result.error };
  return {
    ...base,
    mode: "model" as const,
    provider: "VseLLM",
    model: client.model,
    promptVersion: VSELLM_PROMPT,
    summary: result.summary,
    evidence: result.summary.map((_, claim) => ({
      claim,
      fields: result.evidence.map((e) => e.field),
    })),
  };
}
