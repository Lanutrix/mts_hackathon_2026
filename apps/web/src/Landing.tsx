import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { MelonTracking } from "./melonModel";
import { Mark } from "./Brand";
import LandingOptic from "./LandingOptic";
import "./landing.css";

const mtsMark = new URL("./assets/mts-case-mark.png", import.meta.url).href;
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
export default function Landing({ go }: { go: (path: string) => void }) {
  const [tracking, setTracking] = useState<MelonTracking | null>(null);
  useEffect(() => {
    let pending: AbortController | undefined;
    const refresh = async () => {
      if (document.hidden) {
        pending?.abort();
        return;
      }
      if (pending && !pending.signal.aborted) return;
      const request = new AbortController();
      pending = request;
      try {
        const response = await fetch("/api/public/focus", {
          credentials: "omit",
          signal: request.signal,
        });
        if (!response.ok) throw new Error();
        const { tracking } = await response.json();
        if (!request.signal.aborted) setTracking(tracking);
      } catch {
        if (!request.signal.aborted) setTracking(null);
      } finally {
        if (pending === request) pending = undefined;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
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
            <LandingOptic tracking={tracking} />
          </div>
        </section>
      </main>
    </div>
  );
}
