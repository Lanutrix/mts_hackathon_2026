import { useEffect, useRef, useState } from "react";
import type {
  CanvasGroup,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import { CanvasFigure } from "./CanvasFigure";
import { CanvasDrawer, canvasJson } from "./CanvasTickets";
import { TicketMentions } from "./IncidentSources";
import { screenLink } from "./routes";
import "./workspace.css";

type Props = {
  ns: string;
  userKey: string;
  zone: string;
  csrf: string;
  canAsk: boolean;
  revision: number;
  open: (id: string) => void;
};
type Turn = { question: string; result: CanvasResult };
type Selection = { group: CanvasGroup | null; result: CanvasResult };
type Conversation = {
  turns: Turn[];
  active: number;
  draft: string;
  selection: Selection | null;
};
type Operation = "ask" | "reset" | "refresh";
const emptyConversation = (): Conversation => ({
  turns: [],
  active: 0,
  draft: "",
  selection: null,
});
// Ticket navigation remounts this screen. Keep a short, session-scoped history in tab memory.
const conversations = new Map<string, Conversation>();
const sources: Record<string, string> = {
  demo: "Демо-данные",
  original: "Оригинал",
  workspace: "Рабочая копия",
  simulation: "Учебный эфир",
};
const initialSuggestions = [
  "Сгруппируй по командам",
  "Покажи сроки",
  "Сравни приоритеты",
];
const labels: Record<string, string> = {
  symptom: "Атлас симптомов",
  team: "Нагрузка команд",
  product: "Продукты",
  priority: "Приоритеты",
  deadline: "Окна сроков",
  status: "Статусы",
  escalation: "Эскалации",
  ticket: "Инциденты",
};
const displayCount = (n: number) => n.toLocaleString("ru-RU");
const panels = (result: CanvasResult) => [
  result,
  ...result.blocks.map(
    (block): CanvasResult => ({
      ...result,
      ...block,
      intent: {
        ...result.intent,
        groupBy: block.groupBy,
        layout: block.layout,
      },
      blocks: [],
    }),
  ),
];

function Spark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 2.3c.7 5.6 3.1 8.1 9 9.5-5.7.9-8.3 3.6-9.4 9.7-.8-6-3.3-8.5-9-9.7 6-1.1 8.5-3.7 9.4-9.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}
function SourceMode({ result }: { result: CanvasResult }) {
  return (
    <span className="cx-mode">
      {result.mode === "model"
        ? result.model || result.provider || "ИИ"
        : result.mode === "unsupported"
          ? "Уточнение"
          : "По полям источника"}
    </span>
  );
}

function ConversationLog({
  turns,
  active,
  activate,
  open,
  ns,
  busy,
}: {
  turns: Turn[];
  active: number;
  activate: (i: number) => void;
  open: Props["open"];
  ns: string;
  busy: string | null;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);
  return (
    <div
      className="cx-log"
      ref={scroll}
      aria-label="Сообщения диалога"
      role="log"
      aria-live="polite"
      tabIndex={0}
    >
      {turns.map(({ question, result }, index) => (
        <article className="cx-turn" key={index}>
          {question && (
            <p className="cx-question">
              <span className="sr-only">Вы спросили. </span>
              {question}
            </p>
          )}
          <div className="cx-answer">
            <div className="cx-author">
              <span className="cx-assistant-icon">
                <Spark size={15} />
              </span>
              <b>Срез</b>
              <SourceMode result={result} />
            </div>
            <p>
              <TicketMentions
                text={result.summary}
                ids={result.tickets.map((t) => t.id)}
                {...{ ns, open }}
              />
            </p>
            {result.notice && result.notice !== result.summary && (
              <small>{result.notice}</small>
            )}
            {turns.length > 1 && result.mode !== "unsupported" && (
              <button
                className="cx-transcript-view"
                type="button"
                aria-pressed={active === index}
                onClick={() => activate(index)}
              >
                {active === index ? "На холсте" : "Открыть этот срез"}{" "}
                <span aria-hidden="true">{active === index ? "●" : "↗"}</span>
              </button>
            )}
          </div>
        </article>
      ))}
      {busy !== null && (
        <article className="cx-turn">
          {busy && <p className="cx-question">{busy}</p>}
          <div className="cx-thinking">
            <Spark size={16} />
            {busy ? "Собираю срез…" : "Читаю источник…"}
          </div>
        </article>
      )}
    </div>
  );
}

export default function Workspace(props: Props) {
  const identity = JSON.stringify([props.ns, props.userKey, props.csrf]);
  return <WorkspaceScreen key={identity} {...props} identity={identity} />;
}

