import { useState, type CSSProperties } from "react";
import {
  answerElement as el,
  type AnswerPresentation,
} from "../../../packages/contracts/answerCatalog";
import type {
  CanvasGroup,
  CanvasResult,
  CanvasWeight,
} from "../../../packages/contracts/canvas";
import { formatCount as count, PageControls, useBox } from "./CanvasControls";
import { screenLink } from "./routes";

export type DataFigureProps = {
  result: CanvasResult;
  choose: (g: CanvasGroup | null) => void;
};
const inks = [
  "var(--wm-pink)",
  "var(--wm-violet)",
  "var(--wm-green)",
  "var(--cx-blue)",
  "var(--cx-orchid)",
  "var(--cx-teal)",
];
export function hue(n: number) {
  return { "--tone": inks[n % inks.length] } as CSSProperties;
}
export function percent(n: number, base: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(base ? n / base : 0);
}
const weights: Record<CanvasWeight, string> = {
  count: "Заявки",
  overdue: "Просроченные",
  escalated: "Устранение последствий",
};
export function GroupDirectory({
  groups,
  total,
  choose,
}: Pick<GroupMarks, "groups" | "choose"> & { total: number }) {
  return (
    <ul className="fact-directory" aria-label="Перечень значений">
      {groups.map((g) => (
        <li key={g.key}>
          <button type="button" onClick={() => choose(g)} title={g.label}>
            <strong>{g.label}</strong>
            <span>
              Заявок: {count(g.count)} · {percent(g.count, total)} ↗
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
function Ranking({ groups, choose, start, weight, all }: GroupMarks) {
  const ceiling = Math.max(1, ...all.map((g) => g[weight]));
  const total = all.reduce((sum, g) => sum + g[weight], 0);
  return (
    <div {...el("ranking")} className="ar-ranking">
      <div className="ar-axis-key">
        <span {...el("rank-key")}>{weights[weight]}</span>
        <span {...el("rank-axis")}>0 — {count(ceiling)}</span>
      </div>
      {groups.map((g, i) => (
        <button
          className="ar-rank"
          key={g.key}
          style={hue(start + i)}
          onClick={() => choose(g)}
        >
          <span {...el("rank-position")} className="ar-rank-index">
            {String(start + i + 1).padStart(2, "0")}
          </span>
          <strong>{g.label}</strong>
          <b {...el("rank-size")}>{count(g[weight])}</b>
          <span {...el("lollipop")} className="ar-lollipop" aria-hidden="true">
            <i style={{ width: (100 * g[weight]) / ceiling + "%" }}>
              <i {...el("rank-end")} />
            </i>
          </span>
          <small {...el("rank-share")}>{percent(g[weight], total)}</small>
        </button>
      ))}
    </div>
  );
}
type GroupMarks = {
  all: CanvasGroup[];
  groups: CanvasGroup[];
  start: number;
  choose: DataFigureProps["choose"];
  weight: CanvasWeight;
};
// Two circular arcs also describe a group occupying the whole ring.
function sectorStroke(start: number, end: number) {
  const point = (percent: number) => {
    const radians = (percent * Math.PI) / 50 - Math.PI / 2;
    return 100 + 77 * Math.cos(radians) + " " + (100 + 77 * Math.sin(radians));
  };
  return (
    "M" +
    point(start) +
    " A77 77 0 0 1 " +
    point((start + end) / 2) +
    " A77 77 0 0 1 " +
    point(end)
  );
}
export function Orbit({ all, groups, start, weight, choose }: GroupMarks) {
  const total = all.reduce((a, g) => a + g[weight], 0);
  const here = groups.reduce((a, g) => a + g[weight], 0);
  let cursor = total
    ? (100 * all.slice(0, start).reduce((sum, g) => sum + g[weight], 0)) / total
    : 0;
  return (
    <div {...el("share-wheel")} className="ar-orbit">
      <div className="ar-dial">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle
            cx="100"
            cy="100"
            r="77"
            fill="none"
            stroke="var(--cx-line)"
            strokeWidth="21"
            {...(here < total ? el("other-arc") : {})}
          />
          {groups.map((g, i) => {
            const part = total ? (g[weight] / total) * 100 : 0,
              offset = cursor;
            cursor += part;
            return (
              part > 0 && (
                <path
                  {...el("share-arc")}
                  key={g.key}
                  d={sectorStroke(offset, offset + part)}
                  fill="none"
                  stroke="var(--tone)"
                  style={hue(start + i)}
                  strokeWidth="21"
                  onClick={() => choose(g)}
                >
                  <title>{g.label + " · " + percent(g[weight], total)}</title>
                </path>
              )
            );
          })}
          <circle
            cx="100"
            cy="100"
            r="90.8"
            fill="none"
            stroke="var(--cx-line)"
            strokeWidth=".7"
            strokeDasharray=".6 5.1"
          />
        </svg>
        <div {...el("wheel-total")}>
          <b>{count(total)}</b>
          <span>{weights[weight]}</span>
        </div>
      </div>
      <div {...el("share-key")} className="ar-share-key">
        {groups.map((g, i) => (
          <button key={g.key} onClick={() => choose(g)} style={hue(start + i)}>
            <i aria-hidden="true" {...el("share-swatch")} />
            <span>{g.label}</span>
            <strong {...el("share-value")}>{percent(g[weight], total)}</strong>
            <small {...el("share-count")}>{count(g[weight])}</small>
          </button>
        ))}
        {here < total && (
          <small className="ar-other">
            Остальные группы · {percent(total - here, total)}
          </small>
        )}
      </div>
    </div>
  );
}
export function Branches({ all, groups, start, choose, weight }: GroupMarks) {
  const total = all.reduce((a, g) => a + g[weight], 0),
    peak = Math.max(1, ...all.map((g) => g[weight]));
  const rows = Math.max(1, groups.length),
    height = rows * 58;
  return (
    <div
      {...el("branch-map")}
      className="ar-branches"
      style={{ "--branch-rows": rows } as CSSProperties}
    >
      <div {...el("root-node")} className="ar-root">
        <span {...el("flow-key")}>{weights[weight]}</span>
        <b>{count(total)}</b>
      </div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {groups.map((g, i) => {
          const end = (i + 0.5) * 58;
          return (
            <path
              {...el("branch-link")}
              key={g.key}
              d={`M0 ${height / 2} C48 ${height / 2},45 ${end},100 ${end}`}
              fill="none"
              stroke="var(--tone)"
              strokeWidth={g[weight] ? 2 + (10 * g[weight]) / peak : 1}
              strokeDasharray={g[weight] ? undefined : "3 4"}
              style={hue(start + i)}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="ar-leaves">
        {groups.map((g, i) => (
          <button
            {...el("leaf-node")}
            key={g.key}
            style={hue(start + i)}
            onClick={() => choose(g)}
            title={g.label}
          >
            <i {...el("terminal-port")} aria-hidden="true" />
            <span>{g.label}</span>
            <strong {...el("branch-count")}>{count(g[weight])}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
function HeatGrid({ all, groups, choose }: GroupMarks) {
  const keys = ["count", "overdue", "escalated"] as const;
  const max = Math.max(1, ...all.map((g) => g.count));
  return (
    <div className="ar-grid-wrap">
      <table {...el("risk-grid")} className="ar-grid">
        <thead>
          <tr>
            <th scope="col" {...el("group-axis")}>
              Группа
            </th>
            {["Всего", "Просрочено", "Последствия"].map((s) => (
              <th scope="col" key={s} {...el("column-key")}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <th scope="row">
                <button onClick={() => choose(g)}>{g.label}</button>
              </th>
              {keys.map((k, i) => (
                <td key={k}>
                  <span
                    {...el("heat-cell")}
                    style={
                      {
                        ...hue([1, 0, 2][i]),
                        "--value": (g[k] / max) * 85 + "%",
                      } as CSSProperties
                    }
                  >
                    {g[k] === 0 ? (
                      <span {...el("no-value")}>0</span>
                    ) : (
                      count(g[k])
                    )}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div {...el("heat-legend")} className="ar-heat-key">
        <span>0</span>
        <i {...el("severity-scale")} />
        <span>{count(max)}</span>
      </div>
    </div>
  );
}
export function Dossiers({ groups, start, choose }: GroupMarks) {
  return (
    <div className="ar-dossiers">
      {groups.map((g, i) => (
        <button
          {...el("dossier")}
          style={hue(start + i)}
          key={g.key}
          onClick={() => choose(g)}
        >
          <strong {...el("dossier-name")}>{g.label}</strong>
          <span {...el("inspect-mark")} aria-hidden="true">
            ↗
          </span>
          <b {...el("volume-figure")}>{count(g.count)}</b>
          <span {...el("multimeter")} className="ar-multi">
            {(["overdue", "escalated"] as const).map((key, j) => (
              <span key={key} {...el(j ? "escalation-track" : "overdue-track")}>
                <span>
                  <small>{j ? "Устранение последствий" : "Просрочено"}</small>
                  <b>{count(g[key])}</b>
                </span>
                <i>
                  <i
                    style={{
                      width: (g.count ? (100 * g[key]) / g.count : 0) + "%",
                    }}
                  />
                </i>
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
export function DataChart({
  result,
  choose,
  kind,
}: { kind: AnswerPresentation } & DataFigureProps) {
  const { ref, height, width } = useBox();
  const [requested, setPage] = useState(0);
  const isCard = kind === "cards",
    verticalOrbit = kind === "orbit" && width < 520;
  const perPage = isCard
    ? Math.max(
        1,
        Math.min(6, Math.floor(width / 195) || 1) *
          Math.max(1, Math.min(2, Math.floor((height - 38) / 165))),
      )
    : Math.max(
        1,
        Math.min(
          kind === "flow" ? 6 : 9,
          Math.floor(
            (height - (verticalOrbit ? 150 : 60)) /
              (kind === "matrix"
                ? 46
                : kind === "bars"
                  ? 57
                  : kind === "flow"
                    ? 58
                    : 42),
          ),
        ),
      );
  const pages = Math.ceil(result.groups.length / perPage),
    page = Math.max(0, Math.min(requested, pages - 1));
  const start = page * perPage,
    groups = result.groups.slice(start, start + perPage);
  const marks = {
    all: result.groups,
    groups,
    start,
    choose,
    weight: result.intent.weightBy ?? ("count" as CanvasWeight),
  };
  return (
    <div
      className="ar-chart"
      ref={ref}
      data-testid={"answer-" + kind}
      data-compact={height < 225}
      data-page={page}
    >
      <div className="ar-chart-inner" key={page}>
        {kind === "bars" ? (
          <Ranking {...marks} />
        ) : kind === "orbit" ? (
          <Orbit {...marks} />
        ) : kind === "flow" ? (
          <Branches {...marks} />
        ) : kind === "matrix" ? (
          <HeatGrid {...marks} />
        ) : (
          <Dossiers {...marks} />
        )}
      </div>
      <PageControls
        page={page}
        pages={pages}
        goto={setPage}
        label="Страницы графика"
      />
    </div>
  );
}
export function Spotlight({
  result,
  open,
  ns,
  zone,
}: {
  result: CanvasResult;
  open: (id: string) => void;
  ns: string;
  zone: string;
}) {
  const { ref, height } = useBox();
  const [requested, setPage] = useState(0);
  const page = Math.max(0, Math.min(requested, result.tickets.length - 1)),
    t = result.tickets[page];
  if (!t) return null;
  const date = t.deadline
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(t.deadline))
    : "Без срока";
  const facts = [
    ["product-fact", "Продукт", t.product],
    ["owner-fact", "Команда", t.team],
    ["priority-fact", "Приоритет", t.priority],
    ["state-fact", "Статус", t.state],
    ["due-fact", "Срок", date],
  ] as const;
  return (
    <article
      {...el("ticket-spotlight")}
      ref={ref}
      className="ar-spot"
      data-compact={height < 250}
      data-testid="answer-spotlight"
    >
      <small {...el("ticket-identity")}>{t.id}</small>
      <h3 {...el("detail-title")}>{t.header || "Без темы"}</h3>
      <dl>
        {facts.map(([id, label, value]) => (
          <div {...el(id)} key={id}>
            <dt>{label}</dt>
            <dd>{value || "Не указан"}</dd>
          </div>
        ))}
      </dl>
      {t.escalated && (
        <strong {...el("escalation-flag")} className="ar-flag">
          Требуется устранение последствий
        </strong>
      )}
      <a
        {...el("ticket-deeplink")}
        href={screenLink("/incident/" + encodeURIComponent(t.id), ns)}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            open(t.id);
          }
        }}
      >
        Открыть карточку ↗
      </a>
      <PageControls
        page={page}
        pages={result.tickets.length}
        goto={setPage}
        label="Предпросмотр заявок"
      />
    </article>
  );
}
