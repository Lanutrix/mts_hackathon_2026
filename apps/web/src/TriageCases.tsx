import { useEffect, useRef, useState } from "react";
import type { CaseAnalysis, TriageCase } from "../../../packages/domain/triage";
import type { LiveStep } from "../../../packages/domain/liveStep";
import Loader from "./Loader";
import { Icon, Mark } from "./Brand";
import { fieldName, TicketMentions } from "./IncidentSources";
import { screenLink } from "./routes";

import { responseBands } from "../../../packages/domain/responseOrder";

type Check = { record: TriageCase; step: LiveStep };

function caseCriterion(record: TriageCase, dimension: string) {
  if (dimension === "semantic" || dimension === "symptom" || dimension === "symptomProduct") {
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
    ["semantic", "symptom", "symptomProduct"].includes(dimension) ? record.evidence[0]?.value : record.label;
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
  const [inspection, setInspection] = useState<{ record: TriageCase; step: LiveStep; query: string; advice: Advice | null; dimension: string } | null>(null);
  const focus = chosen ?? cases.find((item) => item.id === props.liveFocus?.caseId) ?? cases[0];
  const step = (!chosen && props.liveFocus?.caseId === focus?.id ? props.liveFocus?.step : null) ?? focus?.step;
  const band = focus?.responseRank === undefined ? undefined : responseBands[focus.responseRank];
  const inspected = inspection?.query === props.query ? cases.find(item => item.id === inspection.record.id) : undefined;
  const inspectedStep = inspected && (inspected.id === focus?.id ? step : inspected.step);
  useEffect(() => {
    if (inspection && !inspected) setInspection(null);
  }, [inspection, inspected]);
  const [expanded, setExpanded] = useState(false);
  const visibleCases = expanded ? cases : cases.slice(0, 6);
  if (chosen && !visibleCases.includes(chosen)) visibleCases.push(chosen);
  const modeled = cases.filter(item => item.origin === "model").length;
  const pick = (id: string) => {
    setParam("case", id);
  };
  return (
    <aside className="case-lens" aria-label="Группировка и разбор инцидентов">
      <div className="case-groups-heading">
        <h2>Группы инцидентов</h2>
        {dimension === "semantic" && <small>{modeled === 0 ? "По описаниям" :
          modeled === cases.length ? "VseLLM" : "VseLLM и локальный разбор"}</small>}
      </div>
      <div className="case-group-options" role="group" aria-label="Выбрать группу">
        <button type="button" aria-pressed={!chosen} onClick={() => pick("")}>
          <Icon name="queue" size={17} /><span>Все инциденты</span><b>{amount}</b>
        </button>
        {visibleCases.map(item => (
          <button type="button" key={item.id} aria-pressed={item.id === chosen?.id} onClick={() => pick(item.id)}>
            <Icon name={item.icon ?? "relation"} size={17} /><span>{item.label}</span><b>{item.count}</b>
          </button>
        ))}
      </div>
      {cases.length > 6 && <button type="button" className="more-cases" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? "Свернуть группы" : "Все группы · " + cases.length}</button>}
      {props.ready && focus && step && (
        <LiveAdvice key={JSON.stringify([props.query, focus.id, step.key])} {...props} record={focus} step={step}
          inspect={advice => setInspection({ record: focus, step, query: props.query, advice, dimension })}
          groupAction={band && !chosen && focus.count > 1 ?
            <button type="button" className="response-open" onClick={() => pick(focus.id)}>
              Разобрать группу <b>{focus.count}</b>
            </button> : band && chosen && chosen.count > 1 ?
            <button type="button" className="response-open" onClick={() => setParam("breakdown", band.key)}>
              По симптомам и продуктам
            </button> : null} />
      )}
      {inspection && inspected && inspectedStep && (
        <CaseDialog {...props} {...inspection} record={inspected}
          step={inspectedStep} revision={inspected.revision}
          advice={inspectedStep.key === inspection.step.key && inspected.hash === inspection.record.hash ? inspection.advice : null}
          close={() => setInspection(null)} />
      )}
    </aside>
  );
}

type Advice = { key: string; action: string; mode: "model"; text: string; model: string };
type LocalAdvice = { key: string; mode: "local"; reason?: "unconfigured" | "unavailable" | "unverified"; retryAfterMs?: number };
type AdviceState = { status: "pending" } | { status: "failed"; message: string } | { status: "ready"; advice: Advice };

