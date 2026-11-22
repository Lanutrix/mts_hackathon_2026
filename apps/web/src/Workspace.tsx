import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CanvasGroup,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import FactBoard from "./FactBoard";
import AnswerInsightBoard from "./AnswerInsightBoard";
import ConversationAnswer from "./ConversationAnswer";
import { GuideAnswer } from "./GuideAnswer";
import { CanvasFigure } from "./CanvasFigure";
import { CanvasDrawer, canvasJson } from "./CanvasTickets";
import { TicketMentions } from "./IncidentSources";
import { formatCount, PageControls, useBox } from "./CanvasControls";
import Loader from "./Loader";
import "./workspace.css";
import "./answer.css";

type Props = {
  go?: (path: string) => void;
  ns: string;
  userKey: string;
  zone: string;
  csrf: string;
  canAsk: boolean;
  revision: number;
  open: (id: string) => void;
};
type Turn = { question: string; result: CanvasResult };
type Selection = {
  group: CanvasGroup | null;
  result: CanvasResult;
  offset: number;
};
type Conversation = {
  turns: Turn[];
  active: number;
  panel?: number;
  historyOpen?: boolean;
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
function panels(result: CanvasResult): CanvasResult[] {
  const { conversation, ...source } = result;
  const article = result.answer;
  const views: CanvasResult[] = [];
  if (conversation) {
    views.push({ ...source, title: conversation.title, conversation, answer: undefined, insights: undefined, total: 0, blocks: [] });
    if (!result.selection && !article) return views;
  }
  if (article) {
    views.push({
      ...source,
      insights: undefined,
      title: article.title,
      total: 0,
      blocks: [],
    });
    if (article.kind === "knowledge") return views;
  }
  const { answer: _article, insights, ...data } = source;
  if (insights?.length) views.push({ ...data, insights, blocks: [] });
  if (!insights?.length || result.intent.presentation) views.push(data);
  for (const block of result.blocks) {
    views.push({
      ...data,
      ...block,
      intent: {
        ...result.intent,
        groupBy: block.groupBy,
        layout: block.layout,
        weightBy: block.weightBy,
        presentation: block.presentation,
        exhibits: block.exhibits,
      },
      blocks: [],
    });
  }
  return views;
}

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

function GenerationStatus() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed =
    Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  return (
    <div className="cx-generation">
      <Loader label="Готовлю ответ" />
      <span className="cx-generation-trace" aria-hidden="true" />
      <span className="cx-generation-time" role="timer" aria-live="off">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.5 1.5" />
        </svg>
        <span className="sr-only">Время ожидания </span>
        <time dateTime={`PT${seconds}S`}>{elapsed}</time>
      </span>
    </div>
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
              <b>{result.provider}</b>
              {result.mode === "model" && (
                <span>
                  {result.conversation ? "Ответ в диалоге" : result.answer?.kind === "knowledge"
                    ? "Выбор раздела справки"
                    : "План запроса · расчёт по полям ITSM"}
                </span>
              )}
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
            {turns.length > 1 && (result.mode !== "unsupported" || result.conversation) && (
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
            {busy ? "Готовлю ответ" : "Читаю источник…"}
          </div>
        </article>
      )}
    </div>
  );
}

function HistoryDialog({
  children,
  close,
  reset,
}: {
  children: ReactNode;
  close: () => void;
  reset: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="cx-history"
      aria-labelledby="cx-history-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="cx-history-inner">
        <header>
          <h2 id="cx-history-title">История диалога</h2>
          <button
            type="button"
            className="cx-icon-button"
            aria-label="Закрыть историю"
            data-hint="Закрыть историю"
            onClick={close}
          >
            ×
          </button>
        </header>
        {children}
        <button type="button" className="cx-new" onClick={reset}>
          Новый диалог ↗
        </button>
      </div>
    </dialog>
  );
}

export default function Workspace(props: Props) {
  const identity = JSON.stringify([props.ns, props.userKey, props.csrf]);
  return <WorkspaceScreen key={identity} {...props} identity={identity} />;
}

