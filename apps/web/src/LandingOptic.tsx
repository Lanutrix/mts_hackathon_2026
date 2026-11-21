import { useEffect, useId, useRef } from "react";

const artwork = new URL("./assets/focus-optic.webp", import.meta.url).href;
const aimPoints = [
  [202, 240],
  [257, 206],
  [329, 225],
  [503, 120],
] as const;
const viewWidth = 660,
  viewHeight = 440;
const magnification = 1.48;

// The lens and its sampled image share one coordinate system. Moving the lens
// reveals the part of the original image directly under it on every frame.
export default function LandingOptic({ signal }: { signal: number }) {
  const lens = useRef<SVGGElement>(null),
    sample = useRef<SVGGElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const pulse = useRef<SVGRectElement>(null);
  const pose = useRef({ x: 358, y: 164, velocityX: 0, velocityY: 0 });
  const clip = useId().replace(/:/g, "");
  useEffect(() => {
    const layer = lens.current,
      contents = sample.current,
      path = trail.current,
      square = pulse.current;
    if (!layer || !contents || !path || !square) return;
    const [goalX, goalY] = aimPoints[signal];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const current = pose.current;
    const fromX = current.x,
      fromY = current.y;
    const midX = (fromX + goalX) / 2;
    const midY =
      Math.min(fromY, goalY) -
      Math.min(64, Math.hypot(fromX - goalX, fromY - goalY) * 0.25);
    path.setAttribute(
      "d",
      `M${fromX} ${fromY} Q${midX} ${midY} ${goalX} ${goalY}`,
    );
    let frame = 0,
      previous = 0,
      start = 0;
    function sendPulse(t: number) {
      const a = 1 - t;
      const x = a * a * fromX + 2 * a * t * midX + t * t * goalX,
        y = a * a * fromY + 2 * a * t * midY + t * t * goalY;
      const visibility = Math.sin(t * Math.PI);
      path!.setAttribute("stroke-dashoffset", String(0.23 - t));
      path!.setAttribute("opacity", String(visibility * 0.66));
      square!.setAttribute(
        "transform",
        `translate(${x} ${y}) rotate(${t * 88}) scale(${1 - t * 0.7})`,
      );
      square!.setAttribute("rx", String(t * 3.8));
      square!.setAttribute("opacity", String(Math.min(1, visibility * 3)));
    }
    function paint() {
      layer!.setAttribute(
        "transform",
        "translate(" + current.x.toFixed(2) + " " + current.y.toFixed(2) + ")",
      );
      contents!.setAttribute(
        "transform",
        "scale(" +
          magnification +
          ") translate(" +
          (-current.x).toFixed(2) +
          " " +
          (-current.y).toFixed(2) +
          ")",
      );
    }
    function settle() {
      cancelAnimationFrame(frame);
      current.x = goalX;
      current.y = goalY;
      current.velocityX = 0;
      current.velocityY = 0;
      path!.setAttribute("opacity", "0");
      square!.setAttribute("opacity", "0");
      paint();
    }
    function advance(timestamp: number) {
      if (document.hidden || reduced.matches) {
        settle();
        return;
      }
      const dt = Math.min(
        (timestamp - (previous || timestamp - 16)) / 1000,
        0.032,
      );
      previous = timestamp;
      if (!start) start = timestamp;
      const phase = Math.min(1, (timestamp - start) / 710);
      sendPulse(phase);
      current.velocityX +=
        ((goalX - current.x) * 156 - current.velocityX * 21) * dt;
      current.velocityY +=
        ((goalY - current.y) * 156 - current.velocityY * 21) * dt;
      current.x += current.velocityX * dt;
      current.y += current.velocityY * dt;
      if (
        phase === 1 &&
        Math.hypot(goalX - current.x, goalY - current.y) < 0.09 &&
        Math.hypot(current.velocityX, current.velocityY) < 0.8
      ) {
        settle();
        return;
      }
      paint();
      frame = requestAnimationFrame(advance);
    }
    function preference() {
      if (reduced.matches || document.hidden) settle();
    }
    if (reduced.matches || document.hidden) settle();
    else {
      paint();
      frame = requestAnimationFrame(advance);
    }
    reduced.addEventListener("change", preference);
    document.addEventListener("visibilitychange", preference);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", preference);
    };
  }, [signal]);
  return (
    <div className="landing-optic" aria-hidden="true">
      <div className="optic-scene">
        <img
          className="optic-art"
          src={artwork}
          alt=""
          width="1536"
          height="1024"
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
        <svg
          className="optic-glass"
          viewBox={"0 0 " + viewWidth + " " + viewHeight}
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clip}>
              <rect x="-27" y="-27" width="54" height="54" rx="8" />
            </clipPath>
          </defs>
          <path
            ref={trail}
            pathLength="1"
            fill="none"
            stroke="#ff002d"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeDasharray=".23 1"
            opacity="0"
          />
          <rect
            ref={pulse}
            x="-5"
            y="-5"
            width="10"
            height="10"
            fill="#ff002d"
            stroke="#fff"
            strokeWidth="1"
            opacity="0"
          />
          <g ref={lens} transform="translate(202 240)">
            <g clipPath={"url(#" + clip + ")"}>
              <g ref={sample} transform="scale(1.48) translate(-202 -240)">
                <image href={artwork} width="660" height="440" />
              </g>
              <rect
                x="-27"
                y="-27"
                width="54"
                height="54"
                fill="#a98ee2"
                opacity=".07"
              />
              <path
                key={signal}
                className="optic-glint"
                d="M-66 -34h12l-19 68h-12z"
                fill="#fff"
              />
            </g>
            <rect
              x="-27"
              y="-27"
              width="54"
              height="54"
              rx="8"
              fill="none"
              stroke="#fff"
              strokeOpacity=".82"
              strokeWidth="1.5"
            />
            <path
              d="M-32-18v-9q0-5 5-5h9m36 0h9q5 0 5 5v9m0 36v9q0 5-5 5h-9m-36 0h-9q-5 0-5-5v-9"
              fill="none"
              stroke="#44223b"
              strokeOpacity=".8"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
