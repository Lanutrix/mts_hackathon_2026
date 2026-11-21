import { useEffect, useRef, useState } from "react";
import { mountMelon, type MelonFilter } from "./melonRender";
import "./melonRender.css";

type Props = { active: MelonFilter; compact?: boolean; revision?: number };
const still = new URL("./assets/melon-studio-focus.webp", import.meta.url).href;
const targets: Record<MelonFilter, [number, number]> = {
  all: [308, 58],
  critical: [114, 121],
  coordinators: [156, 63],
  high: [277, 43],
  research: [323, 102],
};

export default function MelonScene({
  active,
  compact = false,
  revision = 0,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof mountMelon>>(null);
  const latest = useRef({ active, revision });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let mounted = true;
    function start() {
      if (!element || !mounted) return;
      renderer.current?.dispose();
      renderer.current = mountMelon(
        element,
        latest.current.active,
        compact,
        () => {
          if (mounted) setReady(true);
        },
      );
    }
    function lost(event: Event) {
      event.preventDefault();
      renderer.current?.dispose();
      renderer.current = null;
      setReady(false);
    }
    element.addEventListener("webglcontextlost", lost);
    element.addEventListener("webglcontextrestored", start);
    start();
    return () => {
      mounted = false;
      element.removeEventListener("webglcontextlost", lost);
      element.removeEventListener("webglcontextrestored", start);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [compact]);

  useEffect(() => {
    if (
      active !== latest.current.active ||
      revision !== latest.current.revision
    )
      renderer.current?.select(active);
    latest.current = { active, revision };
  }, [active, revision]);

  return (
    <div className="melon-scene" aria-hidden="true" data-ready={ready}>
      <svg className="melon-orbit" viewBox="0 0 432 270" fill="none">
        <g transform="rotate(-16 216 139)">
          <ellipse cx="215" cy="139" rx="192" ry="84" stroke="#9d91b8" strokeWidth=".85" />
          <path d="M24 129a192 84 0 0 1 173-74m80 163a192 84 0 0 1-125 0" stroke="#fff" />
          <path d="M18 139h12m371 0h12M215 50v10m0 157v10" stroke="#847597" />
          <rect x="21" y="136.5" width="5" height="5" fill="#9b88b6" />
        </g>
      </svg>
      <img
        className="melon-scene__still"
        src={still}
        alt=""
        width="864"
        height="540"
        draggable="false"
      />
      <canvas className="melon-scene__canvas" ref={canvas} />
      <svg className="melon-sight" viewBox="0 0 432 270" fill="none">
        <g className="melon-focus" style={{ transform: `translate(${targets[active][0]}px, ${targets[active][1]}px)` }}>
          <rect x="-9" y="-9" width="18" height="18" rx="2" fill="#f4f0fa" fillOpacity=".64" stroke="#fff" strokeOpacity=".85" />
          <path d="M-12-4v-8h8M4 12h8V4" stroke="#574860" strokeWidth="1.2" />
          <rect x="-2.6" y="-2.6" width="5.2" height="5.2" fill="#c50032" />
        </g>
      </svg>
    </div>
  );
}
