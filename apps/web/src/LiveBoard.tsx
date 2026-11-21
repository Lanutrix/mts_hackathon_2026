import { useEffect, useRef, useState } from "react";
import type { Group, Incident } from "../../../packages/domain/index.ts";

const paths = {
  live: "M2 12h4l3-8 5 16 3-8h5",
  queue: "M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1",
  bell: "M5 15c2-2 2-3 2-6a5 5 0 0 1 10 0c0 3 0 4 2 6l1 2H4l1-2ZM10 20a3 3 0 0 0 4 0",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2",
  quality: "M12 2 3 6v6c0 5 6 9 9 10 3-1 9-5 9-10V6l-9-4Zm-4 10 3 3 5-6",
  expand: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5",
  critical: "M13 2 4 14h7l-1 8 10-13h-8l1-7Z",
  coordinators:
    "M15 20H2v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2ZM12 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm3-3a3.5 3.5 0 0 1 0 7m2 3a5 5 0 0 1 4 5",
  high: "m4 15 7-7 4 4 6-7m-6 0h6v6",
  research: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-2 5 7 7",
  arrow: "M6 18 18 6M6 6h12v12",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2",
  focus:
    "M3 9V5a2 2 0 0 1 2-2h4m6 0h4a2 2 0 0 1 2 2v4m0 6v4a2 2 0 0 1-2 2h-4m-6 0H5a2 2 0 0 1-2-2v-4m12-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Mark() {
  return (
    <svg width="44" height="31" viewBox="0 0 48 34" aria-hidden="true">
      <path d="M2 5h44a22 22 0 0 1-44 0Z" fill="#165843" />
      <path d="M5 5h38a19 19 0 0 1-38 0Z" fill="#d8f48f" />
      <path d="M8 5h32a16 16 0 0 1-32 0Z" fill="#f48aa3" />
      <path
        d="m16 9 2 3m6-2v4m8-5-2 3"
        stroke="#25362b"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export const lanes: Group[] = ["critical", "coordinators", "high", "research"];
export const laneTitle: Record<Group, string> = {
  critical: "Критические",
  coordinators: "У координаторов",
  high: "Высокие",
  research: "Исследование",
};
const descriptions: Record<Group, string> = {
  critical: "Наивысший приоритет",
  coordinators: "Назначены дежурной группе",
  high: "Высокий приоритет",
  research: "Уточнение причин",
};
const inclusion: Record<Group, string> = {
  critical: "Активен · приоритет 4",
  coordinators: "Назначен координаторам",
  high: "Активен · приоритет 3",
  research: "В статусе исследования",
};
type Bucket = {
  count: number;
  items: Incident[];
  offset: number;
  unverified: number;
};
type LiveData = {
  unique: number;
  total: number;
  groups: Record<Group, Bucket>;
  revision: number;
};
const number = (n: number) => n.toLocaleString("ru-RU");
const plural = new Intl.PluralRules("ru");
export function incidentCount(value: number) {
  const form = plural.select(value);
  return (
    number(value) +
    " " +
    (form === "one"
      ? "уникальный инцидент"
      : form === "few"
        ? "уникальных инцидента"
        : "уникальных инцидентов")
  );
}
export function LiveIntro({
  data,
  now,
  zone,
  ns,
  online,
}: {
  data: LiveData;
  now: number;
  zone: string;
  ns: string;
  online: boolean;
}) {
  const ratio = data.total ? Math.min(1, data.unique / data.total) : 0;
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  return (
    <>
      <div className="live-intro">
        <section className="shift-poster" aria-labelledby="live-heading">
          <img
            src="/watermelon-slice.webp"
            alt=""
            fetchPriority="high"
            width="1200"
            height="600"
          />
          <div className="poster-copy">
            <span className={"live-label" + (online ? " connected" : "")}>
              <i />
              {online ? "На связи" : "Мониторинг"}
            </span>
            <h1 id="live-heading">Эфир смены</h1>
            <p className="shift-date">{date}</p>
            <small>
              {ns === "demo"
                ? "Демо-данные"
                : ns === "original"
                  ? "Оригинал"
                  : "Рабочая копия"}
              <b>/</b>
              {zone === "UTC" ? "UTC" : "МСК"}
            </small>
          </div>
        </section>
        <section className="attention-stat" aria-label="В поле внимания">
          <div>
            <h2>В поле внимания</h2>
            <Icon name="focus" size={24} />
          </div>
          <strong>{number(data.unique)}</strong>
          <p>
            из {number(data.total)}{" "}
            {plural.select(data.total) === "one" ? "записи" : "записей"}{" "}
            источника
          </p>
          <div className="attention-meter" aria-hidden="true">
            {Array.from({ length: 32 }, (_, i) => (
              <i key={i} className={i < Math.round(ratio * 32) ? "on" : ""} />
            ))}
          </div>
        </section>
      </div>
      <nav className="lane-tiles" aria-label="Перейти к группе">
        {lanes.map((g) => (
          <a key={g} className={"tone-" + g} href={"#group-" + g}>
            <div>
              <span className="tile-icon">
                <Icon name={g} size={18} />
              </span>
              <span>{laneTitle[g]}</span>
              <span className="tile-link">
                <Icon name="arrow" size={14} />
              </span>
            </div>
            <strong>{number(data.groups[g].count)}</strong>
            <small>{descriptions[g]}</small>
          </a>
        ))}
      </nav>
    </>
  );
}
function duration(ms: number) {
  const seconds = Math.floor(Math.abs(ms) / 1000),
    minutes = Math.floor(seconds / 60),
    hours = Math.floor(minutes / 60);
  if (hours >= 24) return Math.floor(hours / 24) + "д " + (hours % 24) + "ч";
  if (hours) return hours + "ч " + String(minutes % 60).padStart(2, "0") + "м";
  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
function Ticket({
  item: i,
  g,
  now,
  zone,
  open,
  fresh,
}: {
  item: Incident;
  g: Group;
  now: number;
  zone: string;
  open: (id: string) => void;
  fresh: boolean;
}) {
  const deadline = i.dates.deadline;
  const delta = deadline ? Date.parse(deadline) - now : null;
  const label =
    delta === null
      ? "Срок не задан"
      : delta < 0
        ? "Просрочен"
        : delta <= 900000
          ? "Срок близко"
          : "До срока";
  const service =
    typeof i.raw.serviceType === "string" ? i.raw.serviceType : "";
  return (
    <article
      className={
        "incident ops-ticket" +
        (fresh ? " fresh" : "") +
        (!i.sourcePresent ? " unverified" : "")
      }
      data-testid={"card-" + i.id}
    >
      <div className="ticket-top">
        <span>{i.id}</span>
        <span className="ticket-state">{i.stateLabel}</span>
      </div>
      {i.raw.productName ? (
        <p className="ticket-product">{String(i.raw.productName)}</p>
      ) : null}
      <h3>
        <button onClick={() => open(i.id)}>
          {String(i.raw.header || "Без заголовка")}
        </button>
      </h3>
      {service && <p className="ticket-service">{service}</p>}
      <div className="ticket-reason">
        <i />
        {inclusion[g]}
      </div>
      {i.raw.isNeedUp === true && (
        <span className="ticket-alert">Требует эскалации</span>
      )}
      {!i.sourcePresent && (
        <strong className="warning">Нет в снимке · требуется сверка</strong>
      )}
      <div
        className={
          "ticket-clock" + (delta !== null && delta <= 900000 ? " urgent" : "")
        }
        title={
          deadline
            ? new Intl.DateTimeFormat("ru-RU", {
                timeZone: zone,
                dateStyle: "short",
                timeStyle: "short",
              }).format(Date.parse(deadline)) +
              " " +
              zone
            : undefined
        }
      >
        <Icon name="clock" size={15} />
        <span>{label}</span>
        {delta !== null && <strong>{duration(delta)}</strong>}
      </div>
    </article>
  );
}
export function IncidentLane({
  g,
  bucket,
  now,
  zone,
  open,
  page,
  scope,
  revision,
}: {
  g: Group;
  bucket: Bucket;
  now: number;
  zone: string;
  open: (id: string) => void;
  page: (offset: number) => void;
  scope: string;
  revision: number;
}) {
  const [expanded, setExpanded] = useState(false),
    [fresh, setFresh] = useState<string[]>([]);
  const prev = useRef<{ revision: number; ids: Set<string> } | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    prev.current = null;
    setExpanded(false);
    setFresh([]);
    clearTimeout(timer.current);
    return () => clearTimeout(timer.current);
  }, [scope]);
  useEffect(() => {
    const previous = prev.current;
    const ids = new Set(bucket.items.map((i) => i.key));
    if (previous && previous.revision < revision) {
      const added = [...ids].filter((id) => !previous.ids.has(id));
      if (added.length) {
        clearTimeout(timer.current);
        setFresh(added);
        timer.current = setTimeout(() => setFresh([]), 6500);
      }
    }
    prev.current = { revision, ids };
  }, [bucket.items, scope, revision]);
  const ordered = fresh.length
    ? [...bucket.items].sort(
        (a, b) => Number(fresh.includes(b.key)) - Number(fresh.includes(a.key)),
      )
    : bucket.items;
  return (
    <section
      className={"lane tone-" + g}
      id={"group-" + g}
      aria-labelledby={"heading-" + g}
      data-testid={"group-" + g}
    >
      <h3 id={"heading-" + g}>
        {laneTitle[g]} <span data-testid={"count-" + g}>{bucket.count}</span>
      </h3>
      {bucket.unverified > 0 && (
        <p className="warning">
          Из них {bucket.unverified} требуют сверки с источником
        </p>
      )}
      <div className="cards">
        {ordered.length ? (
          (expanded ? ordered : ordered.slice(0, 4)).map((i) => (
            <Ticket
              key={i.key}
              item={i}
              g={g}
              now={now}
              zone={zone}
              open={open}
              fresh={fresh.includes(i.key)}
            />
          ))
        ) : (
          <div className="empty">
            <strong>Инцидентов нет</strong>
            <p>Новые записи появятся автоматически.</p>
          </div>
        )}
      </div>
      {ordered.length > 4 && (
        <button
          className="lane-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Свернуть" : "Показать ещё " + (ordered.length - 4)}
        </button>
      )}
      {bucket.count > 30 && (
        <div className="pagination">
          <button
            disabled={!bucket.offset}
            onClick={() => page(Math.max(0, bucket.offset - 30))}
          >
            Назад
          </button>
          <span>
            {bucket.offset + 1}–{Math.min(bucket.offset + 30, bucket.count)}
          </span>
          <button
            disabled={bucket.offset + 30 >= bucket.count}
            onClick={() => page(bucket.offset + 30)}
          >
            Далее
          </button>
        </div>
      )}
    </section>
  );
}
