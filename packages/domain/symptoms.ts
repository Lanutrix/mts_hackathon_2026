import type { Incident } from "./index.ts";

// Match the reported failure, including colloquial descriptions of its stage.
// A topic by itself (a password, a payment, an SMS) is not evidence of a failure.
const symptoms = [
  {
    label: "Повторное списание",
    observed: /(?:двойн\p{L}*|повторн\p{L}*) списани|(?:сумм\p{L}* |деньги )?списа\p{L}* (?:дважды|два раза|повторно)|(?:дважды|повторно|два раза) списа/u,
    query: /двойн\p{L}* списан|дважды списа|повторн\p{L}* списан/u,
    check: "Сверьте идентификаторы операций и время обоих списаний.",
  },
  {
    label: "Не доставлено уведомление",
    observed: /(?:не (?:приход\p{L}*|пришел|пришло|пришли|поступ\p{L}*|достав\p{L}*) (?:одноразов\p{L}* )?(?:код|сообщени|смс|sms|уведомлен)|(?:код|смс|sms|уведомлени|сообщени)[^,;.!?]{0,32} не (?:приход|пришел|пришло|пришли|поступ|достав)|(?:смс|sms|сообщени\p{L}*) с кодом (?:отсутств|задерж))/u,
    query: /не приход\p{L}* (?:код|смс|sms|уведомлен)|недостав|доставк\p{L}* уведомлен/u,
    check: "Сопоставьте канал доставки и отметки об отправке и получении сообщения.",
  },
  {
    label: "Ошибки оплаты",
    observed: /платеж\p{L}* не (?:проход|прош|принима)|не проход\p{L}* (?:оплат|платеж)|ошиб\p{L}* (?:при )?оплат|отклон\p{L}* (?:оплат|платеж)|(?:оплат\p{L}*|платеж\p{L}*) (?:отклон|заверш\p{L}* (?:ошиб|отказ))|не удается оплатить|(?:при оплате|при подтверждении оплаты)[^.!?;]{0,32}(?:возвращает отказ|ошибк)/u,
    query: /оплат|плат[её]ж/u,
    check: "Сопоставьте этап оплаты и код ответа платёжного шлюза.",
  },
  {
    label: "Ошибки авторизации",
    observed: /ошиб\p{L}* (?:при )?(?:вход|авторизац|аутентификац)|не (?:удается|получается|могу|может|могут) (?:войти|авторизоваться|зайти в (?:кабинет|аккаунт))|не (?:входит|работает вход|пускает в (?:кабинет|аккаунт))|(?:снова|повторно|заново)[^.!?;,]{0,22}(?:экран входа|форм[уа] входа|запрашивает пароль|просит пароль)|(?:авторизаци\p{L}*|вход) заверш\p{L}* ошибк|возвращает на (?:экран|форму) входа/u,
    query: /авторизац|аутентификац|(?:^| )вход|войти/u,
    check: "Сопоставьте этап входа и ответ формы после ввода пароля или кода.",
  },
  {
    label: "Обрывы соединения",
    observed: /(?:соединени|связь|сессия|интернет)[^.!?,;]{0,20}(?:обрыва|разрыва|пропада|теряет|отвалива)|(?:обрыв\p{L}*|разрыв\p{L}*|потер\p{L}*) (?:сетев\p{L}* )?(?:соединени|связи)|пропада\p{L}* (?:связь|интернет)/u,
    query: /обрыв|разрыв соединени|пропада\p{L}* (?:связь|интернет)/u,
    check: "Сопоставьте время разрыва и точки подключения.",
  },
  {
    label: "Задержка ответа",
    observed: /(?:рост|увеличени\p{L}*) времени ответа|медленн\p{L}* (?:ответ|загруз|откры|работает)|(?:отвеча\p{L}*|открыва\p{L}*|загружа\p{L}*) (?:медлен|долго)|долго (?:открыва|загружа|отвеча)|задержк\p{L}* ответа|тайм[- ]?аут|истекло время ожидания|превышено время ожидания/u,
    query: /тайм.?аут|задержк\p{L}* ответ|медленн|времени ответа/u,
    check: "Сопоставьте длительность запроса и операцию, на которой возникла задержка.",
  },
  {
    label: "Не обновляются данные",
    observed: /(?:данные|баланс|статус|остаток) не обновл|(?:показыва|отобража)\p{L}* устаревш\p{L}* данн|не обновл\p{L}* (?:данные|баланс|статус)|данные (?:устарели|застыли)/u,
    query: /устаревш\p{L}* данн|не обновл\p{L}* (?:данные|баланс|статус)/u,
    check: "Сверьте время последнего обновления и значение в системе-источнике.",
  },
  {
    label: "Недоступность операции",
    observed: /недоступност\p{L}* операц|операци\p{L}* недоступн|не удается выполнить операцию/u,
    query: /недоступност[ьи] операц|операци[ия] недоступн/u,
    check: "Сверьте название операции и шаг, на котором она стала недоступна.",
  },
];