function WorkspaceScreen({
  go,
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
  const stage = useBox();
  const historyOpen = !!chat.historyOpen;
  const setHistoryOpen = (historyOpen: boolean) =>
    setChat((c) => ({ ...c, historyOpen }));
  const activeRequest = useRef<AbortController | null>(null);
  const composer = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLElement>(null);
  const turn = chat.turns[chat.active];
  const result = turn?.result;
  const last = chat.turns.at(-1)?.result;

  useEffect(() => {
    const viewport = window.visualViewport;
    const input = composer.current,
      el = screen.current;
    if (!viewport || !input || !el) return;
    // Mobile browsers can resize only the visual viewport for the soft keyboard.
    const placeDock = () => {
      const occluded =
        document.activeElement === input && viewport.scale === 1
          ? Math.max(
              0,
              window.innerHeight - viewport.height - viewport.offsetTop,
            )
          : 0;
      el.style.setProperty("--cx-keyboard-gap", Math.round(occluded) + "px");
    };
    viewport.addEventListener("resize", placeDock);
    viewport.addEventListener("scroll", placeDock);
    input.addEventListener("focus", placeDock);
    input.addEventListener("blur", placeDock);
    return () => {
      viewport.removeEventListener("resize", placeDock);
      viewport.removeEventListener("scroll", placeDock);
      input.removeEventListener("focus", placeDock);
      input.removeEventListener("blur", placeDock);
    };
  }, []);

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
        ? { question, ...(result ? { context: result.intent, turnToken: result.turnToken } : {}) }
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
                ? { result: view, group, offset: selection?.offset ?? 0 }
                : null,
          };
        }
        const turns = [
          ...(operation === "reset" ? [] : previous.turns),
          { question, result: json },
        ];
        const active =
          json.mode === "unsupported" && !json.conversation && operation !== "reset"
            ? previous.active
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

  const stale =
    !!result &&
    (!result.conversation || !!result.selection) &&
    result.answer?.kind !== "knowledge" &&
    revision > result.revision;
  const views = useMemo(() => (result ? panels(result) : []), [result]);
  const switching =
    views.length > 1 &&
    (views.length > 3 ||
      (stage.width < 660 &&
        (result?.answer || result?.conversation || views.length > 2 || stage.height < 450)) ||
      stage.height < 245);
  const panel = Math.min(chat.panel ?? 0, Math.max(0, views.length - 1));
  const visible = switching ? views.slice(panel, panel + 1) : views;
  const choose = (view: CanvasResult, group: CanvasGroup | null) =>
    setChat((c) => ({ ...c, selection: { result: view, group, offset: 0 } }));
  const reply = last?.mode === "unsupported" && !last.conversation ? last.summary :
    result?.conversation && result.notice === result.conversation.text ? undefined : result?.notice;
  const loadingSource = busy === "";
  return (
    <section
      ref={screen}
      className="cx"
      aria-labelledby="cx-title"
      data-source={ns}
    >
      <h1 id="cx-title" className="sr-only">
        Холст смены
      </h1>
      <div className="cx-top" hidden={!stale && !result?.total}>
        {stale && (
          <button
            type="button"
            className="cx-refresh"
            onClick={() => void send("", "refresh")}
          >
            Обновить срез ↻
          </button>
        )}
        {result && result.total > 0 && (
          <button
            type="button"
            className="cx-scope"
            onClick={() => choose(result, null)}
          >
            {formatCount(result.total)} заявок ↗
          </button>
        )}
      </div>
      <div
        ref={stage.ref}
        className="cx-stage"
        data-count={visible.length}
        data-stacked={stage.width < 660}
        data-first={visible[0]?.intent.layout}
        aria-busy={busy !== null}
      >
        {visible.map((view, i) => (
          <section
            className="cx-plot"
            data-guide={!!view.answer}
            data-conversation={!!view.conversation || undefined}
            key={
              (switching ? panel : i) +
              ":" +
              view.intent.groupBy +
              ":" +
              (view.intent.presentation || view.intent.layout)
            }
            aria-label={
              i === 0
                ? "Визуализация среза"
                : "Дополнительный срез · " + view.title
            }
          >
            <div className="cx-plot-title">
              <h2
                className={view.insights?.length ? "sr-only" : undefined}
                title={view.title}
              >
                {view.title}
              </h2>
              {switching && (
                <PageControls
                  page={panel}
                  pages={views.length}
                  goto={(panel) => setChat((c) => ({ ...c, panel }))}
                  label="Представления холста"
                />
              )}
            </div>
            {view.fact ? (
              <FactBoard result={view} choose={(g) => choose(view,g)} {...{ ns, open }} />
            ) : view.conversation ? (
              <ConversationAnswer key={view.conversation.text} answer={view.conversation}
                canAsk={canAsk && busy === null} ask={(question) => void send(question)} />
            ) : view.answer ? (
              <GuideAnswer
                key={view.answer.topic + view.answer.lead}
                answer={view.answer}
                ns={ns}
                go={go}
              />
            ) : view.insights?.length ? (
              <AnswerInsightBoard
                insights={view.insights}
                ns={ns}
                open={open}
              />
            ) : (
              <CanvasFigure
                result={view}
                choose={(g) => choose(view, g)}
                {...{ ns, zone, open }}
              />
            )}
          </section>
        ))}
        {!visible.length && !busy && (
          <div className="cx-empty">
            <p role="status">{loadingSource ? "Читаю источник…" : "Срез ещё не загружен"}</p>
            {busy === null && !error && (
              <button onClick={() => void send("")}>Загрузить срез</button>
            )}
          </div>
        )}
      </div>
      <div className="cx-dock" data-generating={!!busy}>
        <div className="cx-status">
          {error ? (
            <div role="alert">
              {error.message}{" "}
              <button
                onClick={() => void send(error.question, error.operation)}
              >
                Повторить запрос
              </button>
            </div>
          ) : busy ? (
            <GenerationStatus key={busy} />
          ) : loadingSource ? (
            visible.length > 0 && <span role="status">Читаю источник…</span>
          ) : !canAsk ? (
            <span>Режим просмотра</span>
          ) : reply ? (
            <button
              type="button"
              className="cx-latest"
              title={reply}
              onClick={() => setHistoryOpen(true)}
            >
              {result?.mode === "fallback" && last?.mode !== "unsupported"
                ? "Локальный расчёт · подробнее"
                : reply}
            </button>
          ) : null}
        </div>
        <div className="cx-dock-row">
          <button
            className="cx-history-trigger"
            data-hint="История диалога"
            aria-label="История диалога"
            aria-haspopup="dialog"
            type="button"
            onClick={() => setHistoryOpen(true)}
          >
            <svg
              aria-hidden="true"
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2" />
            </svg>
          </button>
          <form
            className="cx-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy === null && chat.draft.trim()) void send(chat.draft);
            }}
          >
            <input
              type="text"
              autoComplete="off"
              aria-label="Вопрос об инцидентах"
              disabled={!canAsk}
              maxLength={500}
              ref={composer}
              placeholder={
                canAsk
                  ? "Спросите об инцидентах…"
                  : "Вопросы доступны координаторам"
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
                data-hint="Остановить запрос"
                onClick={(e) => {
                  e.preventDefault();
                  cancel();
                }}
              >
                <i className="cx-stop" />
              </button>
            ) : (
              <button
                key="send"
                type="submit"
                className="cx-send"
                aria-label="Отправить вопрос"
                data-hint="Отправить вопрос"
                disabled={!canAsk || !chat.draft.trim()}
              >
                <SendIcon />
              </button>
            )}
          </form>
        </div>
      </div>
      {historyOpen && (
        <HistoryDialog
          close={() => setHistoryOpen(false)}
          reset={() => {
            setHistoryOpen(false);
            setChat(emptyConversation());
            void send("", "reset");
            composer.current?.focus();
          }}
        >
          <ConversationLog
            turns={chat.turns}
            active={chat.active}
            activate={(active) => {
              setChat((c) => ({ ...c, active, panel: 0, selection: null }));
              setHistoryOpen(false);
            }}
            {...{ open, ns, busy }}
          />
        </HistoryDialog>
      )}
      {chat.selection && (
        <CanvasDrawer
          key={chat.selection.result.selection + chat.selection.group?.key}
          group={chat.selection.group}
          result={chat.selection.result}
          offset={chat.selection.offset}
          setOffset={(offset) =>
            setChat((c) =>
              c.selection ? { ...c, selection: { ...c.selection, offset } } : c,
            )
          }
          close={() => setChat((c) => ({ ...c, selection: null }))}
          refresh={() => void send("", "refresh")}
          {...{ ns, zone, open }}
        />
      )}
    </section>
  );
}
