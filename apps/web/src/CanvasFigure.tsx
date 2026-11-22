import { useId, useMemo, useState, type CSSProperties } from "react";
import type {
  CanvasGroup,
  CanvasResult,
  CanvasWeight,
} from "../../../packages/contracts/canvas";
import { answerElement as el } from "../../../packages/contracts/answerCatalog";
import { DataChart, GroupDirectory, Spotlight, percent } from "./AnswerCharts";
import { Briefing, ExhibitTray } from "./AnswerEvidence";
import { formatCount, PageControls, useBox } from "./CanvasControls";
import { CanvasTicketLink } from "./CanvasTickets";

const tones = [
  "var(--wm-pink)",
  "var(--wm-violet)",
  "var(--wm-green)",
  "var(--cx-blue)",
  "var(--cx-orchid)",
  "var(--cx-teal)",
];
const weights: Record<CanvasWeight, string> = {
  count: "все заявки",
  overdue: "просроченные",
  escalated: "устранение последствий",
};
const paint = (index: number) =>
  ({ "--tone": tones[index % tones.length] }) as CSSProperties;
type FigureProps = {
  result: CanvasResult;
  choose: (group: CanvasGroup | null) => void;
  ns: string;
  open: (id: string) => void;
  zone: string;
};
type Square = {
  x: number;
  y: number;
  side: number;
  width: number;
  caption: number;
};

// Try the row breaks permitted by the viewport. Each mark's area is linear in the
// selected field. Labels reserve their own space even for very small or zero values.
function packSquares(
  groups: CanvasGroup[],
  weight: CanvasWeight,
  width: number,
  height: number,
  maximum: number,
  ceiling = 326,
): Square[] {
  if (!width || !height || !groups.length) return [];
  const fractions = groups.map((g) =>
    Math.sqrt(g[weight] / Math.max(1, maximum)),
  );
  const gap = width < 450 ? 15 : Math.min(42, width * 0.035);
  const compact = height < 240 || width < 500;
  const caption = compact ? 39 : 59;
  const labelWidth = Math.min(width, compact ? 94 : 132);
  let bestSide = -1,
    best: Square[] = [];
  for (let columns = 1; columns <= groups.length; columns++) {
    function place(scale: number) {
      const list: Square[] = [];
      let bottom = 0;
      for (let start = 0; start < groups.length; start += columns) {
        const row = fractions.slice(start, start + columns);
        const sides = row.map((r) => r * scale);
        const widths = sides.map((side) => Math.max(side, labelWidth));
        const usedWidth =
          widths.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
        if (usedWidth > width) return null;
        let x = (width - usedWidth) / 2;
        let rowHeight = 0;
        sides.forEach((side, j) => {
          // Stagger columns to keep equal-sized groups individually legible.
          const step =
            row.length > 1 && !compact
              ? [0.14, 0, 0.2, 0.06][j % 4] * scale
              : 0;
          list.push({ x, y: bottom + step, side, width: widths[j], caption });
          x += widths[j] + gap;
          rowHeight = Math.max(rowHeight, step + side + caption);
        });
        bottom += rowHeight + (start + columns < groups.length ? gap : 0);
      }
      if (bottom > height) return null;
      for (const item of list) item.y += (height - bottom) * 0.44;
      return list;
    }
    let lo = 0,
      hi = Math.min(width, height, ceiling);
    for (let i = 0; i < 11; i++) {
      const mid = (lo + hi) / 2;
      if (place(mid)) lo = mid;
      else hi = mid;
    }
    const positions = place(lo);
    if (positions && lo > bestSide) {
      bestSide = lo;
      best = positions;
    }
  }
  return best;
}

