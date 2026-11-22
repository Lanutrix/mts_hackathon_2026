import { useEffect, useRef, useState } from "react";
import type { CaseAnalysis, TriageCase } from "../../../packages/domain/triage";
import type { LiveStep } from "../../../packages/domain/liveStep";
import Loader from "./Loader";
import { Icon } from "./Brand";
import { fieldName, TicketMentions } from "./IncidentSources";

import { responseBands } from "../../../packages/domain/responseOrder";

const dimensions = [
  ["response", "По порядку разбора"],
  ["symptom", "По симптому"],
  ["symptomProduct", "Симптом и продукт"],
  ["priority", "По приоритету"],
  ["product", "По продукту"],
  ["team", "По команде"],
] as const;

function caseCriterion(record: TriageCase, dimension: string) {
  if (dimension === "symptom" || dimension === "symptomProduct") {
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
  if (dimension === "response" && record.responseRank !== undefined)
    return <p className="case-criterion">{responseBands[record.responseRank].basis}</p>;
  const quote =
    dimension === "symptom" || dimension === "symptomProduct" ? record.evidence[0]?.value : record.label;
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
  liveFocus?: { caseId: string; step: LiveStep } | null;
  ready: boolean;
  modelGuidance: boolean;
  runId: string;
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
  const [shortDisplay, setShortDisplay] = useState(
    () => matchMedia("(max-height: 950px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-height: 950px)");
    const resize = () => setShortDisplay(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const [inspection, setInspection] = useState<{ record: TriageCase; step: LiveStep; query: string; advice: Advice | null; dimension: string } | null>(null);
  const perPage = shortDisplay && cases.length > 3 ? 2 : 4;
  const start = Math.min(
    Math.floor(offset / perPage) * perPage,
    Math.max(0, Math.floor((cases.length - 1) / perPage) * perPage),
  );
  const focus = chosen ?? cases.find((item) => item.id === props.liveFocus?.caseId) ?? cases[0];
  const step = (!chosen && props.liveFocus?.caseId === focus?.id ? props.liveFocus?.step : null) ?? focus?.step;
  const band = focus?.responseRank === undefined ? undefined : responseBands[focus.responseRank];
  const inspected = inspection?.query === props.query ? cases.find(item => item.id === inspection.record.id) : undefined;
  const pick = (id: string) => {
    setParam("case", id);
  };
  return (
    <aside className="case-lens" aria-label="Группировка и разбор инцидентов">
      <div className="case-heading">
        <h2>
          {dimension === "response" ? "К разбору" : "Группы"} <small>{cases.length}</small>
        </h2>
        <select
          aria-label="Группировка инцидентов"
          value={dimension}
          onChange={(e) => {
            setOffset(0);
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
          aria-label="Выбрать группу"
          value={chosen?.id ?? ""}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">Все инциденты · {amount}</option>
          {cases.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} · {k.count}
            </option>
          ))}
        </select>
      </div>
      <div className="case-ranks" role="group" aria-label="Группы по срочности">
        <button
          className="case-all"
          type="button"
          aria-pressed={!chosen}
          onClick={() => pick("")}
        >
          Все инциденты <b>{amount}</b>
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
                  <span title={"Устранение последствий: " + k.escalations}>
                    <Icon name="escalation" size={15} />
                    <span className="sr-only">Устранение последствий </span>
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
          <nav className="case-pages" aria-label="Страницы групп">
            <button
              disabled={!start}
              aria-label="Предыдущие группы"
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
              aria-label="Следующие группы"
              onClick={() => setOffset(start + perPage)}
            >
              →
            </button>
          </nav>
        )}
      </div>
      {props.ready && focus && step && (
        <LiveAdvice key={focus.id} {...props} record={focus} step={step}
          inspect={advice => setInspection({ record: focus, step, query: props.query, advice, dimension })}
          groupAction={band && !chosen && focus.count > 1 ?
            <button type="button" className="response-open" onClick={() => pick(focus.id)}>
              Разобрать группу <b>{focus.count}</b>
            </button> : band && chosen && chosen.count > 1 ?
            <button type="button" className="response-open" onClick={() => setParam("breakdown", band.key)}>
              По симптомам и продуктам
            </button> : null} />
      )}
      {inspection && (
        <CaseDialog {...props} {...inspection} record={inspected ?? inspection.record}
          step={inspected?.step ?? inspection.step} revision={(inspected ?? inspection.record).revision}
          advice={inspected && inspected.step.key !== inspection.step.key ? null : inspection.advice}
          close={() => setInspection(null)} />
      )}
    </aside>
  );
}

