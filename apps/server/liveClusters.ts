import { hash, spaces, type Incident } from "../../packages/domain/index.ts";
import type { PlatformIcon } from "../../packages/domain/platformIcons.ts";
import { knownSymptom, reportedClauses } from "../../packages/domain/symptoms.ts";
import type { Facet } from "../../packages/domain/triage.ts";
import { observedPattern } from "./semanticGroups.ts";
import type { VseLlm } from "./vsellm.ts";
import { trainingCatalog } from "../../packages/domain/trainingCatalog.ts";

// Only these public concepts leave the process. Source quotes, product names,
// people and ticket identifiers are resolved against the current snapshot locally.
type Sign = { label: string; icon: PlatformIcon; roots: string };
const signs: Record<string, Sign> = {
  login: { label: "Ошибки авторизации", icon: "login", roots: "вход войти авторизац аутентификац парол" },
  duplicateCharge: { label: "Повторное списание", icon: "payment", roots: "повтор двой дважды списан списыв" },
  message: { label: "Не доставлено уведомление", icon: "bell", roots: "уведомлен достав код сообщен смс поступ приход" },
  payment: { label: "Ошибки оплаты", icon: "payment", roots: "оплат платёж платеж отклон отказ" },
  network: { label: "Обрывы соединения", icon: "network", roots: "обрыв разрыв соединен связ сет интернет" },
  slow: { label: "Задержка ответа", icon: "duration", roots: "задерж ответ медлен ожидани долги долгие долго тайм аут врем" },
  stale: { label: "Не обновляются данные", icon: "sync", roots: "обновл данн устарев синхрониз" },
  operation: { label: "Недоступность операции", icon: "symptom", roots: "операци недоступ" },
  export: { label: "Экспорт данных", icon: "file", roots: "экспорт выгруз скач отчёт отчет файл данн" },
  import: { label: "Импорт данных", icon: "intake", roots: "импорт загруз файл данн" },
  search: { label: "Поиск", icon: "research", roots: "поиск запрос выдач" },
  update: { label: "Обновление данных", icon: "sync", roots: "обновл данн синхрониз сохран" },
  access: { label: "Доступ", icon: "login", roots: "доступ вход сесси прав" },
  empty: { label: "Пустой результат", icon: "file", roots: "пуст результат строк запис" },
  stuck: { label: "Ожидание без завершения", icon: "duration", roots: "ожидан заверш завис останов" },
  repeated: { label: "Повтор операции", icon: "history", roots: "повтор дублир дважды операци" },
  denied: { label: "Отказ при выполнении", icon: "quality", roots: "отказ отклон выполн запрет запрещ блокир" },
  form: { label: "Форма", icon: "system", roots: "форм экран открыт открыва" },
  portal: { label: "Личный кабинет", icon: "login", roots: "личн кабинет" },
  list: { label: "Список операций", icon: "queue", roots: "спис список операци" },
  status: { label: "Статус", icon: "sync", roots: "статус состоян" },
  load: { label: "Не удаётся загрузить", icon: "intake", roots: "загруз загруж загрузк" },
  error: { label: "Ошибка", icon: "symptom", roots: "ошиб сбо отказ" },
};
const symptomIds = new Map(Object.entries(signs).map(([key, value]) => [value.label, key]));
const domains: [string, string, PlatformIcon, RegExp, string][] = [
  ["dns", "Разрешение адресов DNS", "dns", /\bdns\b|доменн.{0,10}имен/iu, "домен имен адрес разрешен dns"],
  ["database", "Работа базы данных", "database", /баз[аыуе] данных|\b(?:sql|postgresql)\b|репликац/iu, "баз данн репликац запи таблиц запрос"],
  ["sim", "Работа SIM-карт", "sim", /\b(?:sim|esim)\b/iu, "sim esim сим карт профил подключен активац"],
  ["queue", "Обработка очереди сообщений", "messages", /очеред.{0,15}(?:сообщ|задан|обработ)|брокер|\bkafka\b/iu, "очеред сообщ обработ задач брокер достав"],
  ["cdn", "Доставка медиаконтента", "cdn", /\bcdn\b|доставк.{0,8}(?:контент|медиа)|краев.{0,10}узл|кэш/iu, "достав медиа контент кэш кеш узл cdn"],
  ["video", "Воспроизведение видео", "video", /видео|воспроизвед|плеер|проигрыв|видеопоток/iu, "видео воспроизвед плеер проигрыв качеств просмотр"],
  ["calls", "Голосовые вызовы", "phone", /вызов|звонк|телефон|телефони|голос|\bатс\b/iu, "вызов звон голос телефон атс"],
  ["cloud", "Облачные ресурсы", "cloud", /облачн|виртуальн.{0,10}машин|гипервизор/iu, "облач ресурс виртуальн машин экземпляр"],
  ["store", "Хранение данных", "database", /хранилищ|резервн.{0,10}копи|объектн/iu, "хран хранилищ данн резерв копи объект"],
  ["mail", "Доставка почты", "mail", /почт|письм|писем|\bsmtp\b/iu, "почт письм писем достав отправ"],
  ["mobile", "Мобильное приложение", "mobile", /приложени|смартфон|мобильн.{0,8}клиент/iu, "мобильн приложени смартфон клиент"],
  ["internet", "Подключение к сети", "network", /интернет|радиодоступ|роуминг|wi-fi|lte|оптическ|туннел|корпоративн.{0,8}сет/iu, "сет соедин роуминг доступ подключен интернет трафик"],
  ["billing", "Платежи и начисления", "payment", /плат[её]ж|оплат|эквайр|начислен|биллинг|тариф|терминал/iu, "платеж платёж оплат начислен тариф баланс расчёт расчет терминал"],
  ["documents", "Обмен документами", "file", /документ|электронн.{0,10}подпис/iu, "документ подпис обмен файл"],
  ["monitor", "Мониторинг и телеметрия", "symptom", /мониторинг|телеметри|метрик|датчик/iu, "мониторинг телеметр метрик датчик сигнал"],
];
for (const [id,label,icon,,roots] of domains) signs[id] = {label,icon,roots};
const effects: [string,string,PlatformIcon,RegExp,string][] = [
  ["interrupted","Прерывание операции","symptom",/прерыва|обрыва|разрыва|сбрасыва|отключается/iu,"прерыва прерыв обрыв разрыв сброс отключен операци"],
  ["absent","Пропуск ожидаемого результата","research",/исчеза|пропада|пропущен|не появля|не приходит|не достав|не попада|не отобража/iu,"пропуск отсутств пропа пропущен исчез ожидаем результат отображен"],
  ["mismatch","Расхождение данных","relation",/расхожд|не совпад|расходят|отличает|не соответств|показывает прежн/iu,"расхожден несовпад различ данн значен результат"],
  ["waiting","Задержка выполнения","duration",/задерж|тайм.?аут|долго|завис|оста[её]тся в очереди|не заверша/iu,"задерж выполн операци ожидани долго завис ответ тайм аут"],
  ["refusal","Отказ при выполнении","quality",/отклон|отказ|запрещ|блокир|не уда[её]тся|не проходит/iu,"отказ отклон запрещ блокир выполн операци"],
];
for (const [id,label,icon,,roots] of effects) signs[id] = {label,icon,roots};
const wordsOf = (value: string) => value.toLowerCase().replaceAll("ё","е").match(/[а-яa-z0-9]+/gu) ?? [];
const stem = (word: string) => word.length < 6 ? word : word.replace(/(?:иями|ами|ями|ого|его|ения|ание|ить|еть|ий|ая|ой|ый|ее|ие|ые|ую|ов|ам|ом|ем|ах|ях|а|е|и|ы|у|ю|я)$/u,"");
const publicCases = new Map<string, { id: string; service: string; domains: string[] }>();
for (const service of trainingCatalog) {
  const serviceKey = "s" + hash(service.service).slice(0,6);
  const serviceTopics = domains.filter(([, , , re]) => re.test(service.service + " " + service.product));
  const icon = serviceTopics[0]?.[2] ?? "layers";
  signs[serviceKey] = {label: service.service, icon, roots: wordsOf(service.service + " " + service.product).map(stem).join(" ")};
  for (const [title] of service.cases) {
    const id = "c" + hash(title).slice(0,6);
    const caseIcon = domains.find(([, , , re]) => re.test(title))?.[2] ?? icon;
    // These are public authored examples, selected only on exact evidence.
    signs[id] = {label:title, icon:caseIcon, roots:wordsOf(title).map(stem).join(" ")};
    publicCases.set(title.toLowerCase(),{id,service:serviceKey,domains:serviceTopics.map(([key]) => key)});
  }
}
const contexts = [
  ["portal", /кабинет/u], ["form", /форм[аеуы]|формой/u],
  ["list", /список операций|списка операций/u], ["status", /статус/u],
] as const;
const conceptKey = (ids: string[]) => "topic:" + [...ids].sort().join("+");
type Profile = { ids: string[]; signature: string; local: Facet };

