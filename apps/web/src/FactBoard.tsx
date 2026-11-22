import { useEffect, useState, type CSSProperties } from "react";
import type {
  CanvasGroup,
  CanvasPage,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import {
  formatFactDuration,
  durationGroups,
  isDurationGroup,
  type CanvasFact,
  type DurationEvidence,
} from "../../../packages/contracts/canvasFacts";
import { canvasJson } from "./CanvasTickets";
import { TicketMentions } from "./IncidentSources";
import { Icon } from "./Brand";
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
  const hasSimilar = edges.some(edge => edge.kind === "similarity");
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
        {edges.some(edge => edge.kind === "reference") && <span data-kind="reference">Ссылка в источнике</span>}
        {hasSimilar && <span data-kind="similarity">Общие признаки</span>}
      </div>
      {hasSimilar && (
        <p className="fact-note">Совпадение признаков не подтверждает причинную связь.</p>
      )}
      {edges.map((edge, i) => (
        <details
          className="fact-edge"
          key={i}
        >
          <summary>
            {nodes.length === 2 && edge.kind === "similarity"
              ? edge.evidence.map(field => field.replace(/ \([^)]*\) · /u, " — ")).join(". ")
              : <>{edge.from} · {edge.to} <strong>
                  {edge.kind === "reference" ? "Прямая ссылка" : "Совпадение полей"}
                </strong></>}
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

function RecentIncidents({ result, ...navigation }: Navigation & { result: CanvasResult }) {
  if (!result.tickets.length) return null;
  return <ol className="fact-arrivals" aria-label="По времени регистрации">
    {result.tickets.map(ticket => <li key={ticket.id}>
      <div className="fact-arrival-stamp">
        {ticket.submittedAt && <><Moment iso={ticket.submittedAt} /> <small>МСК</small></>}
      </div>
      <div className="fact-arrival-body">
        <div><SourceId id={ticket.id} {...navigation} /><span>{ticket.state}</span></div>
        <strong>{ticket.header}</strong>
        <small><Icon name="team" size={14} />{ticket.team}</small>
      </div>
    </li>)}
  </ol>;
}

function StatusIntervalSample({ result, ...navigation }: Navigation & { result: CanvasResult }) {
  const sample = result.fact?.statusIntervals;
  if (!sample) return null;
  const examples = result.tickets.filter(t => t.statusIntervals).slice(0, 4);
  return <>
    <div role="group" aria-label="Основание расчёта">
      <dl className="fact-interval-sample">
        <div><dt>Интервалов</dt><dd>{formatCount(sample.intervalCount)}</dd></div>
        <div><dt>Заявок с интервалами</dt><dd>{formatCount(sample.ticketCount)}</dd></div>
        <div><dt>Заявок в выборке</dt><dd>{formatCount(sample.scopeCount)}</dd></div>
      </dl>
    </div>
    {examples.length > 0 && <ul className="fact-interval-rows" aria-label="Интервалы по заявкам">
      {examples.map(ticket => <li key={ticket.id}>
        <SourceId id={ticket.id} {...navigation} />
        <span>{ticket.header}</span>
        <strong title={sample.medianMs !== undefined ? "Медиана по заявке" : "Среднее по заявке"}>
          {formatFactDuration(ticket.statusIntervals!.medianMs ?? ticket.statusIntervals!.meanMs)}
        </strong>
      </li>)}
    </ul>}
  </>;
}

function GroupDurations({ result, choose }: { result: CanvasResult; choose: GroupChoice }) {
  const [page, setPage] = useState(0);
  const perPage = 8;
  const groups = result.groups.slice(page * perPage, (page + 1) * perPage);
  const { durationMeasure, display } = result.intent.fact!;
  const metric = durationMeasure === "mean" ? "Среднее" : "Медиана";
  const dimension = isDurationGroup(result.intent.groupBy) ? durationGroups[result.intent.groupBy].axis : "Группа";
  const max = Math.max(1, result.groups[0].durationMs!, result.groups.at(-1)!.durationMs!);
  return <div className="fact-durations">
    {display === "bars" || display === "list" ? (
      <ol start={page * perPage + 1} className={display === "bars" ? "fact-duration-bars" : "fact-duration-list"} aria-label={metric + " времени решения"}>
        {groups.map(g => <li key={g.key}>
          <div className="fact-duration-row">
            <button type="button" onClick={() => choose(g)}>{g.label}</button>
            <strong>{formatFactDuration(g.durationMs!)}</strong>
          </div>
          {display === "bars" && <div className="fact-duration-track" aria-hidden="true"><i style={{ width: (100 * g.durationMs! / max) + "%" }} /></div>}
          <p className="fact-duration-dates">Заявок с измеренной длительностью · {formatCount(g.count)}</p>
        </li>)}
      </ol>
    ) : (
      <table className="fact-rank fact-group-table">
        <caption>{metric} времени решения</caption>
        <thead><tr><th scope="col">{dimension}</th><th scope="col">{metric}</th><th scope="col">Заявки</th></tr></thead>
        <tbody>{groups.map(g => <tr key={g.key}>
          <th scope="row"><button type="button" onClick={() => choose(g)}>{g.label}</button></th>
          <td><span className="fact-table-measure">{formatFactDuration(g.durationMs!)}
            <i aria-hidden="true" style={{ "--fraction": g.durationMs! / max } as CSSProperties} /></span></td><td>{formatCount(g.count)}</td>
        </tr>)}</tbody>
      </table>
    )}
    <PageControls page={page} pages={Math.ceil(result.groups.length / perPage)} goto={setPage} label="Страницы групп" />
  </div>;
}

function DurationRanking({
  result,
  ...navigation
}: Navigation & { result: CanvasResult }) {
  const rows = result.fact!.durations!;
  const display = result.intent.fact?.display;
  const [requested, setPage] = useState(0);
  const [chunk, setChunk] = useState<{ page: number; items?: DurationEvidence[]; error?: string }>();
  const [retry, setRetry] = useState(0);
  const count = result.intent.fact?.durationMeasure === "individual" ? result.total : rows.length;
  const pages = Math.ceil(count / 10);
  const page = Math.min(requested, pages - 1);
  const needsPage = page * 10 >= rows.length;
  const { ns } = navigation;
  useEffect(() => {
    if (!needsPage) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ ns, selection: result.selection, offset: String(page * 10) });
    canvasJson<CanvasPage>("/api/canvas/tickets?" + params, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setChunk({ page, items: data.items.slice(0, 10).map(t => t.duration!) });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setChunk({ page, error: error.message });
      });
    return () => controller.abort();
  }, [needsPage, ns, result.selection, page, retry]);
  const shown = needsPage ? chunk?.page === page ? chunk.items ?? [] : [] : rows.slice(page * 10, (page + 1) * 10);
  const maximum = Math.max(1, result.fact!.maxDurationMs ?? rows.reduce((n, r) => Math.max(n, r.ms), 1));
  const caption = "Длительность решения · " + formatCount(page * 10 + 1) + "–" +
    formatCount(Math.min((page + 1) * 10, count)) + " из " + formatCount(result.total);
  const isBars = display === "bars";
  return (
    <div className="fact-durations">
      {needsPage && !shown.length && (chunk?.page === page && chunk.error
        ? <p role="alert">{chunk.error} <button type="button" onClick={() => { setChunk(undefined); setRetry(n => n + 1); }}>Повторить</button></p>
        : <p role="status">Загружаю длительности…</p>)}
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

function StatusSlice({ counts, total }: { counts: NonNullable<CanvasFact["statusCounts"]>; total: number }) {
  const [active, setActive] = useState<string>();
  let angle = Math.PI;
  const point = (radius: number, at: number) =>
    (164 + radius * Math.cos(at)).toFixed(2) + " " + (16 + radius * Math.sin(at)).toFixed(2);
  const arcs = counts.map(item => {
    const start = angle;
    angle -= Math.PI * item.count / total;
    return { ...item, d: "M" + point(144, start) + " A144 144 0 0 0 " + point(144, angle) +
      " L" + point(56, angle) + " A56 56 0 0 1 " + point(56, start) + " Z" };
  });
  return <figure className="fact-status-composition">
    <figcaption>По статусам</figcaption>
    <div className="fact-slice-layout">
      <svg className="fact-state-slice" viewBox="0 0 328 183" aria-hidden="true">
        {arcs.map(item => <path key={item.label} d={item.d} data-state={item.state}
          opacity={active && active !== item.label ? .38 : 1}
          onPointerEnter={() => setActive(item.label)} onPointerLeave={() => setActive(undefined)} />)}
        <path d="M15 16a149 149 0 0 0 298 0" className="fact-slice-rind" />
        <path d="M10 16a154 154 0 0 0 308 0" className="fact-slice-outline" />
      </svg>
      <dl>{arcs.map(item => <div key={item.label} data-active={active === item.label || undefined}
        onPointerEnter={() => setActive(item.label)} onPointerLeave={() => setActive(undefined)}>
        <dt><i data-state={item.state} aria-hidden="true" />{item.label}</dt>
        <dd><strong>{formatCount(item.count)}</strong><span>{percent(item.count, total)}</span></dd>
      </div>)}</dl>
    </div>
  </figure>;
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
        <h2 className="fact-value">{fact.headline}</h2>
        <details className="fact-calculation" key={viewKey}>
          <summary>Как посчитано</summary>
          <p className="fact-method">{fact.method}</p>
          {fact.nodes && fact.notes.map(text => <p className="fact-note" key={text}>{text}</p>)}
        </details>
      </div>
      {!!fact.statusCounts?.length && <StatusSlice counts={fact.statusCounts} total={result.total} />}
      {result.intent.fact?.operation === "recent" && <>
        <RecentIncidents result={result} {...navigation} />
        {result.tickets.length < result.total && <p className="fact-note">
          Показано {formatCount(result.tickets.length)} из {formatCount(result.total)}. Весь список доступен в «Открыть заявки».
        </p>}
      </>}
      {fact.statusIntervals && <StatusIntervalSample result={result} {...navigation} />}
      {fact.durationSummary && <dl className="fact-interval-sample" aria-label="Основание расчёта времени решения">
        <div><dt>Заявок с измеренной длительностью</dt><dd>{formatCount(fact.durationSummary.measuredCount)}</dd></div>
        <div><dt>Заявок в исходной выборке</dt><dd>{formatCount(fact.durationSummary.scopeCount)}</dd></div>
      </dl>}
      {result.groups.length > 0 && (result.intent.fact?.operation === "duration"
        ? <GroupDurations key={viewKey} result={result} choose={choose} />
        : <GroupValues key={viewKey} result={result} choose={choose} />)}
      {!!fact.durations?.length && (
        <DurationRanking key={viewKey} result={result} {...navigation} />
      )}
      {fact.nodes && <RelationDiagram fact={fact} {...navigation} />}
      {!fact.nodes && fact.notes.map((text) => (
        <p className="fact-note" key={text}>
          {text}
        </p>
      ))}
    </div>
  );
}
