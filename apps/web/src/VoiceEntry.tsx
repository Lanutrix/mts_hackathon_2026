import { useEffect, useRef, useState } from "react";
import { Icon } from "./Brand";
import { recordVoice } from "./recordVoice";

type Phase = "idle" | "consent" | "permission" | "recording" | "processing";
type Props = { csrf: string; ns: string; append: (text: string) => void };

function message(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Разрешите микрофон в настройках сайта.";
    if (error.name === "NotFoundError") return "Микрофон не найден. Проверьте подключение.";
    if (error.name === "NotReadableError") return "Микрофон занят или недоступен.";
    if (error.name === "EncodingError") return "Не удалось прочитать запись. Попробуйте ещё раз.";
  }
  return error instanceof Error ? error.message : "Не удалось распознать речь. Попробуйте ещё раз.";
}

export default function VoiceEntry({ csrf, ns, append }: Props) {
  const session = useRef<AbortController | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const mic = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => () => { session.current?.abort(); }, []);
  useEffect(() => { if (phase === "consent") confirm.current?.focus(); }, [phase]);

  function cancel() {
    session.current?.abort();
    session.current = null;
    stop.current = null;
    setPhase("idle");
    setError("");
    mic.current?.focus();
  }

  async function start() {
    if (session.current) return;
    const controller = new AbortController();
    session.current = controller;
    setPhase("permission");
    setError("");
    try {
      const audio = await recordVoice(controller.signal, finish => {
        stop.current = finish;
        setPhase("recording");
        mic.current?.focus();
      });
      controller.signal.throwIfAborted();
      stop.current = null;
      setPhase("processing");
      const response = await fetch("/api/voice?ns=" + encodeURIComponent(ns), {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "audio/wav", "X-CSRF-Token": csrf }, body: audio,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 429 ? "Слишком много запросов. Попробуйте через минуту."
        : data.message || "Сервис распознавания недоступен.");
      controller.signal.throwIfAborted();
      if (typeof data.text !== "string" || !data.text.trim()) throw new Error("Речь не распознана.");
      append(data.text);
    } catch (problem) {
      if (!controller.signal.aborted) setError(message(problem));
    } finally {
      if (session.current === controller && !controller.signal.aborted) {
        session.current = null;
        stop.current = null;
        setPhase("idle");
      }
    }
  }

  const recording = phase === "recording";
  const label = recording ? "Завершить диктовку" : "Продиктовать вопрос";
  const status = {
    idle: error, consent: "Запись до 30 секунд будет передана во внешнюю службу распознавания. Текст появится в поле вопроса.",
    permission: "Разрешите браузеру доступ к микрофону.",
    recording: "Идёт запись. Нажмите микрофон, чтобы распознать вопрос.",
    processing: "Распознаю речь…",
  }[phase];
  return <div className="cx-voice" onKeyDown={e => {
    if (e.key === "Escape" && phase !== "idle") { e.stopPropagation(); cancel(); }
  }}>
    <button type="button" ref={mic} aria-label={label} data-hint={label} aria-pressed={recording}
      disabled={phase === "permission" || phase === "processing"} onClick={() => {
        if (recording) { setPhase("processing"); stop.current?.(); }
        else if (phase === "consent") cancel();
        else { setError(""); setPhase("consent"); }
      }}>
      <Icon name="microphone" size={21} />
    </button>
    {status && <div className="cx-voice-status">
      <span role="status">{status}</span>
      {phase !== "idle" && <div className="cx-voice-actions">
        {phase === "consent" && <button type="button" ref={confirm} onClick={() => void start()}>Начать запись</button>}
        <button type="button" onClick={cancel} aria-label="Отменить запись">Отмена</button>
      </div>}
    </div>}
  </div>;
}
