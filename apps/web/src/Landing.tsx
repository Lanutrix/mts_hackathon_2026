import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ProductBrand, MtsCaseBrand, Icon } from "./Brand";
import LandingOptic from "./LandingOptic";
import ThemeControl from "./ThemeControl";
import AccessIcon from "./AccessIcon";
import "./landing.css";

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
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    let timer: number | undefined;
    let revision = 0;
    async function sync() {
      const current = ++revision;
      try {
        const response = await fetch("/api/me", { signal: lifetime.signal, cache: "no-store" });
        const session = response.ok ? (await response.json()).user : null;
        if (current !== revision || lifetime.signal.aborted) return;
        window.clearTimeout(timer);
        setSignedIn(!!session);
        if (session) timer = window.setTimeout(() => setSignedIn(false), session.expiresInMs);
      } catch {
        if (current === revision && !lifetime.signal.aborted) setSignedIn(false);
      }
    }
    const visible = () => { if (!document.hidden) void sync(); };
    const changed = (event: StorageEvent) => {
      if (event.key === "srez:logout" || event.key === "srez:login") void sync();
    };
    void sync();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", changed);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void sync(); };
    window.addEventListener("pageshow", restored);
    return () => {
      lifetime.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", changed);
      window.removeEventListener("pageshow", restored);
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
            <ProductBrand />
            <MtsCaseBrand />
          </div>
          <div className="landing-tools">
            <ThemeControl compact />
            {signedIn === null ? <span className="landing-account-check" aria-hidden="true" /> : <RouteLink className="landing-login" path={signedIn ? "/preferences" : "/login"} go={go}>
              {signedIn ? <><Icon name="profile" /> Мой профиль</> : <><AccessIcon name="enter" /> Войти</>}
            </RouteLink>}
          </div>
        </div>
      </header>
      <main id="landing-main" tabIndex={-1}>
        <section className="landing-poster" aria-labelledby="landing-title">
          <div className="landing-stage">
            <div className="landing-copy">
              <h1 id="landing-title">
                Инциденты <span>в срезе.</span>
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
                  ИИ-помощник <Arrow />
                </RouteLink>
              </div>
            </div>
            <LandingOptic />
          </div>
        </section>
      </main>
    </div>
  );
}
