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
export default function FactBoard({
  result,
  choose,
  ...navigation
}: Navigation & {
  result: CanvasResult;
  choose: (g: CanvasGroup | null) => void;
}) {
  const fact = result.fact!,
    groups = result.groups;
  const [requested, setPage] = useState(0);
  const perPage = 8,
    pages = Math.ceil(groups.length / perPage),
    page = Math.max(0, Math.min(requested, pages - 1));
  const maximum = Math.max(1, groups[0]?.count ?? 0, groups.at(-1)?.count ?? 0);
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
      {groups.length > 0 && (
        <div className="fact-distribution">
          {result.intent.fact?.operation === "distinct" ? (
            <ul className="fact-directory" aria-label="Перечень значений">
              {groups
                .slice(page * perPage, (page + 1) * perPage)
                .map((group) => (
                  <li key={group.key}>
                    <button type="button" onClick={() => choose(group)}>
                      <strong>{group.label}</strong>
                      <span>Заявок: {formatCount(group.count)} ↗</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            groups.slice(page * perPage, (page + 1) * perPage).map((group) => (
              <button
                key={group.key}
                type="button"
                className="fact-bar"
                onClick={() => choose(group)}
                style={{ "--fraction": group.count / maximum } as CSSProperties}
              >
                <span>{group.label}</span>
                <b>{formatCount(group.count)} ↗</b>
                <i aria-hidden="true" />
              </button>
            ))
          )}
          <PageControls
            page={page}
            pages={pages}
            goto={setPage}
            label="Страницы групп"
          />
        </div>
      )}
      {!!fact.durations?.length && (
        <table className="fact-rank">
          <caption>
            Длительность решения · {fact.durations.length} из{" "}
            {formatCount(result.total)}
          </caption>
          <thead>
            <tr>
              <th>Заявка</th>
              <th>Длительность</th>
              <th>Регистрация, МСК</th>
              <th>Завершение, МСК</th>
            </tr>
          </thead>
          <tbody>
            {fact.durations.map((row) => (
              <tr key={row.id}>
                <td>
                  <SourceId id={row.id} {...navigation} />
                </td>
                <td>{formatFactDuration(row.ms)}</td>
                <td>
                  <time dateTime={row.start}>
                    {fmt.format(new Date(row.start))}
                  </time>
                </td>
                <td>
                  <time dateTime={row.end}>
                    {fmt.format(new Date(row.end))}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