function profile(row: Incident): Profile {
  const header = spaces(row.raw.header), title = header.split(" · ")[0].trim();
  const example = publicCases.get(title.toLowerCase());
  const symptom = knownSymptom(row);
  const pattern = symptom || example ? undefined : observedPattern(row);
  let ids: string[] = [], label = "", field = "header", quote = "";
  if (example) {
    ids = [example.id];
    label = signs[example.id].label; quote = title;
  } else if (symptom) {
    ids = [symptomIds.get(symptom.label)!];
    ({ label, field, value: quote } = symptom);
  } else if (pattern) {
    ids = [pattern.area, pattern.effect];
    ({label, field, value: quote} = pattern);
  } else {
    for (const clause of reportedClauses(row)) {
      const context = contexts.find(([, re]) => re.test(clause.text));
      const effect = /не загруж|не загруз/u.test(clause.text) ? "load" :
        /не меняется|не изменя/u.test(clause.text) ? "stale" :
        /возникает ошибка|ошибка при|не открыва/u.test(clause.text) ? "error" : undefined;
      if (context && effect) {
        ids = [context[0], effect];
        label = signs[context[0]].label + " · " + signs[effect].label;
        ({field, quote} = clause);
        break;
      }
    }
  }
  if (!label) {
    // Unknown vocabulary stays local. A generic headline must not collapse
    // unrelated incidents with distinct descriptions into one giant bucket.
    const generic = !header || /^(?:обращение|заявка|инцидент|проблема|ошибка)(?: клиента| пользователя| из приложения)?[.!]?$/iu.test(header);
    const candidate = generic && (["description","shortDescription"] as const).find(f => spaces(row.raw[f]));
    field = candidate || "header";
    quote = spaces(row.raw[field]);
    label = quote ? quote.split(/[.!?\n]/u)[0].trim().slice(0, 100) || quote.slice(0, 100) : "Без описания";
  }
  const local: Facet = { key: ids.length ? conceptKey(ids) : "text:" + hash(quote.toLowerCase() || row.key),
    field, label, origin: "local", icon: signs[ids[0]]?.icon ?? "symptom" };
  const domainIds = domains.filter(([, , , re]) => re.test(quote)).map(([id]) => id);
  const contextIds = contexts.filter(([, re]) => re.test(quote.toLowerCase())).map(([id]) => id);
  const recordedService = example && spaces(row.raw.service) === signs[example.service].label ? example : undefined;
  const all = [...new Set([...ids, ...domainIds, ...(recordedService ? [recordedService.service,...recordedService.domains] : []),
    ...(example && symptom ? [symptomIds.get(symptom.label)!] : []), ...(ids.length ? contextIds : []),
    ...(example || symptom || pattern ? effects.filter(([, , , re])=>re.test(quote)).map(([id])=>id) : [])])].sort();
  if (!ids.length && domainIds.length) {
    const topic = domainIds[0];
    Object.assign(local,{key:conceptKey([topic]),label:signs[topic].label,icon:signs[topic].icon});
  }
  if (example && symptom) local.icon = signs[symptomIds.get(symptom.label)!].icon;
  return { ids: all, signature: all.join("+"), local };
}

