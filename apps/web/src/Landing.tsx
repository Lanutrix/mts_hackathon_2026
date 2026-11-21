import type { MouseEvent, ReactNode } from "react";
import { ProductBrand, MtsCaseBrand } from "./Brand";
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
            <RouteLink className="landing-login" path="/login" go={go}>
              <AccessIcon name="enter" /> Войти
            </RouteLink>
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
