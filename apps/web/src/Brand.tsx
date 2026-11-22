import { platformIcons, iconNames, type PlatformIcon } from "../../../packages/domain/platformIcons";
import type { Group } from "../../../packages/domain/index.ts";
import "./brand.css";

const mtsMark = new URL("./assets/mts-case-mark.png", import.meta.url).href;

const paths = {
  login: "M14 3h5v18h-5M3 12h12m-5-5 5 5-5 5",
  payment: "M3 6h18v13H3zM3 10h18M6 15h4",
  network: "M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0m-3 3h.01",
  sync: "M4 10a8 8 0 0 1 14-4l2 2m0-5v5h-5m5 6a8 8 0 0 1-14 4l-2-2m0 5v-5h5",
  file: "M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6",
  dns: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-18 0h18m-9-9c-4.5 5-4.5 13 0 18 4.5-5 4.5-13 0-18Z",
  database: "M4 6c0-4 16-4 16 0s-16 4-16 0Zm0 0v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0",
  sim: "M6 3h8l4 4v14H6zM9 10h6v7H9zM9 13h6m-3 0v4",
  messages: "M3 4h13v7H8l-4 3v-3H3zM10 15h7l4 3v-9h-2",
  video: "M3 5h18v14H3zM10 9l5 3-5 3z",
  cdn: "M9 3h6v5H9zM2 16h6v5H2zm14 0h6v5h-6zM12 8v4m-7 4v-4h14v4",
  phone: "M6 3l3 4-2 3c2 3 4 5 7 7l3-2 4 3-2 3c-2 2-7 0-12-5S0 6 3 4z",
  cloud: "M6 18a5 5 0 1 1 1-10 6 6 0 0 1 12-1 5.5 5.5 0 0 1 0 11H6Z",
  mobile: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm2 3h6m-3 14h.01",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  duration: "M8 3h8M12 3v3m6 2 2-2M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8 0 3-4m-8 6 1.3 1.5",
  ranking: "M3 5v15h18M6 7h13l-2 3H6Zm0 7h8l-2 3H6Z",
  relation: "M5 16 11 9m2 0 5 5M4 16c3-2 4 1 2 3-3 2-4-1-2-3Zm6-10c3-2 4 1 2 3-3 2-4-1-2-3Zm8 8c3-2 4 1 2 3-3 2-4-1-2-3Z",
  quantity: "M4 6h15l-1.6 3H4Zm0 6h10l-1.6 3H4Zm0 6h5",
  symptom: "M2 13h4l2-7 4 13 3-10 2 4h5",
  intake: "M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M12 3v12m-5-5 5 5 5-5",
  team: "M12 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-2a6 6 0 0 1 12 0v2m0-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5v1",
  more: "M3 13q-1-3 2-4 2 3-2 4Zm8 0q-1-3 2-4 2 3-2 4Zm8 0q-1-3 2-4 2 3-2 4Z",
  live: "M3 7h18a9 9 0 0 1-18 0Zm4 2.5 1.3 2m3.7-1.4v2.7m4.6-3.2-1.2 2",
  queue: "M8 6.5h12M8 12h12M8 17.5h12M4.6 5l-1 2m1 3.5-1 2m1 3.5-1 2",
  bell: "M8 17q4-2 8 0M5 15c2-2 2-3 2-6a5 5 0 0 1 10 0c0 3 0 4 2 6l1 2H4l1-2ZM10 20a3 3 0 0 0 4 0",
  history: "M3 11a9 9 0 1 1 2 7M3 5v6h6m3-5v6l4 2m-8 3a6 6 0 0 0 4 1",
  quality: "M12 2 3 6v6c0 5 6 9 9 10 3-1 9-5 9-10V6l-9-4ZM6 13c1 3 3 5 6 6m-4-8 3 3 5-6",
  expand: "M3 8V4h5m8 0h5v4m0 8v4h-5m-8 0H3v-4M7 10l10-2a5.1 5.1 0 0 1-10 2Z",
  research: "M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 7 7M6.5 10c0-2 1.2-3.1 3.6-3.6.4 2.3-.6 4.1-2.8 4.7Z",
  critical: "m12 3 9 15c-6 3-12 3-18 0L12 3Zm-6 13.5c4 2 8 2 12 0M12 8v4m0 2.5v.1",
  coordinators:
    "M8 8c0-2.6 2-4 5-4.3 1 3-.2 5.8-3 6.6Q8 10 8 8ZM3 20v-2a6.1 6.1 0 0 1 12.2 0v2m1-15c3 0 4.2 4.3 1.1 6.1m.3 3a5.3 5.3 0 0 1 3.5 5v1",
  high: "M4 16.5 12 10l8 6.5M4 10l8-6.5 8 6.5m-11 8.3c2 1 4 1 6 0",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l3.6 2M6.3 14.5a6 6 0 0 0 3.4 3.4",
  escalation: "M4 20v-3a7 7 0 0 1 7-7h8m-5-5 5 5-5 5M7.3 18.5v-1.2a4.2 4.2 0 0 1 2.4-3.7",
  layers: "M3 8 12 3l9 5-9 5-9-5Zm1 5 8 4 8-4m-16 4 8 4 8-4M11 8l2-1",
  help: "M21 11a9 9 0 1 0-5 8l5 1-1-5q1-2 1-4ZM9 8.8a3 3 0 0 1 6 .2c0 2-3 2.3-3 4m0 3h.01",
  profile:
    "M9 8a3.5 3.5 0 1 1 7-1c0 2.1-1.8 4-4.8 4.4Q9 10.2 9 8ZM4 21v-1.5a8 7 0 0 1 16 0V21",
  settings:
    "M3 7h6m5 0h7M3 17h11m4 0h3M9 7c0-2 2-3 4-3 1 2 .7 5-2 6q-2-1-2-3Zm5 10c0-2 2-3 4-3 1 2 .7 5-2 6q-2-1-2-3Z",
  sun: "M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.6 14.2A9 9 0 0 1 9.8 3.4a9 9 0 1 0 10.8 10.8Z",
  system: "M3 4h18v13H3zM8 21h8m-4-4v4M6 13l3-2",
} satisfies Record<PlatformIcon, string>;
export type IconName = PlatformIcon;
export const iconLabels = Object.fromEntries(iconNames.map(key => [key, platformIcons[key].label])) as Record<IconName, string>;
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
      data-srez-icon={iconLabels[name]}
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
  critical: "Критический инцидент",
  coordinators: "У координаторов",
  high: "Высокий приоритет",
  research: "На исследовании",
  escalation: "Требуется устранение последствий",
};