type Advice = { key: string; action: string; mode: "local" | "model"; model?: string; retryAfterMs?: number };

function LiveAdvice(props: Props & { record: TriageCase; step: LiveStep; inspect: (advice: Advice | null) => void; groupAction: React.ReactNode }) {
  const {record, step, query, ns, runId, revision, csrf, canAnalyze, modelGuidance, open} = props;
  const band = record.responseRank === undefined ? undefined : responseBands[record.responseRank];
  const scope = JSON.stringify([ns, runId, query, record.id, step.key]);
  const lastRefinement = useRef({ reason: "", at: 0 });
  const latestRequest = useRef("");
  latestRequest.current = caseRequest(record, query, ns, revision, true);
  const [reply, setReply] = useState<{ scope: string; advice: Advice } | null>(null);
  useEffect(() => {
    if (!canAnalyze || !modelGuidance) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const reason = step.ticketId + "/" + step.reason;
    const refine = async (canRetry: boolean) => {
      lastRefinement.current = { reason, at: Date.now() };
      try {
        const response = await fetch(latestRequest.current, {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
          body: JSON.stringify({ purpose: "liveStep", decisionKey: step.key, ticketId: step.ticketId, runId }),
        });
        if (!response.ok) {
          if (!controller.signal.aborted && canRetry && response.status === 429)
            timer = setTimeout(() => void refine(false), 60_000);
          return;
        }
        const advice: Advice = await response.json();
        if (controller.signal.aborted || advice.key !== step.key) return;
        if (advice.mode === "model") setReply({ scope, advice });
        else if (canRetry && advice.retryAfterMs)
          timer = setTimeout(() => void refine(false), advice.retryAfterMs);
      } catch {
        // The field-based step remains available when the provider or network is offline.
      }
    };
    const wait = lastRefinement.current.reason === reason ? 12_000 - (Date.now() - lastRefinement.current.at) : 0;
    timer = setTimeout(() => void refine(true), Math.max(450, wait));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scope, csrf, canAnalyze, modelGuidance, step.key, step.ticketId, step.reason, runId]);
  const refined = canAnalyze && modelGuidance && reply?.scope === scope ? reply.advice : null;
  return (
    <section className="case-insight live-advice" aria-label="Следующий шаг" data-testid="live-guidance" data-origin={refined ? "model" : "local"}>
      <div className="case-insight-head">
        <h3>{refined ? "Совет ИИ" : "Следующий шаг"}</h3>
        <button type="button" className="case-analyze" onClick={() => props.inspect(refined)}>Подробнее</button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <p className="advice-action" data-testid="guidance-action">{refined?.action ?? step.action}</p>
        <p className="advice-basis" data-testid="guidance-basis">{band?.key === "criticalDeadline" ? "Наивысший приоритет. " :
          band && band.basis !== step.basis ? band.basis + " " : ""}{step.basis}</p>
        <button type="button" className="case-source" onClick={() => open(step.ticketId)}>{step.ticketId} ↗</button>
      </div>
      {props.groupAction}
    </section>
  );
}

