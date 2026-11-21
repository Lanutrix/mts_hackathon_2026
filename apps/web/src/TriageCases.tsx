import { useEffect, useRef, useState } from "react";
import type { CaseAnalysis, TriageCase } from "../../../packages/domain/triage";
import Loader from "./Loader";

const dimensions = [
  ["symptom", "По симптому"],
  ["priority", "По приоритету"],
  ["product", "По продукту"],
  ["team", "По команде"],
] as const;

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

const fieldLabels: Record<string, string> = {
  header: "Тема",
  description: "Описание",
  priorityId: "Код приоритета",
  deadline: "Срок",
  sourcePresent: "Есть в выгрузке",
  isNeedUp: "Эскалация",
  assignedGroupName: "Группа",
  productName: "Продукт",
  solution: "Решение",
  stateId: "Код статуса",
};
const fieldName = (field: string) => fieldLabels[field] ?? field;

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
  open: (id: string) => void;
  setParam: (key: string, value: string) => void;
};

export default function TriageCases(props: Props) {
  const { cases, chosen, dimension, amount, setParam } = props;
  const [offset, setOffset] = useState(0);
  const perPage = 4;
  const start = Math.min(
    offset,
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
                {[
                  k.overdue && "Срок прошёл у " + k.overdue,
                  k.escalations && "К эскалации " + k.escalations,
                ]
                  .filter(Boolean)
                  .join(" · ")}
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
          <p>
            {!chosen && <b className="case-mobile-topic">{focus.label}. </b>}
            {focus.recommendation}
          </p>
          <button
            className="case-source"
            onClick={() => props.open(focus.topId)}
          >
            {focus.topId} ↗
          </button>
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
      <h3>Что проверить</h3>
      <p>{record.recommendation}</p>
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
            {result.mode === "model" ? "Сводка по группе" : "Сводка по полям"}
          </h3>
          {result.mode === "model" && (
            <small>
              {result.model}
              {result.sampled < record.count &&
                " · По выборке " + result.sampled + " из " + record.count}
            </small>
          )}
          {result.mode === "model" && result.summary.length > 0 && (
            <ul>
              {result.summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          {result.mode === "fallback" && result.error && <p>{result.error}</p>}
          {result.uncertainties.map((s, i) => (
            <p className="case-limit" key={i}>
              {s}
            </p>
          ))}
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
      {!!evidence.length && (
        <div className="case-evidence">
          <h3>
            {result?.mode === "model" ? "Цитаты из тикетов" : "Основания"}
          </h3>
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
    </dialog>
  );
}
