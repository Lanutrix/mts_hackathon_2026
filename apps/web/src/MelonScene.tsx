import { useEffect, useId, useRef, useState } from "react";
import {
  groupColors,
  groupNames,
  melonGroups,
  type Counts,
  type MelonFilter,
  type ModelState,
  type ObjectName,
} from "./melonModel";
import { mountMelon } from "./melonRender";
import "./melonRender.css";

type Props = {
  active: MelonFilter;
  counts?: Counts;
  unique?: number;
  compact?: boolean;
  hero?: boolean;
  showMeters?: boolean;
  onGroupSelect?: (group: MelonFilter) => void;
};
const still = new URL("./assets/melon-studio-focus.webp", import.meta.url).href;
const poster = new URL("./assets/focus-optic.webp", import.meta.url).href;
function InstrumentIcon({
  name,
}: {
  name: "fruit" | "frame" | "pause" | "play";
}) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "fruit" ? (
        <g transform="rotate(-22 10 10)">
          <path d="M2.5 7h15a7.5 7.5 0 0 1-15 0Z" />
          <path d="M3.8 9.4a6.8 6.8 0 0 0 12.4 0M8 9l.4 1m3.4-1-.3 1" />
        </g>
      ) : name === "frame" ? (
        <>
          <path d="m4.5 5 9.5-2 2 1.8v11l-9.7 2-1.8-1.6z" />
          <path d="m6.3 6.6 9.3-1.8M6.3 6.6v10.8m2-9.1 5.7-1.1v6.9l-5.7 1.2z" />
        </>
      ) : name === "pause" ? (
        <path strokeWidth="2.5" d="M7 4.8v10.4M13 4.8v10.4" />
      ) : (
        <path d="m7 4 9 6-9 6z" />
      )}
    </svg>
  );
}
export default function MelonScene({
  active,
  counts,
  unique,
  compact = false,
  hero = false,
  showMeters = true,
  onGroupSelect,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    fallback = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof mountMelon>>(null);
  const [localGroup, setLocalGroup] = useState<MelonFilter>("all");
  const selected = onGroupSelect
    ? active
    : active === "all"
      ? localGroup
      : active;
  const select = onGroupSelect ?? setLocalGroup;
  const callback = useRef(select);
  callback.current = select;
  const snapshot = useRef<ModelState>({ active: selected, counts, unique });
  snapshot.current = { active: selected, counts, unique };
  const [mode, setMode] = useState<"waiting" | "webgl" | "canvas" | "poster">(
    "waiting",
  );
  const [target, setTarget] = useState<ObjectName>("fruit"),
    [paused, setPaused] = useState(false);
  const help = useId();

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
          select: (g) => callback.current?.(g),
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
  }, [hero, compact]);
  useEffect(() => {
    engine.current?.select(snapshot.current);
  }, [
    selected,
    counts?.critical,
    counts?.coordinators,
    counts?.high,
    counts?.research,
    unique,
  ]);
  const amounts = melonGroups
    .map((g) => groupNames[g] + " — " + (counts?.[g] ?? 0))
    .join(". ");
  const title = hero
    ? "Арбуз и оптическая рамка"
    : selected === "all"
      ? "Срезы инцидентов"
      : groupNames[selected] + " — " + (counts?.[selected] ?? 0);
  function choose(name: ObjectName) {
    engine.current?.target(name);
    surface.current?.focus({ preventScroll: true });
  }
  return (
    <div
      className={"melon-scene" + (hero ? " melon-scene--hero" : "")}
      data-mode={mode}
      data-ready={mode !== "waiting"}
      data-active={selected}
      data-object={target}
      role="group"
      aria-label={title}
    >
      <div
        ref={surface}
        className="melon-view"
        tabIndex={mode === "poster" ? -1 : 0}
        aria-label={
          "Вращать 3D-объект: " + (target === "fruit" ? "арбуз" : "рамка")
        }
        aria-describedby={help}
        role="group"
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
        {mode === "poster" && (
          <img
            src={hero ? poster : still}
            alt=""
            draggable="false"
            className="melon-scene__still"
          />
        )}
        {mode === "waiting" && (
          <span role="status" className="melon-wait">
            <i />
            <i />
            <i />
            <span className="melon-sr">Загружается 3D-модель</span>
          </span>
        )}
      </div>
      <span id={help} className="melon-sr">
        Перетаскивайте объект или вращайте стрелками. Home возвращает исходный
        ракурс, пробел управляет движением.
        {!hero &&
          counts &&
          " От переднего среза к заднему: " +
            amounts +
            ". Заполнение каждой шкалы показывает долю среди инцидентов в выборке."}
      </span>
      {!hero && counts && showMeters && (
        <div className="melon-meters" role="group" aria-label="Значения срезов">
          {melonGroups.map((g, i) => {
            const count = counts[g] ?? 0;
            const short = ["Крит.", "Коорд.", "Выс.", "Иссл."];
            return (
              <button
                type="button"
                key={g}
                aria-pressed={selected === g}
                onClick={() => select(selected === g ? "all" : g)}
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
              </button>
            );
          })}
        </div>
      )}
      {mode !== "poster" && mode !== "waiting" && (
        <div
          className="melon-tools"
          role="group"
          aria-label="Управление 3D-моделью"
        >
          {(["fruit", "frame"] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={target === name}
              title={name === "fruit" ? "Вращать арбуз" : "Вращать рамку"}
              aria-label={name === "fruit" ? "Вращать арбуз" : "Вращать рамку"}
              onClick={() => choose(name)}
            >
              <InstrumentIcon name={name} />
            </button>
          ))}
          <button
            type="button"
            aria-label={paused ? "Включить движение" : "Приостановить движение"}
            title={paused ? "Включить движение" : "Приостановить движение"}
            onClick={() => engine.current?.toggle()}
          >
            <InstrumentIcon name={paused ? "play" : "pause"} />
          </button>
        </div>
      )}
    </div>
  );
}