function LiveAdvice(props: Props & Check & {
  inspect: (advice: Advice | null) => void;
  groupAction: React.ReactNode;
}) {
  const {record, step, query, ns, runId, revision, csrf, canAnalyze, modelGuidance, open} = props;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AdviceState>({status: "pending"});
  const [online, setOnline] = useState(() => navigator.onLine);
  const latestRequest = useRef("");
  latestRequest.current = caseRequest(record, query, ns, revision, true);
  const retryAt = useRef(0);
  useEffect(() => {
    const sync = () => {
      retryAt.current = 0;
      setState({status: "pending"});
      setOnline(navigator.onLine);
    };
    window.addEventListener("offline", sync);
    window.addEventListener("online", sync);
    return () => { window.removeEventListener("offline", sync); window.removeEventListener("online", sync); };
  }, []);
  const enabled = online && canAnalyze && (modelGuidance || attempt > 0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const request = async (allowRetry: boolean) => {
      if (disposed) return;
      setState({status: "pending"});
      const deadline = AbortSignal.timeout(35_000);
      const signal = AbortSignal.any([controller.signal, deadline]);
      try {
        const response = await fetch(latestRequest.current, {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
          body: JSON.stringify({ purpose: "liveStep", decisionKey: step.key, ticketId: step.ticketId, runId }),
        });
        if (disposed) return;
        if (!response.ok) {
          const stale = response.status === 409;
          setState({status: "failed", message: stale ? "Данные заявки изменились." :
            response.status === 429 ? "Помощник обрабатывает другие запросы." : "Сервис ИИ не ответил."});
          if (allowRetry && (stale || response.status === 429)) {
            const delay = stale ? 1200 : Number(response.headers.get("retry-after") || 60) * 1000;
            retryAt.current = Date.now() + delay;
            timer = setTimeout(() => void request(false), delay);
          }
          return;
        }
        const result: Advice | LocalAdvice = await response.json();
        if (disposed) return;
        if (result.key === step.key && result.mode === "model" && result.text?.trim()) {
          setState({status: "ready", advice: result});
          return;
        }
        const local = result.mode === "local" && result.key === step.key ? result : null;
        setState({status: "failed", message: local?.reason === "unconfigured" ? "Сервис ИИ не подключён." :
          local?.reason === "unavailable" ? "Сервис ИИ сейчас недоступен." : "Не удалось подтвердить ответ ИИ по данным заявки."});
        if (local?.retryAfterMs) {
          retryAt.current = Date.now() + local.retryAfterMs;
          if (allowRetry) timer = setTimeout(() => void request(false), local.retryAfterMs);
        }
      } catch {
        if (!disposed) setState({status: "failed", message: deadline.aborted ?
          "Истекло время ожидания ответа ИИ." : "Не удалось связаться с сервисом ИИ."});
      }
    };
    timer = setTimeout(() => void request(true), Math.max(350, retryAt.current - Date.now()));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [enabled, attempt, csrf, runId, step.key, step.ticketId]);
  const result: AdviceState = enabled ? state : {status: "failed", message: !online ?
    "Нет подключения к сети." : canAnalyze ? "Сервис ИИ не подключён." : "Совет ИИ доступен координатору."};
  const advice = result.status === "ready" ? result.advice : null;
  return (
    <section className="live-advice" aria-labelledby="live-advice-title" data-testid="live-guidance"
      data-origin={advice ? "model" : result.status}>
      <div className="advice-head">
        <h3 id="live-advice-title"><Mark />Совет ИИ</h3>
        <button type="button" className="case-analyze" onClick={event => {
          event.currentTarget.focus({preventScroll: true});
          props.inspect(advice);
        }}>Подробнее <span aria-hidden="true">↗</span></button>
      </div>
      <p className="advice-group"><Icon name={record.icon ?? "relation"} size={15} />{record.label}</p>
      {result.status === "pending" ? <Loader label="Готовим совет по заявке…" /> :
        result.status === "failed" ? <div className="advice-status">
          <span role="status">{result.message}</span>
          {canAnalyze && <button type="button" onClick={() => {
            setOnline(navigator.onLine); setState({status: "pending"}); setAttempt(n => n + 1);
          }}>Повторить</button>}
        </div> : <p className="advice-action" data-testid="guidance-action" aria-live="polite">{result.advice.text}</p>}
      <div className="advice-source">
        <span>{step.ticketId}</span>
        <a className="case-source" href={screenLink("/incident/" + encodeURIComponent(step.ticketId), ns)}
          aria-label={"Открыть заявку " + step.ticketId} onClick={event => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            open(step.ticketId);
          }}>Открыть заявку</a>
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
  const themes = [...(result?.semantic?.themes ?? []), ...(record.themes ?? [])]
    .filter((theme, index, all) => all.findIndex(other => other.label === theme.label) === index);
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
      <header className="case-dialog-header">
        <div className="case-dialog-top">
          <span><Mark />Разбор группы</span>
          <button type="button" aria-label="Закрыть разбор" onClick={() => dialog.current?.close()}>
            Закрыть <span aria-hidden="true">×</span>
          </button>
        </div>
        <h2 id="case-dialog-title">{record.icon && <Icon name={record.icon} size={24} />}{record.label}</h2>
      </header>
      <div className="case-dialog-body">
        <dl className="case-facts">
          <div><dt><Icon name="quantity" size={16} />Инциденты</dt><dd>{record.count}</dd></div>
          <div data-alert={record.overdue > 0}><dt><Icon name="clock" size={16} />Срок прошёл</dt><dd>{record.overdue}</dd></div>
          <div><dt><Icon name="duration" size={16} />Срок до 15 мин</dt><dd>{record.soon}</dd></div>
          <div><dt><Icon name="escalation" size={16} />Устранение последствий</dt><dd>{record.escalations}</dd></div>
        </dl>
        <section className="case-next">
          <h3><Icon name="research" size={18} />{advice ? "Совет ИИ" : "Первая проверка"}</h3>
          <p>{advice?.text ?? step.action}</p>
          <button type="button" className="case-source" onClick={() => { close(); open(step.ticketId); }}>{step.ticketId} ↗</button>
          {advice && <small className="case-advice-origin">VseLLM · {advice.model}</small>}
        </section>
      {!themes.length && <CaseExample
        record={record}
        dimension={dimension}
        open={(id) => {
          close();
          open(id);
        }}
      />}
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
      </div>
      <footer className="case-dialog-footer">
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
      </footer>
    </dialog>
  );
}