export const symptomQueries = symptoms.map(({ label, query: pattern }) => ({ label, pattern }));
export interface SymptomEvidence { id: string; field: string; value: string }
export interface SymptomTheme {
  label: string;
  count: number;
  check: string;
  examples: SymptomEvidence[];
}
type Observation = Omit<SymptomEvidence, "id"> & Pick<SymptomTheme, "label" | "check">;

// Keep the polarity of each statement. In particular, a negative statement
// about login must not mask a subsequent positive report about a payment.
const qualified = /(?:^|[^\p{L}])(?:ранее|раньше|вчера (?:был|были)|инструкци\p{L}*|если|есть ли|при отсутствии|без (?:ошиб|тайм)|нет (?:ошиб|проблем|тайм|сбо)|проверить[, ]|(?:не (?:было|наблюда|обнаруж|зафиксир|воспроизвод|подтвержд|выявл))|(?:ошиб\p{L}*|тайм[- ]?аут\p{L}*)[^.!?;,]{0,40} нет|устранен\p{L}*|исправлен\p{L}*)/u;
const fieldNames = ["header", "shortDescription", "description"] as const;
export function* reportedClauses(row: Incident) {
  for (const field of fieldNames) {
    const source = row.raw[field];
    if (typeof source !== "string") continue;
    for (const piece of source.slice(0, 2400).split(/(?<=[.!?;\n])\s*|,\s*(?:но|однако|зато)\s+/iu)) {
      const quote = piece.trim();
      const text = quote.toLowerCase().replaceAll("ё", "е").replace(/\s+/gu, " ");
      if (!text || text.endsWith("?") || qualified.test(text)) continue;
      yield { field, text, quote };
    }
  }
}
function observe(row: Incident): Observation | undefined {
  for (const { field, text, quote } of reportedClauses(row)) {
    for (const symptom of symptoms) {
      const match = symptom.observed.exec(text);
      if (!match) continue;
      // Locate the matched phrase in the original whitespace before quoting it.
      let start = 0;
      if (quote.length > 200) {
        const before = text.slice(0, match.index);
        const word = before.match(/ /g)?.length ?? 0;
        const at = [...quote.matchAll(/\S+/gu)][word]?.index ?? match.index;
        start = Math.max(0, at - 45);
      }
      return { label: symptom.label, check: symptom.check, field, value: quote.slice(start, start + 200) };
    }
  }
}

// Dashboard refreshes and drilldowns read the same immutable snapshot rows.
// Guard the memo against edited raw fields in callers rebuilding a snapshot.
const observations = new WeakMap<Incident, { fields: unknown[]; observation?: Observation }>();
export function knownSymptom(row: Incident): Observation | undefined {
  const cached = observations.get(row);
  if (cached && fieldNames.every((field, i) => row.raw[field] === cached.fields[i])) return cached.observation;
  const observation = observe(row);
  observations.set(row, { fields: fieldNames.map(field => row.raw[field]), observation });
  return observation;
}

export function recurringSymptoms(rows: Incident[]): SymptomTheme[] {
  const themes = new Map<string, SymptomTheme>();
  for (const row of rows) {
    const observed = knownSymptom(row);
    if (!observed) continue;
    let theme = themes.get(observed.label);
    if (!theme) {
      theme = { label: observed.label, check: observed.check, count: 0, examples: [] };
      themes.set(theme.label, theme);
    }
    theme.count++;
    const { field, value } = observed;
    const example = { id: row.id, field, value };
    if (theme.examples.length < 2) theme.examples.push(example);
    else if (theme.examples[0].value === theme.examples[1].value && value !== theme.examples[0].value)
      theme.examples[1] = example;
  }
  return [...themes.values()].filter(theme => theme.count > 1)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru")).slice(0, 2);
}
