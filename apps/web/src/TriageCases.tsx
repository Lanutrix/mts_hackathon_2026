import { useEffect, useRef, useState } from "react";
import type { CaseAnalysis, TriageCase } from "../../../packages/domain/triage";
import Loader from "./Loader";
import { Icon } from "./Brand";
import { fieldName, TicketMentions } from "./IncidentSources";

const dimensions = [
  ["symptom", "По симптому"],
  ["priority", "По приоритету"],
  ["product", "По продукту"],
  ["team", "По команде"],
] as const;

function caseCriterion(record: TriageCase, dimension: string) {
  if (dimension === "symptom") {
    const field = record.evidence[0]?.field;
    const source =
      field === "header"
        ? "в теме"
        : field === "shortDescription"
          ? "в кратком описании"
          : "в описании";
    if (record.label === "Признак не определён")
      return "В описании заявки не удалось выделить симптом.";
    return "Пример " + source + " заявки";
  }
  const field =
    dimension === "team"
      ? "Команда"
      : dimension === "product"
        ? "Продукт"
        : "Приоритет";
  return field + " в карточке заявки";
}

function CaseExample({
  record,
  dimension,
  open,
}: {
  record: TriageCase;
  dimension: string;
  open: (id: string) => void;
}) {
  const quote =
    dimension === "symptom" ? record.evidence[0]?.value : record.label;
  return (
    <div className="case-example">
      <p className="case-criterion">{caseCriterion(record, dimension)}</p>
      <button
        type="button"
        className="case-source"
        onClick={() => open(record.lead.id)}
      >
        {record.lead.id} ↗
      </button>
      {quote && <blockquote title={quote}>{quote}</blockquote>}
    </div>
  );
}

export function caseRequest(
  record: TriageCase,
  query: string,
  ns: string,
  revision: number,
  analysis = false,
) {
  const params = new URLSearchParams(query);
  params.delete("case");
  params.set("ns", ns);
  params.set("revision", String(revision));
  params.set("hash", record.hash);
  return (
    "/api/triage/" +
    encodeURIComponent(record.id) +
    (analysis ? "/analysis?" : "?") +
    params
  );
}

type Props = {
  cases: TriageCase[];
  chosen: TriageCase | undefined;
  dimension: string;
  amount: number;
  revision: number;
  query: string;
  ns: string;
  csrf?: string;
  canAnalyze: boolean;
  canDispatch: boolean;
  open: (id: string) => void;
  setParam: (key: string, value: string) => void;
};

