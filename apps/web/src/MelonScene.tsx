import { useEffect, useRef, useState } from "react";
import { mountMelon, type MelonFilter } from "./melonRender";
import "./melonRender.css";

type Props = { active: MelonFilter; compact?: boolean; revision?: number };

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
      <img
        className="melon-scene__still"
        src="/melon-studio.webp"
        alt=""
        width="864"
        height="540"
        draggable="false"
      />
      <canvas className="melon-scene__canvas" ref={canvas} />
    </div>
  );
}
