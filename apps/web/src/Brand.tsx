import type { Group } from "../../../packages/domain/index.ts";
import "./brand.css";

const mtsMark = new URL("./assets/mts-case-mark.png", import.meta.url).href;

const paths = {
  more: "M4 12h1m6.5 0h1m6.5 0h1",
  live: "M3 7h18a9 9 0 0 1-18 0Zm4 2.5 1.3 2m3.7-1.4v2.7m4.6-3.2-1.2 2",
  queue: "M8 6.5h12M8 12h12M8 17.5h12M4.6 5l-1 2m1 3.5-1 2m1 3.5-1 2",
  bell: "M5 15c2-2 2-3 2-6a5 5 0 0 1 10 0c0 3 0 4 2 6l1 2H4l1-2ZM10 20a3 3 0 0 0 4 0",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2",
  quality: "M12 2 3 6v6c0 5 6 9 9 10 3-1 9-5 9-10V6l-9-4Zm-4 10 3 3 5-6",
  expand: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5",
  research: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-2 5 7 7",
  critical: "m12 3 9 16H3L12 3Zm0 5v5m0 3v.1",
  coordinators:
    "M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 20v-2a6 6 0 0 1 12 0v2m0-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2",
  high: "m5 16 7-6 7 6M5 10l7-6 7 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6.5V12l3.5 2",
  escalation: "M5 19v-4a5 5 0 0 1 5-5h8m-5-5 5 5-5 5",
  layers: "m3 8 9-5 9 5-9 5-9-5Zm1 5 8 4 8-4m-16 4 8 4 8-4",
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function SignalMark({ signal }: { signal: Group | "all" }) {
  return (
    <Icon
      name={signal === "all" ? "layers" : signal}
      size={18}
      className={"signal-mark signal-" + signal}
    />
  );
}

const signalNames: Record<Group | "escalation", string> = {
  critical: "Критический приоритет",
  coordinators: "У координаторов",
  high: "Высокий приоритет",
  research: "На исследовании",
  escalation: "Требует эскалации",
};

export function SignalBadge({ signal }: { signal: Group | "escalation" }) {
  return (
    <span
      className="signal-badge"
      role="img"
      title={signalNames[signal]}
      aria-label={signalNames[signal]}
    >
      {signal === "escalation" ? (
        <Icon name="escalation" size={18} className="escalation-mark" />
      ) : (
        <SignalMark signal={signal} />
      )}
      <span className="sr-only">{signalNames[signal]}</span>
    </span>
  );
}
export function Mark() {
  return (
    <img className="product-mark" src="/srez-mark.svg" alt="" width="40" height="40" />
  );
}

export function ProductBrand() {
  return (
    <span className="product-brand">
      <Mark />
      <span>Срез</span>
    </span>
  );
}

export function MtsCaseBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={"mts-case-brand" + (compact ? " mts-case-brand--compact" : "")}>
      <img src={mtsMark} alt="" width="32" height="32" />
      <span>Кейс МТС True Tech</span>
    </span>
  );
}