function WorkspaceScreen({
  ns,
  zone,
  csrf,
  canAsk,
  revision,
  open,
  identity,
}: Props & { identity: string }) {
  const [chat, setChat] = useState<Conversation>(
    () => conversations.get(identity) ?? emptyConversation(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{
    message: string;
    question: string;
    operation: Operation;
  } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const composer = useRef<HTMLInputElement>(null);
  const turn = chat.turns[chat.active];
  const result = turn?.result;
  const last = chat.turns.at(-1)?.result;

  useEffect(() => {
    conversations.set(identity, chat);
    if (conversations.size > 12)
      conversations.delete(conversations.keys().next().value!);
  }, [identity, chat]);
  useEffect(() => {
    if (!conversations.get(identity)?.turns.length) void send("");
    return () => activeRequest.current?.abort();
    // A changing source revision should never replay someone's question.
  }, [identity]);

  async function send(input: string, operation: Operation = "ask") {
    const question = input.trim();
    if (question && !canAsk) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(question);
    setError(null);
    const refresh = operation === "refresh";
    const requestedTurn = chat.active;
    const selection = chat.selection;
    const submittedDraft = chat.draft;
    if (refresh) setChat((c) => ({ ...c, selection: null }));
    try {
      const body = question
        ? { question, ...(result ? { context: result.intent } : {}) }
        : refresh && canAsk && result
          ? { refresh: true, context: result.intent }
          : undefined;
      const json = await canvasJson<CanvasResult>(
        "/api/canvas?ns=" + encodeURIComponent(ns),
        {
          signal: controller.signal,
          method: body ? "POST" : "GET",
          ...(body
            ? {
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf,
                },
                body: JSON.stringify(body),
              }
            : {}),
        },
      );
      if (controller.signal.aborted || json.namespace !== ns) return;
      setChat((previous) => {
        if (refresh && previous.turns[requestedTurn]) {
          const turns = previous.turns.map((entry, i) =>
            i === requestedTurn ? { ...entry, result: json } : entry,
          );
          const view =
            selection &&
            panels(json).find(
              (panel) =>
                panel.intent.groupBy === selection.result.intent.groupBy &&
                panel.intent.layout === selection.result.intent.layout,
            );
          const group =
            view?.groups.find((item) => item.key === selection?.group?.key) ??
            null;
          return {
            ...previous,
            turns,
            active: requestedTurn,
            selection:
              view && (group || !selection?.group)
                ? { result: view, group }
                : null,
          };
        }
        const turns = [
          ...(operation === "reset" ? [] : previous.turns),
          { question, result: json },
        ].slice(-24);
        const active =
          json.mode === "unsupported" && operation !== "reset"
            ? Math.max(
                0,
                previous.active - (previous.turns.length === 24 ? 1 : 0),
              )
            : turns.length - 1;
        return {
          turns,
          active: Math.max(0, active),
          draft: previous.draft === submittedDraft ? "" : previous.draft,
          selection: null,
        };
      });
    } catch (err) {
      if (!controller.signal.aborted)
        setError({
          question,
          operation,
          message:
            err instanceof Error
              ? err.message
              : "Не удалось связаться с источником.",
        });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(null);
      }
    }
  }

  function cancel() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    if (busy) setChat((c) => ({ ...c, draft: c.draft || busy }));
    setBusy(null);
    composer.current?.focus();
  }
  const initial =
    !last || (chat.turns.length === 1 && last.mode === "snapshot");
  const suggestions = initial
    ? [
        "Сгруппируй по командам и рядом покажи сроки",
        "Покажи просроченные",
        "Сравни приоритеты",
      ]
    : last.suggestions.length
      ? last.suggestions.slice(0, 3)
      : initialSuggestions;
  const stale = !!result && revision > result.revision;
  const stamp =
    result &&
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(result.asOf));
  const views = result ? panels(result) : [];

  return (
    <section className="cx" aria-labelledby="cx-title" data-source={ns}>
      <div className="cx-intro">
        <div className="cx-heading">
          <div className="cx-source">
            <i aria-hidden="true" />
            {sources[ns] || ns}
            {stamp && (
              <>
                <span> / </span>срез на {stamp} {zone === "UTC" ? "UTC" : "МСК"}
              </>
            )}
          </div>
          <h1 id="cx-title">Холст смены</h1>
        </div>
        <div className="cx-command">
          <form
            className="cx-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (chat.draft.trim()) void send(chat.draft);
            }}
          >
            <span className="cx-compose-spark">
              <Spark size={22} />
            </span>
            <input
              ref={composer}
              type="text"
              autoComplete="off"
              maxLength={500}
              disabled={!canAsk}
              aria-label="Вопрос об инцидентах"
              placeholder={
                canAsk ? "Спросите об инцидентах…" : "Режим просмотра"
              }
              value={chat.draft}
              onChange={(e) => {
                const draft = e.currentTarget.value;
                setChat((c) => ({ ...c, draft }));
              }}
            />
            {busy !== null ? (
              <button
                key="stop"
                type="button"
                className="cx-send"
                aria-label="Остановить запрос"
                onClick={(event) => {
                  event.preventDefault();
                  cancel();
                }}
              >
                <i className="cx-stop" />
              </button>
            ) : (
              <button
                key="submit"
                type="submit"
                className="cx-send"
                disabled={!canAsk || !chat.draft.trim()}
                aria-label="Отправить вопрос"
              >
                <SendIcon />
              </button>
            )}
          </form>
          {canAsk ? (
            <div
              className="cx-prompts"
              aria-label="Предложенные вопросы"
              role="group"
            >
              {suggestions.map((q, index) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  title={q}
                >
                  {initial
                    ? [
                        "Команды и сроки",
                        "Просроченные",
                        "Сравнить приоритеты",
                      ][index]
                    : q}{" "}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="cx-note">
              Вопросы по этому источнику доступны координаторам.
            </p>
          )}
          {error && (
            <div className="cx-error" role="alert">
              {error.message}
              <button
                onClick={() => void send(error.question, error.operation)}
              >
                Повторить запрос
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className="cx-layout"
        data-compound={views.length > 1}
        data-answered={chat.turns.some((entry) => !!entry.question)}
      >
        {(views.length ? views : [null]).map((view, index) => {
          const choose = (group: CanvasGroup | null) => {
            if (view)
              setChat((c) => ({ ...c, selection: { group, result: view } }));
          };
          return (
            <section
              key={index}
              className="cx-board"
              data-secondary={index > 0}
              aria-label={
                index
                  ? "Дополнительный срез · " + view?.title
                  : "Визуализация среза"
              }
              aria-busy={busy !== null}
            >
              <header className="cx-board-head">
                <div className="cx-board-caption">
                  <i aria-hidden="true" />
                  {view?.intent.layout === "comparison"
                    ? "Сравнение"
                    : view?.intent.layout === "list"
                      ? "Реестр"
                      : view?.intent.groupBy === "symptom"
                        ? "Карта симптомов"
                        : view?.intent.groupBy === "deadline"
                          ? "Временные окна"
                          : "Распределение"}
                </div>
                {view && (
                  <span className="cx-revision">Версия {view.revision}</span>
                )}
              </header>
              {view ? (
                <div key={view.selection} className="cx-view">
                  <div className="cx-view-title">
                    <h2>{view.title || labels[view.intent.groupBy]}</h2>
                    <button
                      className="cx-view-total"
                      title="Открыть все инциденты"
                      onClick={() => choose(null)}
                      disabled={!view.total}
                    >
                      <b>{displayCount(view.total)}</b>
                      <span>в выборке ↗</span>
                    </button>
                  </div>
                  <CanvasFigure result={view} {...{ choose, ns, open, zone }} />
                </div>
              ) : (
                <div className="cx-board-empty">
                  <div className="cx-ghost" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <p role="status">
                    {busy !== null ? "Открываем срез…" : "Срез ещё не загружен"}
                  </p>
                  {busy === null && !error && (
                    <button onClick={() => void send("")}>
                      Загрузить срез
                    </button>
                  )}
                </div>
              )}
              {!index && stale && (
                <div className="cx-stale">
                  <span>Есть новая версия источника</span>
                  <button onClick={() => void send("", "refresh")}>
                    Обновить срез ↗
                  </button>
                </div>
              )}
            </section>
          );
        })}
        <section className="cx-dialogue" aria-labelledby="cx-dialogue-title">
          <header>
            <div>
              <span className="cx-chat-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 3.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
                </svg>
              </span>
              <h2 id="cx-dialogue-title">Диалог</h2>
            </div>
            <button
              type="button"
              className="cx-reset"
              disabled={!chat.turns.length && !chat.draft}
              onClick={() => {
                setChat(emptyConversation());
                setError(null);
                void send("", "reset");
                composer.current?.focus();
              }}
            >
              <span aria-hidden="true">↺</span> Новый диалог
            </button>
          </header>
          <ConversationLog
            turns={chat.turns}
            active={chat.active}
            activate={(active) =>
              setChat((c) => ({ ...c, active, selection: null }))
            }
            {...{ open, ns, busy }}
          />
          {result && result.metrics.length > 0 && (
            <div className="cx-facts">
              <dl>
                {result.metrics
                  .filter((metric) => metric.key !== "total")
                  .map((metric) => (
                    <div key={metric.key}>
                      <dt>{metric.label}</dt>
                      <dd>{displayCount(metric.value)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          {result &&
            !result.blocks.length &&
            result.intent.layout !== "list" &&
            result.tickets.length > 0 && (
              <div className="cx-evidence">
                <h3>Карточки в срезе</h3>
                {result.tickets.slice(0, 2).map((ticket) => (
                  <a
                    key={ticket.id}
                    href={screenLink(
                      "/incident/" + encodeURIComponent(ticket.id),
                      ns,
                    )}
                    onClick={(e) => {
                      if (
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.altKey &&
                        !e.shiftKey
                      ) {
                        e.preventDefault();
                        open(ticket.id);
                      }
                    }}
                  >
                    <span>{ticket.id}</span>
                    <b>{ticket.header}</b>
                    <i aria-hidden="true">↗</i>
                  </a>
                ))}
              </div>
            )}
        </section>
      </div>
      {chat.selection && (
        <CanvasDrawer
          key={chat.selection.result.selection + chat.selection.group?.key}
          group={chat.selection.group}
          result={chat.selection.result}
          refresh={() => void send("", "refresh")}
          close={() => setChat((c) => ({ ...c, selection: null }))}
          {...{ ns, zone, open }}
        />
      )}
    </section>
  );
}
