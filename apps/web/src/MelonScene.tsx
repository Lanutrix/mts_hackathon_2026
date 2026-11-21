import { useEffect, useId, useRef, useState } from "react";
import {
  groupColors,
  groupNames,
  melonGroups,
  type Counts,
  type MelonFilter,
  type MelonTracking,
  type ModelState,
  type ObjectName,
} from "./melonModel";
import { mountMelon } from "./melonRender";
import "./melonRender.css";

type Props = {
  active: MelonFilter;
  tracking?: MelonTracking | null;
  counts?: Counts;
  unique?: number;
  compact?: boolean;
  hero?: boolean;
  showMeters?: boolean;
  onGroupSelect?: (group: MelonFilter) => void;
};
const still = new URL("./assets/melon-studio-focus.webp", import.meta.url).href;
export default function MelonScene({
  active,
  counts,
  unique,
  tracking,
  compact = false,
  hero = false,
  showMeters = true,
  onGroupSelect,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    fallback = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof mountMelon>>(null);
  const selectable = !hero && Boolean(onGroupSelect);
  const callback = useRef(onGroupSelect);
  callback.current = onGroupSelect;
  const snapshot = useRef<ModelState>({
    active,
    counts,
    unique,
    tracking,
  });
  snapshot.current = { active, counts, unique, tracking };
  const [mode, setMode] = useState<"waiting" | "webgl" | "canvas" | "poster">(
    "waiting",
  );
  const [target, setTarget] = useState<ObjectName>("fruit"),
    [paused, setPaused] = useState(false);
  const help = useId();
  const Meter = onGroupSelect ? "button" : "div";

  useEffect(() => {
    const gl = canvas.current,
      paper = fallback.current,
      box = surface.current;
    if (!gl || !paper || !box) return;
    function start(software = false) {
      engine.current?.dispose();
      setMode("waiting");
      engine.current = mountMelon(
        gl!,
        paper!,
        box!,
        snapshot.current,
        hero,
        compact,
        {
          ready: setMode,
          target: setTarget,
          paused: setPaused,
          track(x, y) {
            box!.style.setProperty("--target-x", x.toFixed(2) + "px");
            box!.style.setProperty("--target-y", y.toFixed(2) + "px");
          },
          select: selectable ? (g) => callback.current?.(g) : undefined,
        },
        software,
      );
    }
    function lost(e: Event) {
      e.preventDefault();
      start(true);
    }
    function restored() {
      start();
    }
    gl.addEventListener("webglcontextlost", lost);
    gl.addEventListener("webglcontextrestored", restored);
    start();
    return () => {
      gl.removeEventListener("webglcontextlost", lost);
      gl.removeEventListener("webglcontextrestored", restored);
      engine.current?.dispose();
      engine.current = null;
    };
  }, [hero, compact, selectable]);
  useEffect(() => {
    engine.current?.select(snapshot.current);
  }, [
    active,
    counts?.critical,
    counts?.coordinators,
    counts?.high,
    counts?.research,
    unique,
    tracking?.group,
    tracking?.id,
    tracking?.revision,
  ]);
  const amounts = melonGroups
    .map((g) => groupNames[g] + " — " + (counts?.[g] ?? 0))
    .join(". ");
  const title = hero
    ? "Арбуз и оптическая рамка"
    : active === "all"
      ? "Срезы инцидентов"
      : groupNames[active] + " — " + (counts?.[active] ?? 0);
  const targetLabel =
    !hero && tracking
      ? tracking.id +
        " · " +
        groupNames[tracking.group] +
        " · " +
        tracking.header
      : undefined;
  const id = tracking?.id ?? "";
  const serial = /(?:^|[-_/#])(\d{1,8})$/.exec(id)?.[1];
  const shortId = serial
    ? "№" + serial
    : id.length <= 8
      ? id
      : "…" + id.slice(-6);
  return (
    <div
      className={"melon-scene" + (hero ? " melon-scene--hero" : "")}
      data-mode={mode}
      data-ready={mode !== "waiting"}
      data-active={active}
      data-object={target}
      data-paused={paused}
      role="group"
      aria-label={title}
    >
      <div
        ref={surface}
        className="melon-view"
        tabIndex={mode === "poster" ? -1 : 0}
        aria-label={
          mode === "poster"
            ? title
            : "Вращать 3D-объект: " + (target === "fruit" ? "арбуз" : "рамка")
        }
        aria-describedby={help}
        title={targetLabel}
        aria-keyshortcuts={
          mode === "poster"
            ? undefined
            : "1 2 ArrowUp ArrowDown ArrowLeft ArrowRight Home Space" +
              (selectable ? " Enter" : "")
        }
        role={mode === "poster" ? "img" : "group"}
      >
        <canvas
          className="melon-scene__canvas"
          ref={canvas}
          aria-hidden="true"
        />
        <canvas
          className="melon-scene__paper"
          ref={fallback}
          aria-hidden="true"
        />
        {!hero && tracking && (mode === "canvas" || mode === "webgl") && (
          <div
            key={tracking.group + "/" + tracking.id}
            className="melon-tracker"
            data-ticket={tracking.id}
            data-group={tracking.group}
            role="img"
            aria-label={targetLabel}
          >
            <div className="melon-tracker__lock">
              <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <path
                  className="melon-tracker__halo"
                  d="M2 14V2h12m20 0h12v12m0 20v12H34m-20 0H2V34"
                />
                <path
                  className="melon-tracker__corners"
                  d="M2 14V2h12m20 0h12v12m0 20v12H34m-20 0H2V34"
                />
                <path
                  className="melon-tracker__ticks"
                  d="M20 2h8m18 18v8m-26 18h8M2 20v8"
                />
                <circle
                  className="melon-tracker__aim"
                  cx="24"
                  cy="24"
                  r="2.4"
                />
                <path
                  key={tracking?.revision}
                  className="melon-tracker__scan"
                  d="M5 24h38"
                />
              </svg>
              <span className="melon-tracker__tag" title={targetLabel}>
                <span className="melon-tracker__full-id">{tracking.id}</span>
                <span className="melon-tracker__short-id">{shortId}</span>
              </span>
            </div>
          </div>
        )}
        {hero && (mode === "poster" || mode === "waiting") && (
          <span
            className="melon-scene__still melon-hero-poster"
            aria-hidden="true"
          />
        )}
        {!hero && mode === "poster" && (
          <img
            src={still}
            alt=""
            draggable="false"
            className="melon-scene__still"
          />
        )}
        {!hero && mode === "waiting" && (
          <span role="status" className="melon-wait">
            <i />
            <i />
            <i />
            <span className="melon-sr">Загружается 3D-модель</span>
          </span>
        )}
      </div>
      <span id={help} className="melon-sr">
        {hero &&
          "Во время разреза на мякоти появляется фиолетовая сетка. На готовых срезах по очереди появляются стеклянные метки 01, 02 и 03. "}
        {mode !== "poster" &&
          "Перетащите арбуз или рамку, чтобы повернуть их. На клавиатуре выберите арбуз клавишей 1 или рамку клавишей 2 и вращайте стрелками. Home возвращает исходный ракурс. Пробел ставит движение на паузу и возобновляет его."}
        {mode !== "poster" &&
          selectable &&
          " Клавиша Enter переключает группы инцидентов."}
        {!hero &&
          counts &&
          " От переднего среза к заднему: " +
            amounts +
            ". Заполнение каждой шкалы показывает долю среди инцидентов в выборке."}
      </span>
      {!hero && counts && showMeters && (
        <div
          className="melon-meters"
          role={onGroupSelect ? "group" : "list"}
          aria-label="Значения срезов"
        >
          {melonGroups.map((g, i) => {
            const count = counts[g] ?? 0;
            const short = ["Крит.", "Коорд.", "Выс.", "Иссл."];
            return (
              <Meter
                className="melon-meter"
                role={onGroupSelect ? undefined : "listitem"}
                type={onGroupSelect ? "button" : undefined}
                key={g}
                aria-pressed={onGroupSelect ? active === g : undefined}
                onClick={
                  onGroupSelect
                    ? () => onGroupSelect(active === g ? "all" : g)
                    : undefined
                }
                title={groupNames[g] + " — " + count + " из " + (unique ?? 0)}
                aria-label={
                  groupNames[g] + " — " + count + " из " + (unique ?? 0)
                }
              >
                <span className="melon-meter__name">{groupNames[g]}</span>
                <span className="melon-meter__short" aria-hidden="true">
                  {short[i]}
                </span>
                <strong>{count}</strong>
                <i aria-hidden="true">
                  <b
                    style={{
                      width:
                        Math.min(
                          100,
                          (count / Math.max(1, unique ?? 0)) * 100,
                        ) + "%",
                      backgroundColor: groupColors[i],
                    }}
                  />
                </i>
              </Meter>
            );
          })}
        </div>
      )}
    </div>
  );
}