export default function TriageCases(props: Props) {
  const { cases, chosen, dimension, amount, setParam } = props;
  const [offset, setOffset] = useState(0);
  const [shortDisplay, setShortDisplay] = useState(
    () => matchMedia("(max-height: 950px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-height: 950px)");
    const resize = () => setShortDisplay(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const perPage = shortDisplay && cases.length > 3 ? 2 : 4;
  const start = Math.min(
    Math.floor(offset / perPage) * perPage,
    Math.max(0, Math.floor((cases.length - 1) / perPage) * perPage),
  );
  const focus = chosen ?? cases[0];
  const [opened, setOpened] = useState<TriageCase | null>(null);
  const currentCase = opened && cases.find((item) => item.id === opened.id);
  const pick = (id: string) => {
    setOpened(null);
    setParam("case", id);
  };
  return (
    <aside className="case-lens" aria-label="Группировка и разбор кейсов">
      <div className="case-heading">
        <h2>
          Кейсы <small>{cases.length}</small>
        </h2>
        <select
          aria-label="Группировка кейсов"
          value={dimension}
          onChange={(e) => {
            setOffset(0);
            setOpened(null);
            setParam("groupBy", e.target.value);
          }}
        >
          {dimensions.map(([v, name]) => (
            <option key={v} value={v}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="case-picker">
        <select
          aria-label="Выбрать кейс"
          value={chosen?.id ?? ""}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">Все тикеты · {amount}</option>
          {cases.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} · {k.count}
            </option>
          ))}
        </select>
      </div>
      <div className="case-ranks" role="group" aria-label="Кейсы по срочности">
        <button
          className="case-all"
          type="button"
          aria-pressed={!chosen}
          onClick={() => pick("")}
        >
          Все тикеты <b>{amount}</b>
        </button>
        {cases.slice(start, start + perPage).map((k) => (
          <button
            type="button"
            className="case-rank"
            aria-pressed={k.id === chosen?.id}
            onClick={() => pick(k.id)}
            key={k.id}
          >
            <span className="case-rank-name">{k.label}</span>
            <b>{k.count}</b>
            {(k.overdue > 0 || k.escalations > 0) && (
              <small className="case-risk">
                {k.overdue > 0 && (
                  <span title={"Просрочено: " + k.overdue}>
                    <Icon name="clock" size={15} />
                    <span className="sr-only">Просрочено </span>
                    {k.overdue}
                  </span>
                )}
                {k.escalations > 0 && (
                  <span title={"К эскалации: " + k.escalations}>
                    <Icon name="escalation" size={15} />
                    <span className="sr-only">К эскалации </span>
                    {k.escalations}
                  </span>
                )}
              </small>
            )}
            <span className="case-scale" aria-hidden="true">
              <i
                style={{
                  width:
                    Math.max(1, (100 * k.count) / Math.max(1, amount)) + "%",
                }}
              />
            </span>
          </button>
        ))}
        {cases.length > perPage && (
          <nav className="case-pages" aria-label="Страницы кейсов">
            <button
              disabled={!start}
              aria-label="Предыдущие кейсы"
              onClick={() => setOffset(start - perPage)}
            >
              ←
            </button>
            <span>
              {start + 1}–{Math.min(cases.length, start + perPage)} из{" "}
              {cases.length}
            </span>
            <button
              disabled={start + perPage >= cases.length}
              aria-label="Следующие кейсы"
              onClick={() => setOffset(start + perPage)}
            >
              →
            </button>
          </nav>
        )}
      </div>
      {focus && (
        <div className="case-insight">
          <div className="case-insight-head">
            <h3>{chosen ? "Выбранный кейс" : "В первую очередь"}</h3>
            <button className="case-analyze" onClick={() => setOpened(focus)}>
              {props.canAnalyze ? "ИИ-разбор" : "Разбор"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <strong className="case-insight-name">{focus.label}</strong>
          <CaseExample record={focus} dimension={dimension} open={props.open} />
          <p className="case-recommendation">
            <TicketMentions
              text={focus.recommendation}
              ids={[focus.topId, ...focus.evidence.map((e) => e.id)]}
              ns={props.ns}
              open={props.open}
              className="case-source"
            />
          </p>
          {!chosen && (
            <button
              className="case-drill"
              type="button"
              onClick={() => pick(focus.id)}
            >
              Тикеты кейса · {focus.count} <span aria-hidden="true">→</span>
            </button>
          )}
          {props.canDispatch && (
            <button
              className="dispatch-entry"
              type="button"
              aria-label={"Назначить исполнителя для " + focus.recommendationId}
              onClick={() => props.open(focus.recommendationId)}
            >
              Назначить исполнителя <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
      {opened && (
        <CaseDialog
          key={opened.id}
          record={currentCase || opened}
          inQueue={!!currentCase}
          {...props}
          close={() => setOpened(null)}
        />
      )}
    </aside>
  );
}

function CaseDialog({
  record,
  dimension,
  inQueue,
  query,
  ns,
  revision,
  csrf,
  canAnalyze,
  close,
  open,
}: Props & { record: TriageCase; inQueue: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef({ record, query, revision });
  current.current = { record, query, revision };
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CaseAnalysis | null>(null);
  const [fault, setFault] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!canAnalyze) return;
    const ac = new AbortController();
    const { record: input, query: filters, revision: rev } = current.current;
    setFault("");
    setResult(null);
    void fetch(caseRequest(input, filters, ns, rev, true), {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: "{}",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Разбор недоступен.");
        if (!ac.signal.aborted) setResult(body);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setFault(e.message);
      });
    return () => ac.abort();
  }, [ns, csrf, canAnalyze, attempt]);
  const stale =
    inQueue && result && (result.stale || result.inputHash !== record.hash);
  const evidence = result?.evidence.length ? result.evidence : record.evidence;
  const sourceIds = [
    record.topId,
    ...record.evidence.map((e) => e.id),
    ...evidence.map((e) => e.id),
  ];
  const hasNextCheck = result?.summary.some(
    (line) =>
      line === record.recommendation || line.startsWith("Следующая проверка"),
  );
  return (
    <dialog
      className="case-dialog"
      ref={dialog}
      aria-labelledby="case-dialog-title"
      onClose={close}
    >
      <div className="case-dialog-top">
        <span>Разбор кейса</span>
        <button aria-label="Закрыть разбор" onClick={close}>
          ×
        </button>
      </div>
      <h2 id="case-dialog-title">{record.label}</h2>
      <CaseExample
        record={record}
        dimension={dimension}
        open={(id) => {
          close();
          open(id);
        }}
      />
      <dl className="case-facts">
        <div>
          <dt>Тикеты</dt>
          <dd>{record.count}</dd>
        </div>
        <div>
          <dt>Срок прошёл</dt>
          <dd>{record.overdue}</dd>
        </div>
        <div>
          <dt>К эскалации</dt>
          <dd>{record.escalations}</dd>
        </div>
      </dl>
      {canAnalyze && !result && !fault && (
        <Loader label="Сопоставляем описания тикетов…" />
      )}
      {fault && (
        <div role="alert">
          <p>{fault}</p>
          <button
            className="case-inline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Повторить
          </button>
        </div>
      )}
      {!inQueue && (
        <p role="status">
          Кейс вышел из текущей выборки. Здесь сохранён его последний разбор.
        </p>
      )}
      {result && (
        <section className="case-result">
          <h3>
            {result.mode === "model" ? "Вывод по кейсу" : "Сводка по полям"}
          </h3>
          {result.summary.map((line, i) => (
            <p key={i}>
              <TicketMentions
                text={line}
                ids={sourceIds}
                ns={ns}
                open={open}
                className="case-source"
              />
            </p>
          ))}
          {result.mode === "fallback" && result.error && <p>{result.error}</p>}
          {stale && (
            <p role="status">
              Состав кейса изменился.{" "}
              <button
                className="case-inline"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Обновить разбор
              </button>
            </p>
          )}
        </section>
      )}
      {!hasNextCheck && (
        <section className="case-next">
          <h3>Что проверить</h3>
          <p>
            <TicketMentions
              text={record.recommendation}
              ids={sourceIds}
              ns={ns}
              open={open}
              className="case-source"
            />
          </p>
        </section>
      )}
      {!!evidence.length && (
        <div className="case-evidence">
          <h3>Источники</h3>
          {evidence.map((e, i) => (
            <div key={i}>
              <button
                className="case-source"
                onClick={() => {
                  close();
                  open(e.id);
                }}
              >
                {e.id} ↗
              </button>
              <span>
                <small>{fieldName(e.field)}</small>
                {e.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {result && (
        <details className="case-method">
          <summary>Как получен разбор</summary>
          <p>{[result.provider, result.model].filter(Boolean).join(" · ")}</p>
          {result.sampled > 0 && (
            <p>
              В выборке {result.sampled} из {record.count} тикетов.
            </p>
          )}
          {result.uncertainties.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </details>
      )}
    </dialog>
  );
}