function CutSquare({ group }: { group: CanvasGroup }) {
  const id = useId().replace(/[^a-z0-9_-]/gi, "");
  const late = group.count ? group.overdue / group.count : 0;
  const raised = group.count ? group.escalated / group.count : 0;
  // Intersect x + (1-y) <= cut with a unit square. The coloured part
  // has exactly the overdue share as its area on both sides of 50%.
  const cut = late <= 0.5 ? Math.sqrt(2 * late) : 2 - Math.sqrt(2 * (1 - late));
  const p = 100 * cut;
  const cutPath =
    cut <= 1
      ? "M0 100 V" + (100 - p) + " L" + p + " 100 Z"
      : "M0 100 V0 H" + (p - 100) + " L100 " + (200 - p) + " V100 Z";
  const edge =
    cut <= 1
      ? "M0 " + (100 - p) + " L" + p + " 100"
      : "M" + (p - 100) + " 0 L100 " + (200 - p);
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id + "base"} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="var(--cx-face-a)" />
          <stop offset=".7" stopColor="var(--cx-face-b)" />
          <stop offset="1" stopColor="var(--cx-face-a)" />
        </linearGradient>
        <linearGradient id={id + "cut"} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="var(--cx-cut-a)" />
          <stop offset=".63" stopColor="var(--cx-cut-b)" />
          <stop offset="1" stopColor="var(--cx-cut-a)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill={`url(#${id}base)`} />
      {late > 0 && (
        <path {...el("overdue-cut")} d={cutPath} fill={`url(#${id}cut)`} />
      )}
      {late > 0 && late < 1 && (
        <g fill="none">
          <path
            d={edge}
            stroke="var(--cx-edge)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={edge}
            transform="translate(0 1.5)"
            stroke="var(--cx-edge)"
            opacity=".6"
            strokeWidth=".55"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      <rect
        x=".1"
        y=".1"
        width="99.8"
        height="99.8"
        fill="none"
        stroke="var(--cx-border)"
        vectorEffect="non-scaling-stroke"
      />
      {raised > 0 && (
        <path
          {...el("escalation-notch")}
          d={`M0 1H${100 * raised}`}
          stroke="var(--cx-ink)"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function Squares({ result, choose }: Pick<FigureProps, "result" | "choose">) {
  const { ref, width, height } = useBox();
  const [requestedPage, setPage] = useState(0);
  const weight = result.intent.weightBy ?? "count";
  const groups = result.groups;
  const cols = Math.max(
    1,
    Math.floor((width + 12) / (width < 500 ? 113 : 154)),
  );
  const rows = Math.max(
    1,
    Math.floor((height - 30) / (width < 500 ? 113 : 160)),
  );
  const perPage = Math.max(1, Math.min(12, cols * rows));
  const pages = Math.ceil(groups.length / perPage);
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const visible = useMemo(
    () => groups.slice(page * perPage, (page + 1) * perPage),
    [groups, page, perPage],
  );
  const reserve = width < 430 && (pages > 1 || weight !== "count") ? 53 : 32;
  const geometry = useMemo(() => {
    const available = Math.max(0, height - reserve);
    // The API sorts groups by this metric. Calibrating once on the largest
    // page keeps the meaning of a square's area stable during pagination.
    const max = groups[0]?.[weight] ?? 0;
    const first = packSquares(
      groups.slice(0, perPage),
      weight,
      width,
      available,
      max,
    );
    return page
      ? packSquares(visible, weight, width, available, max, first[0]?.side ?? 0)
      : first;
  }, [groups, visible, perPage, page, weight, width, height, reserve]);
  return (
    <div
      ref={ref}
      className="cx-squares"
      {...el("area-map")}
      data-testid="group-field"
      data-weight={weight}
    >
      {geometry.map((rect, i) => {
        const g = visible[i];
        return (
          <button
            type="button"
            {...el("group-square")}
            className="cx-square"
            data-stacked-label={rect.width < 192 && rect.caption >= 55}
            key={g.key}
            onClick={() => choose(g)}
            title={
              g.label +
              " · Всего " +
              g.count +
              " · Просрочено " +
              g.overdue +
              " · Устранение последствий " +
              g.escalated
            }
            style={
              {
                ...paint(page * perPage + i),
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.side + rect.caption,
                "--side": rect.side + "px",
                "--delay": i * 28 + "ms",
              } as CSSProperties
            }
          >
            <span
              aria-hidden="true"
              {...(g[weight] ? {} : el("zero-square"))}
              className="cx-square-ink"
              data-zero={!g[weight]}
            >
              {g[weight] > 0 && <CutSquare group={g} />}
            </span>
            <span className="cx-square-caption">
              <b>{formatCount(g[weight])}</b>
              <span>{g.label}</span>
            </span>
          </button>
        );
      })}
      {reserve > 0 && (
        <div className="cx-figure-foot">
          <div className="cx-key">
            {weight !== "count" && (
              <b {...el("weight-key")}>Размер · {weights[weight]}</b>
            )}
            <span
              {...el("cut-key")}
              title="Площадь цветного среза соответствует доле просроченных заявок внутри группы"
            >
              <i className="cx-key-cut" />
              Просрочено{" "}
              {formatCount(
                result.metrics.find((m) => m.key === "overdue")?.value ?? 0,
              )}
            </span>
            <span
              {...el("notch-key")}
              title="Длина верхней отметки соответствует доле заявок с отметкой об устранении последствий внутри группы"
            >
              <i className="cx-key-line" />
              Устранение последствий{" "}
              {formatCount(
                result.metrics.find((m) => m.key === "escalated")?.value ?? 0,
              )}
            </span>
          </div>
          <PageControls
            {...{ page, pages, goto: setPage, label: "Страницы групп" }}
          />
        </div>
      )}
    </div>
  );
}

const slots = ["overdue", "soon", "normal", "unset"];
function DeadlineAxis({
  result,
  choose,
}: Pick<FigureProps, "result" | "choose">) {
  const groups = [...result.groups].sort(
    (a, b) => slots.indexOf(a.key) - slots.indexOf(b.key),
  );
  return (
    <div
      {...el("time-axis")}
      className="cx-axis"
      data-testid="deadline-windows"
    >
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          {...el("time-window")}
          style={paint([0, 1, 2, 3][slots.indexOf(g.key)])}
          onClick={() => choose(g)}
        >
          <b {...el("window-count")}>{formatCount(g.count)}</b>
          <span
            {...el("milestone")}
            className="cx-axis-tick"
            aria-hidden="true"
          />
          <span>{g.label}</span>
        </button>
      ))}
    </div>
  );
}
function Comparison({
  result,
  choose,
}: Pick<FigureProps, "result" | "choose">) {
  const { ref, height, width } = useBox();
  const [requested, setPage] = useState(0);
  const directory = result.intent.presentation === "register";
  const showShares = result.intent.presentation === "compare";
  const directoryColumns = Math.max(1, Math.floor((width + 18) / 268));
  const directoryRows = Math.max(1, Math.floor((height - 48) / 88));
  const perPage = directory
    ? Math.min(12, directoryColumns * directoryRows)
    : Math.max(1, Math.min(9, Math.floor((height - 60) / 43)));
  const pages = Math.ceil(result.groups.length / perPage),
    page = Math.max(0, Math.min(requested, pages - 1));
  const max = Math.max(1, ...result.groups.map((g) => g.count));
  const visible = result.groups.slice(page * perPage, (page + 1) * perPage);
  return (
    <div
      ref={ref}
      className="cx-compare"
      data-testid={directory ? "group-directory" : "group-comparison"}
    >
      {directory ? (
        <GroupDirectory groups={visible} total={result.total} choose={choose} />
      ) : (
        <table {...el("comparison-table")}>
          <thead>
            <tr>
              {[
                "Группа",
                showShares ? "Всего · доля" : "Всего",
                "Просрочено",
                "Последствия",
              ].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key}>
                <th scope="row" {...el("row-heading")}>
                  <button
                    type="button"
                    title={g.label}
                    onClick={() => choose(g)}
                  >
                    {g.label}
                  </button>
                </th>
                {[g.count, g.overdue, g.escalated].map((n, i) => (
                  <td key={i}>
                    <span {...el("cell-value")}>{formatCount(n)}</span>
                    {showShares && i === 0 && (
                      <small className="cx-cell-share">
                        {percent(n, result.total)}
                      </small>
                    )}
                    <i
                      {...el("cell-bar")}
                      aria-hidden="true"
                      style={{
                        ...paint([1, 0, 2][i]),
                        width: (100 * n) / max + "%",
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PageControls
        {...{
          page,
          pages,
          goto: setPage,
          label: directory ? "Страницы групп" : "Страницы сравнения",
        }}
      />
    </div>
  );
}

export function CanvasFigure(props: FigureProps) {
  const { result, choose } = props;
  const kind = result.intent.presentation,
    ids = result.intent.exhibits;
  if (result.total && kind === "brief")
    return <Briefing result={result} choose={choose} ids={ids} />;
  let figure;
  if (result.total && kind === "spotlight" && result.tickets.length)
    figure = <Spotlight {...props} />;
  else if (
    result.total &&
    kind &&
    ["bars", "orbit", "flow", "matrix", "cards"].includes(kind) &&
    result.groups.length
  )
    figure = <DataChart kind={kind} result={result} choose={choose} />;
  else figure = <StandardFigure {...props} />;
  return ids?.length && result.total ? (
    <div className="ar-composed">
      {figure}
      <ExhibitTray result={result} choose={choose} ids={ids} />
    </div>
  ) : (
    figure
  );
}
function StandardFigure({ result, choose, ns, open, zone }: FigureProps) {
  if (!result.total)
    return (
      <div
        className="cx-empty"
        {...el(result.sourceTotal ? "empty-selection" : "no-source")}
      >
        <h3>
          {result.sourceTotal ? "Инцидентов не найдено" : "Источник пока пуст"}
        </h3>
        {result.sourceTotal > 0 && <p>Измените условия отбора.</p>}
      </div>
    );
  if (
    result.intent.layout === "comparison" &&
    result.intent.groupBy !== "ticket" &&
    result.intent.presentation === "register"
  )
    return <Comparison {...{ result, choose }} />;
  if (
    result.intent.presentation === "register" ||
    result.intent.layout === "list" ||
    (result.intent.groupBy === "ticket" &&
      result.intent.layout !== "comparison")
  )
    return <TicketPreview {...{ result, ns, open, zone }} />;
  if (
    result.intent.presentation === "compare" ||
    result.intent.layout === "comparison"
  )
    return <Comparison {...{ result, choose }} />;
  if (result.intent.groupBy === "deadline")
    return <DeadlineAxis {...{ result, choose }} />;
  return <Squares {...{ result, choose }} />;
}
function TicketPreview({ result, ns, open, zone }: Omit<FigureProps, "choose">) {
  const { ref, height } = useBox();
  const shown = Math.max(1, Math.floor(height / 54));
  return (
    <div
      {...el("ticket-list")}
      className="cx-preview"
      data-testid="ticket-register"
      ref={ref}
    >
      {result.tickets.slice(0, shown).map((ticket) => (
        <CanvasTicketLink key={ticket.id} {...{ ticket, ns, open, zone }} />
      ))}
    </div>
  );
}