function CaseDialog({
  record,
  step,
  dimension,
  query,
  ns,
  revision,
  csrf,
  canAnalyze,
  advice,
  close,
  open,
}: Props & { record: TriageCase; step: LiveStep; advice: Advice | null; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef({ record, query, revision });
  current.current = { record, query, revision };
  const [attempt, setAttempt] = useState(0);
  const scope = JSON.stringify([ns, query, record.hash, record.overdue, record.soon, step.key]);
  const [requested, setRequested] = useState(scope);
  const [reading, setReading] = useState<{ scope: string; result: CaseAnalysis } | null>(null);
  const result = reading?.scope === scope ? reading.result : null;
  const themes = [...(result?.semantic?.themes ?? []), ...(record.themes ?? [])];
  const [fault, setFault] = useState("");
  const [brief, setBrief] = useState("");
  const [copied, setCopied] = useState(false);
  const briefField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!canAnalyze || requested !== scope) return;
    const ac = new AbortController();
    const { record: input, query: filters, revision: rev } = current.current;
    setFault("");
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
        if (!ac.signal.aborted && !body.stale && body.inputHash === input.hash)
          setReading({ scope, result: body });
        else if (!ac.signal.aborted) setFault("Подборка изменилась. Обновите разбор.");
      })
      .catch((e) => {
        if (!ac.signal.aborted) setFault(e.message);
      });
    return () => ac.abort();
  }, [scope, requested, ns, csrf, canAnalyze, attempt]);
  const evidence = [step.evidence, ...(result?.evidence.length ? result.evidence : record.evidence)]
    .filter((e, i, all) => all.findIndex((other) => other.id === e.id && other.field === e.field) === i);
  const sourceIds = [
    record.topId,
    ...record.evidence.map((e) => e.id),
    ...evidence.map((e) => e.id),
  ];
  return (
    <dialog
      className="case-dialog"
      ref={dialog}
      aria-labelledby="case-dialog-title"
      onClose={close}
    >
      <div className="case-dialog-top">
        <span>Разбор группы</span>
        <button aria-label="Закрыть разбор" onClick={close}>
          ×
        </button>
      </div>
      <h2 id="case-dialog-title">{record.label}</h2>
      <p className="case-advice-origin">
        {advice?.model ? "Совет подготовлен VseLLM · " + advice.model : "Совет по полям ITSM"}
      </p>
      {!themes.length && <CaseExample
        record={record}
        dimension={dimension}
        open={(id) => {
          close();
          open(id);
        }}
      />}
      <button className="case-inline handoff-brief" type="button" onClick={() => {
        const band = record.responseRank === undefined ? undefined : responseBands[record.responseRank];
        const text = [record.label + ". Заявок в подборке: " + record.count + ".",
          band?.basis, "Срок прошёл у " + record.overdue + ", ближайшие 15 минут — у " + record.soon + ".",
          ...themes.slice(0, 2).map(theme => theme.label + " — " + theme.count + " из " + record.count + "."),
          "Первая проверка: " + step.ticketId + ". " + (advice?.action ?? step.action),
          "Подборка: " + (() => {
            const url = new URL(location.href);
            url.search = query;
            url.searchParams.set("case", record.id);
            return url.href;
          })()].filter(Boolean).join("\n");
        setBrief(text);
        setCopied(false);
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {
          briefField.current?.focus(); briefField.current?.select();
        });
      }}><Icon name="team" size={16} /> Сводка для передачи</button>
      {brief && <div className="handoff-text">
        <label>{copied ? "Сводка скопирована" : "Текст для передачи"}
          <textarea ref={briefField} readOnly rows={4} value={brief} onFocus={e => e.target.select()} />
        </label>
      </div>}
      <dl className="case-facts">
        <div>
          <dt>Инциденты</dt>
          <dd>{record.count}</dd>
        </div>
        <div>
          <dt>Срок прошёл</dt>
          <dd>{record.overdue}</dd>
        </div>
        <div>
          <dt>Устранение последствий</dt>
          <dd>{record.escalations}</dd>
        </div>
      </dl>
      {!!themes.length && (
        <section className="case-themes">
          <h3>Повторяющиеся проявления</h3>
          {themes.map(theme => (
            <div key={theme.label}>
              <p><strong>{theme.label}</strong> · {theme.count} из {record.count}</p>
              {theme.examples.map(e => <p key={e.id} className="case-theme-source">
                <button type="button" className="case-source" onClick={() => { close(); open(e.id); }}>{e.id} ↗</button>
                <span>«{e.value}»</span>
              </p>)}
              <p>{theme.check}</p>
            </div>
          ))}
          <small>Общую причину нужно проверить по истории и журналам этих заявок.</small>
          {result?.semantic && <p><small>VseLLM сопоставила дополнительные описания в выборке из {result.semantic.sampled} заявок.</small></p>}
        </section>
      )}
      {canAnalyze && requested !== scope && (
        <button className="case-inline" onClick={() => setRequested(scope)}>Обновить разбор группы</button>
      )}
      {canAnalyze && requested === scope && !result && !fault && (
        <Loader label="Сопоставляем описания инцидентов…" />
      )}
      {fault && requested === scope && (
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
      {result && (
        <section className="case-result">
          <h3>
            {result.mode === "model" ? "Вывод по группе" : "Сводка по полям"}
          </h3>
          {result.summary.filter((line) => line !== record.recommendation && !line.startsWith("Следующая проверка") &&
            !record.themes?.some(theme => line.startsWith("«" + theme.label + "» — "))).map((line, i) => (
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
              В выборке {result.sampled} из {record.count} инцидентов.
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
