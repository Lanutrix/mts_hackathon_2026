import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Incident } from "../../../packages/domain/index";
import type { Triage } from "../../../packages/domain/triage";
import type { Dashboard } from "./liveFeed";
import { ShiftClock, ShiftMetrics } from "./LiveIndicators";
import { useLivePrefix } from "./useLivePrefix";
import { Mark } from "./Brand";
import "./wallboard.css";

type WallData = Dashboard & {
  triage: Triage;
  acceptedAt?: string;
  status?: { state: string };
};
type Props = { data: WallData; now: number; zone: string; online: boolean };
type Batch = {
  namespace: string;
  revision: number;
  start: number;
  size: number;
  total: number;
  rows: Incident[];
};
const dwell = 18_000;

export default function Wallboard({ data, now, zone, online }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState(1);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const fit = () => {
      const height = parseFloat(getComputedStyle(el).gridAutoRows);
      if (height > 0)
        setSize(Math.max(1, Math.floor((el.clientHeight + 0.1) / height)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, []);

  const total = data.unique;
  const pages = Math.max(1, Math.ceil(total / size));
  const [page, setPage] = useState(0);
  const start = Math.min(page, pages - 1) * size;
  const end = Math.min(start + size, total);
  const prefix = useLivePrefix(
    data,
    "all",
    "deadline",
    "",
    Math.min(end + size, total),
  );
  const [batch, setBatch] = useState<Batch | null>(null);
  useEffect(() => {
    if (prefix.records.length < end) return;
    setBatch((old) => {
      if (
        old &&
        old.namespace === data.namespace &&
        old.start === start &&
        old.size === size &&
        (pages > 1 || (old.total === total && old.revision === data.revision))
      )
        return old;
      return {
        namespace: data.namespace,
        revision: data.revision,
        start,
        size,
        total,
        rows: prefix.records.slice(start, end),
      };
    });
  }, [
    data.namespace,
    data.revision,
    prefix.records,
    start,
    size,
    total,
    pages,
    end,
  ]);
  // Start the reading interval only after the requested batch is on screen.
  // Keep the previous batch visible when a later API page is still loading.
  const pageCount = useRef(pages);
  pageCount.current = pages;
  const rotates = pages > 1;
  useEffect(() => {
    if (
      !rotates ||
      !batch ||
      batch.start !== start ||
      batch.size !== size ||
      batch.namespace !== data.namespace
    )
      return;
    const timer = window.setTimeout(
      () =>
        setPage(
          (current) =>
            (Math.min(current, pageCount.current - 1) + 1) % pageCount.current,
        ),
      dwell,
    );
    return () => window.clearTimeout(timer);
  }, [rotates, batch, start, size, data.namespace]);
  const retry = useRef(prefix.retry);
  retry.current = prefix.retry;
  useEffect(() => {
    if (!prefix.error) return;
    const id = window.setTimeout(() => retry.current(), 5000);
    return () => clearTimeout(id);
  }, [prefix.error]);
  const current = batch?.namespace === data.namespace ? batch : null;
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    [zone],
  );
  const status =
    data.status?.state === "error"
      ? "Ошибка источника"
      : !online
        ? "Нет связи"
        : data.status?.state === "waiting"
          ? "Ожидание данных"
          : "На связи";
  return (
    <main id="main" className="observe-board" data-testid="wallboard">
      <header className="observe-header">
        <div className="observe-brand">
          <Mark />
          <span>Срез</span>
        </div>
        <div className="observe-source">
          <span>
            {data.acceptedAt
              ? "Снимок " + dateFormat.format(new Date(data.acceptedAt))
              : "Ожидание снимка"}
          </span>
          <span className="observe-status" data-ok={status === "На связи"}>
            {status}
          </span>
        </div>
      </header>
      <section className="observe-overview" aria-label="Сводка смены">
        <div className="observe-title">
          <h1>Экран наблюдения</h1>
          <ShiftClock now={now} zone={zone} />
        </div>
        <ShiftMetrics triage={data.triage} />
      </section>
      <section className="observe-register" aria-labelledby="observe-tickets">
        <div className="observe-caption">
          <h2 id="observe-tickets">Активные заявки</h2>
          <span className="observe-batch">
            {current?.rows.length
              ? current.start +
                1 +
                "–" +
                (current.start + current.rows.length) +
                " из " +
                current.total
              : "По сроку"}
            <small>
              {prefix.error
                ? "Обновление задерживается"
                : pages > 1
                  ? "Смена каждые 18 с"
                  : "Все заявки на экране"}
            </small>
          </span>
        </div>
        <div className="observe-columns" aria-hidden="true">
          <span>Заявка</span>
          <span>Статус</span>
          <span>Срок</span>
        </div>
        <ul ref={list} className="observe-list" aria-label="Заявки по сроку">
          {current?.rows.map((item) => {
            const deadline = item.dates.deadline
              ? Date.parse(item.dates.deadline)
              : NaN;
            const due = Number.isFinite(deadline) && deadline < now;
            return (
              <li key={item.key} data-testid="wall-ticket">
                <div className="observe-subject">
                  <small>
                    {item.id}
                    {!item.sourcePresent && " · Требуется сверка"}
                  </small>
                  <strong>{String(item.raw.header || "Без заголовка")}</strong>
                </div>
                <div className="observe-state">{item.stateLabel}</div>
                <div className="observe-due" data-overdue={due}>
                  {Number.isFinite(deadline) ? (
                    <>
                      <strong>{dateFormat.format(deadline)}</strong>
                      <small>
                        {due
                          ? "Просрочен"
                          : deadline - now <= 900000
                            ? "В течение 15 мин"
                            : "Плановый срок"}
                      </small>
                    </>
                  ) : (
                    <span>Не задан</span>
                  )}
                </div>
              </li>
            );
          })}
          {!current?.rows.length && (
            <li className="observe-empty">
              {total
                ? "Загружаем заявки…"
                : "В выбранных очередях нет активных заявок."}
            </li>
          )}
        </ul>
      </section>
      <footer className="observe-footer">
        мы не несем ответственность за провал инцидентов, только смертельную
      </footer>
    </main>
  );
}
