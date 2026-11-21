import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Mark } from "./Brand";
import LandingOptic from "./LandingOptic";
import "./landing.css";

const mtsMark = new URL("./assets/mts-case-mark.png", import.meta.url).href;
const signals = [
  {
    key: "critical",
    label: "Критические",
    id: "DEMO-42-00001",
    title: "Платёжный шлюз: ошибки проведения платежей",
    reason: "Активный инцидент наивысшего приоритета.",
  },
  {
    key: "coordinators",
    label: "У координаторов",
    id: "DEMO-42-00003",
    title: "Мобильная связь: задержки соединения",
    reason: "Обращение назначено дежурной группе координаторов.",
  },
  {
    key: "high",
    label: "Высокие",
    id: "DEMO-42-00004",
    title: "Домашний интернет: разрывы соединения",
    reason: "Инцидент в работе с высоким приоритетом.",
  },
  {
    key: "research",
    label: "Исследование",
    id: "DEMO-42-00005",
    title: "МТС Медиа: исследование ошибок",
    reason: "Команда уточняет причины в статусе исследования.",
  },
] as const;

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={up ? "M6 18 18 6M6 6h12v12" : "M3 12h17m-6-6 6 6-6 6"} />
    </svg>
  );
}
function RouteLink({
  path,
  go,
  children,
  className,
}: {
  path: string;
  go: (path: string) => void;
  children: ReactNode;
  className: string;
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    go(path);
  }
  return (
    <a href={path} className={className} onClick={follow}>
      {children}
    </a>
  );
}
function Grain({ index }: { index: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      aria-hidden="true"
      className={"landing-grain grain-" + index}
    >
      {index === 1 ? (
        <>
          <path d="M10 3C5 4 1 8 3 11c3 3 7-2 7-8Z" fill="currentColor" />
          <path d="M18 6c-5 1-9 5-7 8 3 3 7-2 7-8Z" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d="M15 2C10 4 3 7 4 13c.5 3.2 4.4 4.6 7.1 2.1C14.6 12 15.3 6.6 15 2Z"
            fill={index === 0 ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {index === 3 && (
            <path
              d="m7.5 12.4 4-5.1"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  );
}

export default function Landing({ go }: { go: (path: string) => void }) {
  const [selected, setSelected] = useState(0);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const active = signals[selected];
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % signals.length
        : event.key === "ArrowLeft"
          ? (index + signals.length - 1) % signals.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? signals.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    choices.current[next]?.focus();
  }
  return (
    <div className="landing">
      <a className="skip" href="#landing-main">
        К содержимому
      </a>
      <header className="landing-head">
        <div className="landing-head-inner">
          <div className="landing-identity">
            <div className="landing-team">
              <Mark />
              <span>Watermelon</span>
            </div>
            <span className="landing-identity-rule" aria-hidden="true" />
            <div className="landing-case">
              <img src={mtsMark} alt="" width="32" height="32" />
              <span>Кейс МТС True Tech</span>
            </div>
          </div>
          <RouteLink className="landing-login" path="/login" go={go}>
            Войти <Arrow up />
          </RouteLink>
        </div>
      </header>
      <main id="landing-main" tabIndex={-1}>
        <section className="landing-poster" aria-labelledby="landing-title">
          <div className="landing-stage">
            <div className="landing-copy">
              <h1 id="landing-title">
                Инциденты <span>в фокусе.</span>
              </h1>
              <p>
                Рабочее место координатора массовых инцидентов. Сроки, статусы и
                ответственные — в одном эфире.
              </p>
              <div className="landing-actions">
                <RouteLink path="/live" go={go} className="landing-primary">
                  Открыть эфир <Arrow up />
                </RouteLink>
                <RouteLink
                  path="/workspace"
                  go={go}
                  className="landing-secondary"
                >
                  Рабочая очередь <Arrow />
                </RouteLink>
              </div>
            </div>
            <LandingOptic signal={selected} />
          </div>
        </section>
        <section
          className="landing-signals"
          aria-labelledby="landing-signal-title"
        >
          <div className="landing-signal-bar">
            <h2 id="landing-signal-title">Сигналы эфира</h2>
            <div
              className="landing-selector"
              role="group"
              aria-label="Сигналы эфира"
            >
              {signals.map((signal, index) => (
                <button
                  key={signal.key}
                  type="button"
                  ref={(node) => {
                    choices.current[index] = node;
                  }}
                  aria-pressed={index === selected}
                  aria-controls="landing-example"
                  onKeyDown={(e) => move(e, index)}
                  onClick={() => setSelected(index)}
                >
                  <Grain index={index} />
                  {signal.label}
                </button>
              ))}
            </div>
          </div>
          <div
            id="landing-example"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="landing-example-row" key={active.key}>
              <div className="landing-example-case">
                <span>Демо · {active.id}</span>
                <h3>{active.title}</h3>
              </div>
              <p>
                <Grain index={selected} />
                {active.reason}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