type PacketProfile = { ref: string; signs: string[]; volume: string; risk: string };
type Choice = Pick<Facet, "key" | "label" | "icon">;
type Plan = Map<string, Choice>;
const instruction = [
  "Ты редактор очереди ИТ-инцидентов. На основе текущих описаний, количества (volume) и риска (risk) выбери число, состав, названия и значки групп.",
  "Возвращай правила. Для каждой группы задай basis — один общий признак из dictionary. Только если нужно СУЗИТЬ группу, задай два признака: сервер возьмёт их ПЕРЕСЕЧЕНИЕ. Номера P перечислять не надо.",
  "Сервер применяет правила по порядку ко всем подходящим профилям. Сначала выдели важные симптомы, затем сгруппируй остальные по сходству жалоб или области обслуживания. Укажи конкретные короткие русские названия, опираясь на meaning, и разрешённые icons из basis. Не добавляй причину или масштаб.",
  "frequentPatterns показывает повторяющиеся сочетания контекста и проявления. Начни с конкретных проявлений, которые дежурный может проверить вместе. Название должно говорить, что именно произошло и где. Однословные темы «Интернет», «Видео», «Звонки» мало помогают; широкие области оставь для remaining, после конкретных групп.",
  "Охвати всю очередь, включая домены невысокого риска. Для оставшихся профилей после основных правил выбери в remaining коды общих признаков, по одному на оставшуюся группу. coverage перечисляет имеющиеся признаки от более распространённых к редким. Если нужен точный исходный термин, сервер подставит meaning. Не перечисляй отдельных заявок как отдельные группы, если они имеют общий симптом или область.",
  'Только JSON {"groups":[{"basis":["код признака"],"title":"Короткое название","icon":"ключ значка"}],"remaining":["код другого признака"]}.',
].join(" ");
const version = "live-clusters-4";
const ordinary = /^(?:и|в|во|на|к|у|с|со|из|по|для|не|без|при|после|или|нет|сбой|сбои|сбоев|сбоях|ошибк\p{L}*|проблем\p{L}*|уда[ёе]тся|работ\p{L}*|связан\p{L}*)$/u;

