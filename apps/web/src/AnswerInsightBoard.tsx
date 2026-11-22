import { useEffect, useState, type ReactNode } from "react";
import {
  insightDefinitions,
  type AnswerInsight,
  type InsightPoint,
} from "../../../packages/contracts/answerInsights";
import { screenLink } from "./routes";
import { PageControls, useBox } from "./CanvasControls";
import "./answerInsights.css";

interface Props {
  insights: AnswerInsight[];
  ns: string;
  open: (id: string) => void;
}
type Jump = Pick<Props, "ns" | "open">;
function Evidence({
  id,
  children,
  ns,
  open,
  label,
}: { id?: string; children: ReactNode; label?: string } & Jump) {
  if (!id) return <span>{children}</span>;
  return (
    <a
      href={screenLink("/incident/" + encodeURIComponent(id), ns)}
      title={label ?? id}
      aria-label={label ?? id}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(id);
      }}
    >
      {children}
    </a>
  );
}
function Plots({
  points,
  kind,
  jump,
}: {
  points: InsightPoint[];
  kind: string;
  jump: Jump;
}) {
  const peak = Math.max(1, ...points.map((p) => p.value)),
    sum = points.reduce((n, p) => n + p.value, 0);
  if (kind === "subset" || kind === "ratio") {
    const share = sum ? points[0].value / sum : 0;
    return (
      <div
        className="ins-proportion"
        aria-label={"Соответствуют " + points[0].value + " из " + sum}
      >
        <svg viewBox="0 0 160 30" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 10H160V20H0Z" className="ins-track" />
          <path d={`M0 10H${share * 160}V20H0Z`} className="ins-fill" />
          <path d={`M${share * 160} 5v20`} className="ins-pin" />
        </svg>
        <div>
          {points.map((p) => (
            <span key={p.label}>
              {p.label} <b>{p.value.toLocaleString("ru-RU")}</b>
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "relation" || kind === "distribution")
    return (
      <ol
        className={
          "ins-list " + (kind === "relation" ? "ins-paths" : "ins-ranked")
        }
      >
        {points.map((p, i) => (
          <li key={p.label}>
            <Evidence
              {...jump}
              id={p.ticket}
              label={p.ticket ? p.label + " · " + p.ticket : undefined}
            >
              <i className="ins-position" aria-hidden="true">
                {i + 1}
              </i>
              <span className="ins-point-label" title={p.label}>
                {p.label}
              </span>
              <span className="ins-mini-bar" aria-hidden="true">
                <i style={{ width: (100 * p.value) / peak + "%" }} />
              </span>
              <b>{p.value.toLocaleString("ru-RU")}</b>
            </Evidence>
          </li>
        ))}
      </ol>
    );
  return (
    <ul
      className={
        "ins-bins " + (kind === "timeBuckets" ? "ins-calendar" : "ins-duration")
      }
    >
      {points.map((p) => (
        <li key={p.label}>
          <Evidence
            {...jump}
            id={p.ticket}
            label={
              p.label +
              " · " +
              p.value +
              " заявок" +
              (p.ticket ? " · " + p.ticket : "")
            }
          >
            <b>{p.value.toLocaleString("ru-RU")}</b>
            <span className="ins-well" aria-hidden="true">
              <i style={{ height: (100 * p.value) / peak + "%" }} />
            </span>
            <span className="ins-bin-caption">{p.label}</span>
          </Evidence>
        </li>
      ))}
    </ul>
  );
}
export default function AnswerInsightBoard({ insights, ns, open }: Props) {
  const box = useBox(),
    [page, setPage] = useState(0);
  const key = insights.map((s) => s.id).join("|");
  useEffect(() => {
    setPage(0);
  }, [key]);
  const perPage = Math.max(1, Math.floor(box.width / 315)),
    pages = Math.ceil(insights.length / perPage);
  const current = Math.min(page, Math.max(0, pages - 1));
  const visible = insights.slice(current * perPage, (current + 1) * perPage);
  return (
    <section
      className="ins-board"
      data-testid="answer-insights"
      aria-label="Показатели выборки"
      ref={box.ref}
      data-compact={box.height < 230}
    >
      <div
        className="ins-layout"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, visible.length)},minmax(0,1fr))`,
        }}
      >
        {visible.map((insight) => {
          const spec = insightDefinitions[insight.id];
          return (
            <article
              key={insight.id}
              className="ins-block"
              data-insight={insight.id}
              data-chart={spec.kind}
            >
              <h3>{spec.title}</h3>
              <strong className="ins-number">{insight.value}</strong>
              {insight.points.length > 0 && (
                <Plots
                  points={insight.points}
                  kind={spec.kind}
                  jump={{ ns, open }}
                />
              )}
              <div className="ins-citation">
                <span>{insight.note}</span>
                {insight.evidence && (
                  <Evidence id={insight.evidence} ns={ns} open={open}>
                    {insight.evidence} ↗
                  </Evidence>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <PageControls
        page={current}
        pages={pages}
        goto={setPage}
        label="Страницы показателей"
      />
    </section>
  );
}
