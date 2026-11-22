import { useState, type CSSProperties } from "react";
import type {
  CanvasGroup,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import {
  formatFactDuration,
  type CanvasFact,
} from "../../../packages/contracts/canvasFacts";
import { TicketMentions } from "./IncidentSources";
import { formatCount, PageControls } from "./CanvasControls";
import {
  Branches,
  Dossiers,
  GroupDirectory,
  Orbit,
  percent,
} from "./AnswerCharts";
import "./factBoard.css";

type Navigation = { ns: string; open: (id: string) => void };
function SourceId({ id, ...navigation }: Navigation & { id: string }) {
  return <TicketMentions text={id} ids={[id]} {...navigation} />;
}
const fmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "medium",
});

function RelationDiagram({
  fact,
  ...navigation
}: Navigation & { fact: CanvasFact }) {
  const nodes = fact.nodes ?? [],
    edges = fact.edges ?? [];
  const locations = new Map(
    nodes.map((node, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
      return [
        node.id,
        nodes.length === 2
          ? { x: i ? 78 : 22, y: 50 }
          : { x: 50 + 35 * Math.cos(angle), y: 50 + 37 * Math.sin(angle) },
      ];
    }),
  );
  return (
    <div className="fact-graph">
      <div className="fact-graph-scroll">
        <div
          className="fact-network"
          style={{
            minWidth: nodes.length > 4 ? 550 : undefined,
            height: nodes.length > 4 ? 250 : undefined,
          }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {edges.map((e, i) => {
              const a = locations.get(e.from)!,
                b = locations.get(e.to)!;
              const bend = e.kind === "reference" ? -6 : 6;
              return (
                <path
                  key={i}
                  data-kind={e.kind}
                  d={`M${a.x},${a.y} Q${(a.x + b.x) / 2 + bend},${(a.y + b.y) / 2 + bend} ${b.x},${b.y}`}
                />
              );
            })}
          </svg>
          {nodes.map((node) => {
            const p = locations.get(node.id)!;
            return (
              <span
                key={node.id}
                className="fact-node"
                data-found={node.found}
                style={{ left: p.x + "%", top: p.y + "%" }}
                title={node.label}
              >
                {node.found ? (
                  <SourceId id={node.id} {...navigation} />
                ) : (
                  <>
                    {node.id}
                    <small>Нет в срезе</small>
                  </>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <div className="fact-legend">
        <span data-kind="reference">Ссылка в источнике</span>
        <span data-kind="similarity">Общие признаки</span>
      </div>
      {edges.map((edge, i) => (
        <details
          className="fact-edge"
          key={i}
          open={edges.length === 1 || undefined}
        >
          <summary>
            {edge.from} · {edge.to}
            <strong>
              {edge.kind === "reference" ? "Прямая ссылка" : "Совпадение полей"}
            </strong>
          </summary>
          <ul>
            {edge.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
type GroupChoice = (g: CanvasGroup | null) => void;

function GroupValues({
  result,
  choose,
}: {
  result: CanvasResult;
  choose: GroupChoice;
}) {
  const plan = result.intent.fact!;
  const groups = result.groups;
  const display =
    plan.display ?? (plan.operation === "distinct" ? "list" : "bars");
  const perPage = ["cards", "ring", "diagram"].includes(display) ? 6 : 8;
  const [requested, setPage] = useState(0);
  const pages = Math.ceil(groups.length / perPage);
  const page = Math.min(requested, pages - 1);
  const start = page * perPage;
  const visible = groups.slice(start, start + perPage);
  const maximum = groups.reduce((n, g) => Math.max(n, g.count), 1);
  const marks = {
    all: groups,
    groups: visible,
    start,
    choose,
    weight: "count" as const,
  };
  let chart;
  switch (display) {
    case "ring":
      chart = <Orbit {...marks} />;
      break;
    case "diagram":
      chart = <Branches {...marks} />;
      break;
    case "cards":
      chart = <Dossiers {...marks} />;
      break;
    case "list":
      chart = (
        <GroupDirectory groups={visible} total={result.total} choose={choose} />
      );
      break;
    case "table":
      chart = (
        <table className="fact-rank fact-group-table">
          <caption className="sr-only">Распределение заявок по группам</caption>
          <thead>
            <tr>
              <th scope="col">Группа</th>
              <th scope="col">Заявки</th>
              <th scope="col">Доля</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key}>
                <th scope="row">
                  <button type="button" onClick={() => choose(g)}>
                    {g.label}
                  </button>
                </th>
                <td>{formatCount(g.count)}</td>
                <td>{percent(g.count, result.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
      break;
    default:
      chart = visible.map((g) => (
        <button
          key={g.key}
          type="button"
          className="fact-bar"
          onClick={() => choose(g)}
          style={{ "--fraction": g.count / maximum } as CSSProperties}
        >
          <span>{g.label}</span>
          <b>{formatCount(g.count)} ↗</b>
          <i aria-hidden="true" />
        </button>
      ));
  }
  return (
    <div className="fact-distribution" data-display={display}>
      {chart}
      <PageControls
        page={page}
        pages={pages}
        goto={setPage}
        label="Страницы групп"
      />
    </div>
  );
}

function Moment({ iso }: { iso: string }) {
  return <time dateTime={iso}>{fmt.format(new Date(iso))}</time>;
}

function DurationRanking({
  result,
  ...navigation
}: Navigation & { result: CanvasResult }) {
  const rows = result.fact!.durations!;
  const display = result.intent.fact?.display;
  const [requested, setPage] = useState(0);
  const pages = Math.ceil(rows.length / 10);
  const page = Math.min(requested, pages - 1);
  const shown = rows.slice(page * 10, (page + 1) * 10);
  const maximum = rows.reduce((n, r) => Math.max(n, r.ms), 1);
  const caption =
    "Длительность решения · " +
    formatCount(rows.length) +
    " из " +
    formatCount(result.total);
  const isBars = display === "bars";
  return (
    <div className="fact-durations">
      {isBars || display === "list" ? (
        <>
          <p className="fact-duration-caption">{caption}</p>
          <ol
            start={page * 10 + 1}
            className={isBars ? "fact-duration-bars" : "fact-duration-list"}
            aria-label="Длительность решения"
          >
            {shown.map((row) => (
              <li key={row.id}>
                <div className="fact-duration-row">
                  <div className="fact-duration-identity">
                    <SourceId id={row.id} {...navigation} />
                    <span>{row.header ?? "Тема не указана"}</span>
                  </div>
                  <strong>{formatFactDuration(row.ms)}</strong>
                </div>
                {isBars && (
                  <div className="fact-duration-track" aria-hidden="true">
                    <i style={{ width: (100 * row.ms) / maximum + "%" }} />
                  </div>
                )}
                <p className="fact-duration-dates">
                  <span>
                    Регистрация <Moment iso={row.start} />
                  </span>
                  <span>
                    Завершение <Moment iso={row.end} /> МСК
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <table className="fact-rank">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Заявка</th>
              <th scope="col">Длительность</th>
              <th scope="col">Регистрация, МСК</th>
              <th scope="col">Завершение, МСК</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td>
                  <SourceId id={row.id} {...navigation} />
                  <span className="fact-rank-subject">
                    {row.header ?? "Тема не указана"}
                  </span>
                </td>
                <td>{formatFactDuration(row.ms)}</td>
                <td>
                  <Moment iso={row.start} />
                </td>
                <td>
                  <Moment iso={row.end} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PageControls
        page={page}
        pages={pages}
        goto={setPage}
        label="Страницы рейтинга"
      />
    </div>
  );
}

export default function FactBoard({
  result,
  choose,
  ...navigation
}: Navigation & {
  result: CanvasResult;
  choose: GroupChoice;
}) {
  const fact = result.fact!;
  const viewKey = result.selection + ":" + (result.intent.fact?.display ?? "");
  return (
    <div
      className="fact-board"
      tabIndex={0}
      aria-label="Расчёт по данным источника"
    >
      <div className="fact-heading">
        <p className="fact-value">{fact.headline}</p>
        <p className="fact-method">{fact.method}</p>
      </div>
      {result.groups.length > 0 && (
        <GroupValues key={viewKey} result={result} choose={choose} />
      )}
      {!!fact.durations?.length && (
        <DurationRanking key={viewKey} result={result} {...navigation} />
      )}
      {fact.nodes && <RelationDiagram fact={fact} {...navigation} />}
      {fact.notes.map((text) => (
        <p className="fact-note" key={text}>
          {text}
        </p>
      ))}
      {result.total > 0 && (
        <button
          className="fact-drill"
          type="button"
          onClick={() => choose(null)}
        >
          Открыть заявки выборки ↗
        </button>
      )}
    </div>
  );
}
