import { useEffect, useRef, useState } from "react";
import type { DispatchSuggestions } from "../../server/dispatchSuggestions";
import { Icon } from "./Brand";

type Props = {
  endpoint: string;
  snapshot: string;
  csrf: string;
  team?: string;
} & (
  | { kind: "teams"; chooseTeam: (team: string) => void }
  | { kind: "comments"; hasNote: boolean; insert: (text: string) => void }
);

export default function DispatchHints(props: Props) {
  const [result, setResult] = useState<DispatchSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function suggest() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(true);
    try {
      const response = await fetch(props.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": props.csrf },
        body: JSON.stringify({ snapshot: props.snapshot, team: props.team }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Подсказки недоступны. Повторите запрос.");
      if (body.snapshot !== props.snapshot) throw new Error("Данные изменились. Повторите запрос для текущей выгрузки.");
      if (!controller.signal.aborted) setResult(body);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = null;
    }
  }
  return <div className="dispatch-hints">
    <button type="button" className="dispatch-hint-trigger" disabled={busy}
      onClick={() => result ? setResult(null) : void suggest()}>
      <Icon name="layers" size={15} />
      {busy ? "Готовим подсказки…" : result ? "Скрыть подсказки" :
        props.kind === "teams" ? "Предложить команду решения" : "Предложить комментарий"}
    </button>
    {error && <p role="alert">{error}</p>}
    {result && <div className="dispatch-hint-results">
      <small role="status">{result.mode === "model" ? "Подсказки ИИ" : "Подсказки по данным выгрузки"}</small>
      {props.kind === "teams" ? <>
        {result.teams.length === 0 && <p>Похожих инцидентов недостаточно для выбора команды.</p>}
        {result.teams.map(({ name, reason }) => <div key={name} className="dispatch-hint-result">
          <strong>{name}</strong>
          <p>{reason}</p>
          <button type="button" className="dispatch-inline" aria-label={"Выбрать команду " + name}
            onClick={() => { props.chooseTeam(name); setResult(null); }}>Выбрать команду</button>
        </div>)}
      </> : <>
        {result.comments.length === 0 && <p>Для этого инцидента нет черновиков.</p>}
        {result.comments.map(({ label, text }) => <div key={label + text} role="group" aria-label={label} className="dispatch-hint-result">
          <strong>{label}</strong>
          <p>{text}</p>
          <button type="button" className="dispatch-inline" onClick={() => { props.insert(text); setResult(null); }}>
            {props.hasNote ? "Заменить комментарий" : "Вставить комментарий"}
          </button>
        </div>)}
      </>}
    </div>}
  </div>;
}
