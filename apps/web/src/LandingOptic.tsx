import { useEffect, useId, useRef, useState } from "react";

const artwork = new URL("./assets/focus-optic.webp", import.meta.url).href;
type Point = { x: number; y: number };
const seeds: Point[] = [
  { x: 202, y: 240 },
  { x: 257, y: 206 },
  { x: 329, y: 225 },
  { x: 503, y: 120 },
];
const home = seeds[0];
const magnification = 1.48;
const corners =
  "M-34-17v-9q0-8 8-8h9m34 0h9q8 0 8 8v9m0 34v9q0 8-8 8h-9m-34 0h-9q-8 0-8-8v-9";

export default function LandingOptic() {
  const id = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const lens = useRef<SVGGElement>(null);
  const sample = useRef<SVGGElement>(null);
  const near = useRef<SVGPathElement>(null);
  const far = useRef<SVGPathElement>(null);
  const shine = useRef<SVGPathElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const scene = svg.current,
      glass = lens.current,
      zoom = sample.current;
    const front = near.current,
      back = far.current,
      highlight = shine.current;
    if (!loaded || !scene || !glass || !zoom || !front || !back || !highlight)
      return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    let position = home,
      target = home,
      frame = 0;

    function pose(at: Point, spread = 0, sweep = 0) {
      position = at;
      glass!.setAttribute("transform", `translate(${at.x} ${at.y})`);
      zoom!.setAttribute(
        "transform",
        `scale(${magnification}) translate(${-at.x} ${-at.y})`,
      );
      front!.setAttribute(
        "transform",
        `translate(${-32 * spread} ${13 * spread}) rotate(${-20 * spread}) scale(${1 + 0.45 * spread} ${1 + 0.18 * spread})`,
      );
      back!.setAttribute(
        "transform",
        `translate(${42 * spread} ${-20 * spread}) rotate(${34 * spread}) scale(${1 + 0.72 * spread} ${1 - 0.28 * spread})`,
      );
      back!.setAttribute("opacity", String(0.22 + 0.55 * spread));
      highlight!.setAttribute("transform", `translate(${sweep * 126} 0)`);
      highlight!.setAttribute(
        "opacity",
        String(0.42 * Math.sin(Math.PI * sweep)),
      );
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      target = home;
      pose(home);
    }

    function travel(
      to: Point,
      duration: number,
      then?: (time: number) => void,
    ) {
      cancelAnimationFrame(frame);
      target = to;
      const from = position;
      const start = performance.now();
      const lift = Math.min(
        66,
        Math.hypot(to.x - from.x, to.y - from.y) * 0.24,
      );
      function step(time: number) {
        const t = Math.min(1, Math.max(0, (time - start) / duration));
        const eased = t * t * (3 - 2 * t);
        const arc = Math.sin(Math.PI * eased);
        pose(
          {
            x: from.x + (to.x - from.x) * eased,
            y: from.y + (to.y - from.y) * eased - lift * arc,
          },
          arc,
          t,
        );
        if (t < 1) frame = requestAnimationFrame(step);
        else {
          frame = 0;
          pose(to);
          then?.(time);
        }
      }
      frame = requestAnimationFrame(step);
    }

    function aim(event: PointerEvent) {
      if (
        event.pointerType === "touch" ||
        !fine.matches ||
        reduced.matches ||
        document.hidden
      )
        return;
      const matrix = scene!.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      let closest: Point | null = null,
        distance = 66;
      for (const seed of seeds) {
        const delta = Math.hypot(point.x - seed.x, point.y - seed.y);
        if (delta < distance) {
          closest = seed;
          distance = delta;
        }
      }
      if (closest && closest !== target) travel(closest, 720);
    }

    function preference() {
      if (reduced.matches || document.hidden) stop();
    }
    if (!reduced.matches && !document.hidden) {
      pose({ x: 338, y: 86 }, 0.8);
      travel(seeds[3], 920, (arrived) => {
        function hold(time: number) {
          if (time - arrived < 340) frame = requestAnimationFrame(hold);
          else travel(home, 1420);
        }
        frame = requestAnimationFrame(hold);
      });
    }
    scene.addEventListener("pointermove", aim);
    reduced.addEventListener("change", preference);
    document.addEventListener("visibilitychange", preference);
    return () => {
      cancelAnimationFrame(frame);
      scene.removeEventListener("pointermove", aim);
      reduced.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", preference);
    };
  }, [loaded]);

  return (
    <div className="landing-optic" aria-hidden="true">
      <svg
        ref={svg}
        className="optic-scene"
        viewBox="0 0 660 440"
        focusable="false"
      >
        <defs>
          <filter
            id={id + "-rind"}
            colorInterpolationFilters="sRGB"
            x="0"
            y="0"
            width="100%"
            height="100%"
          >
            {/* Separate the green/yellow peel from the red flesh and lavender glass. */}
            <feColorMatrix
              in="SourceGraphic"
              result="peel"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.35 4.5 -3.15 0 -.09"
            />
            <feColorMatrix
              in="SourceGraphic"
              result="mint"
              values=".31 .07 .58 0 0  .05 .88 .08 0 0  .11 .55 .34 0 0  0 0 0 1 0"
            />
            <feComposite in="mint" in2="peel" operator="in" />
            <feComposite in2="SourceGraphic" operator="over" />
          </filter>
          <image
            id={id + "-art"}
            href={artwork}
            width="660"
            height="440"
            filter={`url(#${id}-rind)`}
            onLoad={() => setLoaded(true)}
          />
          <clipPath id={id + "-glass"}>
            <rect x="-27" y="-27" width="54" height="54" rx="8" />
          </clipPath>
        </defs>
        <use href={"#" + id + "-art"} />
        <g ref={lens} transform="translate(202 240)">
          <path
            ref={far}
            d={corners}
            fill="none"
            stroke="#664693"
            strokeWidth="1.8"
            strokeLinejoin="round"
            opacity=".22"
          />
          <g clipPath={`url(#${id}-glass)`}>
            <g ref={sample} transform="scale(1.48) translate(-202 -240)">
              <use href={"#" + id + "-art"} />
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
              ref={shine}
              d="M-68-34h12L-75 34h-12z"
              fill="#fff"
              opacity="0"
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
            strokeWidth="1.4"
          />
          <path
            ref={near}
            d={corners}
            fill="none"
            stroke="#95203e"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