export function SignalBadge({ signal }: { signal: Group | "escalation" }) {
  return (
    <span
      className="signal-badge"
      role="img"
      data-hint={signalNames[signal]}
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
    <svg
      className="product-mark"
      viewBox="0 0 64 64"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="product-mark__rind"
        fill="#20584f"
        d="M54.8 13.9C46.7 4.9 32 2.2 20.6 8.1 8.8 14.2 3.1 27.6 6.6 40l9.1-6.1c-.3-7.2 4-14 10.6-17.1 6.4-3.1 13.7-2 19 2.6Z"
      />
      <path
        className="product-mark__cut"
        fill="#df2351"
        d="m8 45 35.3-23.6 8.3 5.6-17.5 11.8h10l16-10.7C60.5 41 52.6 52.5 40.5 56.5 28.2 60.6 15.4 56 8 45Z"
      />
      <path
        className="product-mark__seed"
        fill="#292332"
        d="m49 18.4 8.7-5.9 3 4.5a2.2 2.2 0 0 1-.6 3.1l-6.9 4.6Z"
      />
    </svg>
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
    <span
      className={"mts-case-brand" + (compact ? " mts-case-brand--compact" : "")}
    >
      <img src={mtsMark} alt="" width="32" height="32" />
      <span>Кейс МТС True Tech</span>
    </span>
  );
}