const relatedIcons: Partial<Record<PlatformIcon, PlatformIcon[]>> = {
  login:["quality","profile"], payment:["history"], network:["relation"], sync:["history"],
  file:["layers"], messages:["queue"], cdn:["network"], database:["layers"], video:["duration"],
  mobile:["system"], phone:["network"], bell:["messages"], cloud:["system"], intake:["file"],
};
const iconsFor = (sign: Sign) => [sign.icon,...(relatedIcons[sign.icon] ?? [])];
function supportedTitle(title: unknown, descriptions: Sign[]): title is string {
  if (typeof title !== "string" || !/[А-ЯЁа-яё]/u.test(title) ||
      !/^[А-ЯЁа-яёA-Za-z0-9][А-ЯЁа-яёA-Za-z0-9 ·,–—-]{2,77}$/u.test(title)) return false;
  const roots = descriptions.flatMap(s => s.roots.split(" ")).map(root => root.replaceAll("ё","е"));
  const words = wordsOf(title);
  if (words.length < 2 && descriptions.some(s => wordsOf(s.label).length > 1)) return false;
  const grounded = (word: string) => roots.some(root => root.length >= Math.min(3,word.length) && word.startsWith(root));
  return words.some(grounded) && words.every(word => ordinary.test(word) || grounded(word)) &&
    !/(?:нет|без) (?:ошиб|сбо|проблем)|ошиб\p{L}* нет|работает исправно/iu.test(title);
}
function parsePlan(raw: unknown, profiles: PacketProfile[]): Plan | undefined {
  const response = raw as {groups?: unknown; remaining?: unknown} | null;
  if (!Array.isArray(response?.groups) || response.groups.length > 128) return;
  const remaining = Array.isArray(response.remaining) ? response.remaining.slice(0,128) : [];
  const groups = [...response.groups,...remaining.map(id => ({basis:[id]}))];
  const byRef = new Map(profiles.map(p => [p.ref, p]));
  const plan: Plan = new Map(), keys = new Set<string>(), labels = new Set<string>();
  const stats = {invalidBasis:0, emptyOrOverlapping:0, rejectedRefs:0, sourceTitles:0, sourceIcons:0};
  for (const g of groups) {
    if (!g || !Array.isArray(g.basis) || !g.basis.length || g.basis.length > 6 ||
        !g.basis.every((s: unknown) => typeof s === "string" && Object.hasOwn(signs,s))) { stats.invalidBasis++; continue; }
    const basis: string[] = [...new Set<string>(g.basis)].sort();
    const descriptions = basis.map(id => signs[id]);
    const key = conceptKey(basis);
    const submitted = supportedTitle(g.title,descriptions);
    const fromEvidence = descriptions.map(s => s.label).join(" · ");
    let label = submitted ? g.title.trim() : fromEvidence;
    if (labels.has(label.toLowerCase())) label = fromEvidence;
    if (keys.has(key) || labels.has(label.toLowerCase())) { stats.emptyOrOverlapping++; continue; }
    const matches = (p: PacketProfile) => !plan.has(p.signs.join("+")) && basis.every(s => p.signs.includes(s));
    const explicit = Array.isArray(g.profiles);
    const candidates: (PacketProfile | undefined)[] = explicit ? g.profiles.slice(0,128).map((ref: string) => byRef.get(ref)) :
      g.profiles === undefined || g.profiles === "all" ? profiles : [];
    const selected = candidates.filter((p): p is PacketProfile => !!p && matches(p));
    if (explicit) stats.rejectedRefs += candidates.length - selected.length;
    if (!selected.length) { stats.emptyOrOverlapping++; continue; }
    const suggestedIcon = descriptions.flatMap(iconsFor).includes(g.icon);
    const icon = suggestedIcon ? g.icon : descriptions[0].icon;
    if (!submitted) stats.sourceTitles++;
    if (!suggestedIcon) stats.sourceIcons++;
    keys.add(key); labels.add(label.toLowerCase());
    for (const p of selected) {
      plan.set(p.signs.join("+"),{key, label, icon});
    }
  }
  console.info(JSON.stringify({event:"triage.cluster_plan",proposed:groups.length,accepted:keys.size,
    profiles:profiles.length,covered:plan.size,...stats}));
  return plan.size ? plan : undefined;
}

