import { useEffect, useRef, useState } from "react";
import { Icon } from "./Brand";

type Utterance = { isFinal: boolean; 0: { transcript: string } };
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<Utterance> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognizer;
  webkitSpeechRecognition?: new () => Recognizer;
};
const notices: Record<string, string> = {
  "not-allowed": "Разрешите микрофон в настройках сайта.",
  "service-not-allowed": "Браузер ограничил доступ к распознаванию речи.",
  "audio-capture": "Проверьте подключение микрофона.",
  "no-speech": "Речь не распознана. Попробуйте ещё раз.",
  "network": "Сервис распознавания недоступен. Попробуйте ещё раз.",
};

export default function VoiceEntry({ append }: { append: (words: string) => void }) {
  const browser = window as SpeechWindow;
  const Engine = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  const session = useRef<Recognizer | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => () => {
    const current = session.current;
    session.current = null;
    current?.abort();
  }, []);
  if (!Engine) return null;
  const label = listening ? "Завершить диктовку" : "Продиктовать вопрос";
  function toggle() {
    if (session.current) {
      session.current.stop();
      return;
    }
    if (!Engine) return;
    const engine = new Engine();
    session.current = engine;
    engine.lang = "ru-RU";
    engine.continuous = false;
    engine.interimResults = true;
    let committed = 0;
    let failed = false;
    engine.onresult = ({ results }) => {
      if (session.current !== engine) return;
      const phrases = Array.from(results);
      let next = committed;
      while (next < phrases.length && phrases[next].isFinal) next++;
      const words = phrases.slice(committed, next).map(r => r[0].transcript.trim()).join(" ").trim();
      if (words) append(words);
      committed = next;
      setStatus(phrases.slice(next).map(r => r[0].transcript).join(" ").trim() || "Слушаю…");
    };
    engine.onerror = ({ error }) => {
      if (session.current !== engine) return;
      failed = true;
      setStatus(notices[error] ?? "Не удалось распознать речь. Попробуйте ещё раз.");
    };
    engine.onend = () => {
      if (session.current !== engine) return;
      session.current = null;
      setListening(false);
      if (!failed) setStatus(committed ? "" : notices["no-speech"]);
    };
    setListening(true);
    setStatus("Слушаю…");
    try { engine.start(); }
    catch {
      session.current = null;
      setListening(false);
      setStatus("Не удалось включить микрофон.");
    }
  }
  return <div className="cx-voice">
    <button type="button" aria-label={label} data-hint={label} aria-pressed={listening} onClick={toggle}>
      <Icon name="microphone" size={21} />
    </button>
    <span role="status" className="cx-voice-status">{status}</span>
  </div>;
}
