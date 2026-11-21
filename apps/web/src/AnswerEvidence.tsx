import { useState } from "react";
import {
  answerCatalog,
  answerElement as el,
  type AnswerExhibitId,
} from "../../../packages/contracts/answerCatalog";
import type {
  CanvasGroup,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import { PageControls, useBox, formatCount as count } from "./CanvasControls";
import { percent, type DataFigureProps } from "./AnswerCharts";

export interface Evidence {
  value: string;
  caption?: string;
  group?: CanvasGroup;
  ratio?: number;
}
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function evidenceFor(
  id: AnswerExhibitId,
  r: CanvasResult,
): Evidence | null {
  const groups = r.groups,
    metric = (key: string) => r.metrics.find((m) => m.key === key)?.value ?? 0;
  const n = r.total,
    overdue = metric("overdue"),
    escalated = metric("escalated"),
    soon = metric("soon");
  const val = (x: number): Evidence => ({
    value: x.toLocaleString("ru-RU", { maximumFractionDigits: 1 }),
  });
  const ratio = (a: number, b: number): Evidence => ({
    value: percent(a, b),
    caption: count(a) + " из " + count(b),
    ratio: b ? a / b : 0,
  });
  switch (id) {
    case "overdue-metric":
      return val(overdue);
    case "soon-metric":
      return val(soon);
    case "escalation-metric":
      return val(escalated);
    case "on-time":
      return val(n - overdue);
    case "overdue-rate":
      return ratio(overdue, n);
    case "escalation-rate":
      return ratio(escalated, n);
    case "soon-rate":
      return ratio(soon, n);
    case "scope-share":
      return ratio(n, r.sourceTotal);
  }
  if (!groups.length) return null;
  const ranked = [...groups].sort((a, b) => b.count - a.count),
    first = ranked[0],
    second = ranked[1];
  const linked = (g: CanvasGroup, value: string): Evidence => ({
    value,
    caption: g.label,
    group: g,
  });
  switch (id) {
    case "first-group":
      return linked(first, count(first.count));
    case "group-count":
      return val(groups.length);
    case "concentration":
      return { ...ratio(first.count, n), caption: first.label, group: first };
    case "load-range":
      return { value: count(ranked.at(-1)!.count) + "–" + count(first.count) };
    case "median-load":
      return val(median(groups.map((g) => g.count)));
    case "median-overdue":
      return val(median(groups.map((g) => g.overdue)));
    case "mean-load":
      return val(n / groups.length);
    case "top-two":
      return ratio(first.count + (second?.count ?? 0), n);
    case "pareto": {
      let sum = 0,
        needed = 0;
      while (needed < ranked.length && sum < n * 0.8)
        sum += ranked[needed++].count;
      return {
        value: count(needed),
        caption: count(sum) + " из " + count(n) + " заявок",
        ratio: sum / n,
      };
    }
    case "leader-gap":
      return second
        ? {
            value: count(first.count - second.count),
            caption: first.label + " / " + second.label,
          }
        : null;
    case "tied-leaders":
      return {
        value: count(groups.filter((g) => g.count === first.count).length),
        caption: "По " + count(first.count) + " заявок",
      };
    case "singletons":
      return val(groups.filter((g) => g.count === 1).length);
    case "clean-groups":
      return val(groups.filter((g) => !g.overdue && !g.escalated).length);
    case "groups-overdue":
      return val(groups.filter((g) => g.overdue > 0).length);
    case "groups-escalated":
      return val(groups.filter((g) => g.escalated > 0).length);
    case "highest-late-rate": {
      const g = groups.reduce((a, b) =>
        a.overdue / a.count >= b.overdue / b.count ? a : b,
      );
      return g.overdue ? linked(g, percent(g.overdue, g.count)) : val(0);
    }
    case "late-leader":
    case "escalation-leader": {
      const key = id === "late-leader" ? "overdue" : "escalated";
      const g = groups.reduce((a, b) => (a[key] >= b[key] ? a : b));
      return g[key] ? linked(g, count(g[key])) : val(0);
    }
  }
}
const labels = { ...answerCatalog.exhibits, ...answerCatalog.brief };
export function Exhibit({
  id,
  result,
  choose,
}: { id: AnswerExhibitId } & DataFigureProps) {
  const data = evidenceFor(id, result);
  const content = (
    <>
      <span className="ar-fact-name">{labels[id]}</span>
      <strong className="ar-fact-value">{data?.value ?? "—"}</strong>
      {data?.ratio !== undefined && (
        <span {...el("ratio-gauge")} className="ar-gauge" aria-hidden="true">
          <i style={{ width: 100 * data.ratio + "%" }} />
        </span>
      )}
      {data?.caption && (
        <small>
          {data.caption}
          {data.group && " ↗"}
        </small>
      )}
      {!data && <small>Нужна группировка</small>}
    </>
  );
  return data?.group ? (
    <button
      type="button"
      className="ar-fact"
      {...el(id)}
      onClick={() => choose(data.group!)}
    >
      {content}
    </button>
  ) : (
    <div className="ar-fact" {...el(id)}>
      {content}
    </div>
  );
}
export function ExhibitTray({
  result,
  choose,
  ids,
}: { ids: AnswerExhibitId[] } & DataFigureProps) {
  const { ref, width } = useBox(),
    [requested, setPage] = useState(0),
    size = width >= 700 ? 3 : width >= 430 ? 2 : 1;
  const pages = Math.ceil(ids.length / size),
    page = Math.max(0, Math.min(requested, pages - 1));
  return (
    <div ref={ref} className="ar-exhibits">
      <div className="ar-exhibit-row">
        {ids.slice(page * size, (page + 1) * size).map((id) => (
          <Exhibit {...{ id, result, choose }} key={id} />
        ))}
      </div>
      <PageControls
        page={page}
        pages={pages}
        goto={setPage}
        label="Показатели ответа"
      />
    </div>
  );
}
export function Briefing({
  result,
  choose,
  ids,
}: { ids?: AnswerExhibitId[] } & DataFigureProps) {
  const { ref, width, height } = useBox(),
    [requested, setPage] = useState(0);
  const exhibits = ids?.length
    ? ids
    : result.groups.length
      ? ([
          "concentration",
          "overdue-rate",
          "soon-metric",
          "median-load",
        ] as const)
      : (["overdue-rate", "escalation-rate", "soon-metric"] as const);
  const size = Math.max(1, Math.min(4, Math.floor(width / 180) || 1)),
    pages = Math.ceil(exhibits.length / size),
    p = Math.min(requested, pages - 1);
  const highest = [...result.groups].sort((a, b) => b.count - a.count)[0],
    peak = highest?.count ?? 0;
  const bins = Array.from({ length: Math.min(8, peak) }, (_, i) => ({
    from: Math.floor((i * peak) / Math.min(8, peak)) + 1,
    to: Math.floor(((i + 1) * peak) / Math.min(8, peak)),
    value: 0,
  }));
  for (const g of result.groups) {
    const bin = bins.find((b) => g.count >= b.from && g.count <= b.to);
    if (bin) bin.value++;
  }
  const heaviest = Math.max(1, ...bins.map((b) => b.value));
  return (
    <article
      ref={ref}
      {...el("briefing")}
      data-testid="answer-brief"
      className="ar-brief"
      data-short={height < 265}
    >
      <div className="ar-brief-main">
        <div>
          <div className="ar-brief-number" {...el("brief-headline")}>
            {count(result.total)}
          </div>
          <p {...el("finding")}>
            {highest
              ? "Больше всего заявок в группе «" + highest.label + "»"
              : "Заявок в выборке"}
          </p>
        </div>
        {bins.length > 0 && height > 255 && width > 440 && (
          <figure {...el("distribution")} className="ar-hist">
            <svg
              viewBox="0 0 200 80"
              role="img"
              aria-label="Распределение групп по количеству заявок"
            >
              {bins.map((b, i) => (
                <rect
                  {...el("bin")}
                  key={i}
                  x={(i * 200) / bins.length}
                  y={78 - (b.value / heaviest) * 70}
                  width={200 / bins.length - 3}
                  height={(b.value / heaviest) * 70}
                  fill="currentColor"
                >
                  <title>
                    {b.from}–{b.to} заявок · {b.value} групп
                  </title>
                </rect>
              ))}
            </svg>
            <figcaption>Размер групп, от 1 до {peak} заявок</figcaption>
          </figure>
        )}
      </div>
      <div className="ar-brief-facts">
        {exhibits.slice(p * size, (p + 1) * size).map((id) => (
          <Exhibit key={id} {...{ id, result, choose }} />
        ))}
      </div>
      <PageControls
        page={p}
        pages={pages}
        goto={setPage}
        label="Факты выборки"
      />
    </article>
  );
}