type Snapshot = { key: string; packet: PacketProfile[]; local: (row: Incident) => Facet };
const volumeBand = (n: number) => n === 1 ? "1" : n < 5 ? "2–4" : n < 20 ? "5–19" : n < 100 ? "20–99" : "100+";
const boilerplate = /^(?:обращени|пользователь|клиент|инцидент|заявк|провер|проблем|сообщает|указан|ошибк)/u;
function repeatedPhrases(rows: Map<string, Incident>, describe: (row: Incident) => Profile) {
  const choices = new Map<Incident, { key: string; label:string }[]>();
  const counts = new Map<string, number>();
  for (const row of rows.values()) {
    if (!row.groups.length) continue;
    const item = describe(row);
    if (item.signature) continue;
    const words = item.local.label.toLowerCase().match(/[а-яёa-z]+/gu) ?? [];
    const unique = new Map<string,string>();
    for (let i = 1; i < words.length; i++) {
      const pair = words.slice(i-1,i+1);
      if (pair.some(w => w.length < 3 || boilerplate.test(w))) continue;
      unique.set(pair.map(stem).join(" "), pair.join(" "));
    }
    choices.set(row, [...unique].map(([key,label]) => ({key,label})));
    for (const key of unique.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const memberships = new Map<Incident, Facet>();
  for (const [row,pairs] of choices) {
    const phrase = pairs.filter(p => counts.get(p.key)! > 1)
      .sort((a,b) => counts.get(b.key)! - counts.get(a.key)! || a.key.localeCompare(b.key))[0];
    if (phrase) memberships.set(row,{...describe(row).local, key:"phrase:"+phrase.key, label:"«"+phrase.label+"»"});
  }
  return memberships;
}

export class LiveClusters {
  private readonly client?: VseLlm;
  private readonly profiles = new WeakMap<Incident, Profile>();
  private readonly snapshots = new WeakMap<Map<string, Incident>, Snapshot>();
  private readonly cache = new Map<string, { plan?: Plan; retry: number }>();
  private pending = "";
  constructor(client?: VseLlm) { this.client = client; }

  private describe(row: Incident) {
    let item = this.profiles.get(row);
    if (!item) { item = profile(row); this.profiles.set(row, item); }
    return item;
  }
  refining(rows: Map<string, Incident>) { return this.pending === this.snapshots.get(rows)?.key; }
  read(namespace: string, rows: Map<string, Incident>, mayStart: boolean, localOnly = false) {
    let snapshot = this.snapshots.get(rows);
    if (!snapshot) {
      const counts = new Map<string,{count:number; critical:number}>();
      for (const row of rows.values()) {
        if (!row.groups.length) continue;
        const {signature} = this.describe(row);
        if (!signature) continue;
        const group = counts.get(signature) ?? {count:0,critical:0};
        group.count++;
        if (row.groups.includes("critical")) group.critical++;
        counts.set(signature,group);
      }
      const packet = [...counts].sort(([a,n],[b,m]) => m.critical - n.critical || m.count - n.count || a.localeCompare(b)).slice(0, 128)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([id,g],i) => ({ref:"P"+(i+1), signs:id.split("+"), volume:volumeBand(g.count),
          risk:g.critical ? "critical " + volumeBand(g.critical) : "standard"}));
      const phrases = repeatedPhrases(rows,row => this.describe(row));
      snapshot = { key:hash([namespace,packet]), packet, local:row => phrases.get(row) ?? this.describe(row).local };
      this.snapshots.set(rows,snapshot);
    }
    const {key,packet,local} = snapshot;
    if (!this.client || localOnly) return local;
    const cached = this.cache.get(key);
    if (mayStart && packet.length && !this.pending && (!cached || (!cached.plan && cached.retry <= Date.now()))) {
      this.pending = key;
      void this.generate(key,packet).finally(() => { this.pending = ""; });
    }
    if (!cached?.plan) return local;
    const plan = cached.plan;
    const used = new Set([...plan.values()].map(g => g.key));
    return (row: Incident): Facet => {
      const base = local(row), {signature} = this.describe(row);
      const curated = plan.get(signature);
      if (curated) return {...base, ...curated, origin:"model"};
      return used.has(base.key) ? {...base,key:"local:"+base.key} : base;
    };
  }

  private async generate(key: string, profiles: PacketProfile[]) {
    const dictionary = Object.fromEntries([...new Set(profiles.flatMap(p => p.signs))]
      .map(id => [id, {meaning:signs[id].label, icon:signs[id].icon, icons:iconsFor(signs[id])}]));
    const coverage = Object.keys(dictionary).map(id => ({id, profiles:profiles.filter(p=>p.signs.includes(id)).length}))
      .filter(group => group.profiles > 1).sort((a,b) => b.profiles - a.profiles);
    const frequentPatterns = domains.flatMap(([domain]) => effects.map(([effect]) => ({
      basis:[domain,effect], profiles:profiles.filter(p=>p.signs.includes(domain) && p.signs.includes(effect)).length,
    }))).filter(pair => pair.profiles > 1).sort((a,b) => b.profiles-a.profiles).slice(0,24);
    const packet = {profiles, dictionary, coverage, frequentPatterns};
    let plan: Plan | undefined;
    try {
      const reply = await this.client!.json(version, instruction, packet, 22_000, "clusters");
      if ("json" in reply) {
        plan = parsePlan(reply.json, profiles);
        if (!plan) this.client!.rejectJson(version, packet);
      }
    } finally {
      this.cache.set(key, {plan, retry:Date.now() + 15_000});
      if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
