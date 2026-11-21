import { memo, useEffect, useRef } from "react";

// The rind is a curved extrusion. Its section and the pips share the same
// object coordinates, so the cut stays attached as the viewing angle changes.
type Point = [number, number];
const radius = 42;
const halfDepth = 9;
const shell = Array.from({ length: 31 }, (_, i): Point => {
  const angle = (Math.PI * i) / 30;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.88];
});
function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  sheen: number,
  dark: boolean,
) {
  const yaw = -0.45 + 0.25 * Math.sin(phase);
  const pitch = 0.39 + 0.07 * Math.cos(phase);
  const roll = -0.29;
  function project(x: number, y: number, z: number): Point {
    const u = x * Math.cos(yaw) + z * Math.sin(yaw);
    const v =
      y * Math.cos(pitch) -
      (z * Math.cos(yaw) - x * Math.sin(yaw)) * Math.sin(pitch);
    return [
      u * Math.cos(roll) - v * Math.sin(roll),
      u * Math.sin(roll) + v * Math.cos(roll),
    ];
  }
  function polygon(points: Point[], fill: string) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = fill;
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  const scale = Math.min(width / 103, height / 69);
  ctx.resetTransform();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.translate(0, -16);
  for (let i = 0; i < shell.length - 1; i++) {
    const [x, y] = shell[i],
      [nx, ny] = shell[i + 1];
    const light = (dark ? 25 : 20) + 13 * Math.cos((i / 30) * Math.PI);
    polygon(
      [
        project(x, y, -halfDepth),
        project(nx, ny, -halfDepth),
        project(nx, ny, halfDepth),
        project(x, y, halfDepth),
      ],
      `hsl(165 38% ${light}%)`,
    );
  }
  // Top edge of the cut carries its own flesh and pale rind.
  const cap = (x: number, to: number, fill: string) =>
    polygon(
      [
        project(x, 0, -halfDepth),
        project(to, 0, -halfDepth),
        project(to, 0, halfDepth),
        project(x, 0, halfDepth),
      ],
      fill,
    );
  cap(-radius, radius, "#358a77");
  cap(-39, 39, "#b9e0cd");
  cap(-36.5, 36.5, dark ? "#ff97b4" : "#ff739a");
  const [ox, oy] = project(0, 0, halfDepth),
    [ax, ay] = project(1, 0, halfDepth),
    [bx, by] = project(0, 1, halfDepth);
  ctx.transform(ax - ox, ay - oy, bx - ox, by - oy, ox, oy);
  function section(r: number, paint: string | CanvasGradient) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.88, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = paint;
    ctx.fill();
  }
  section(radius, dark ? "#78c4a6" : "#276d5c");
  section(39.7, dark ? "#c9e8d3" : "#a8d3b7");
  const flesh = ctx.createLinearGradient(-30, 0, 27, 29);
  flesh.addColorStop(0, dark ? "#fd9ab5" : "#ff83a4");
  flesh.addColorStop(0.49, dark ? "#ed628e" : "#f85482");
  flesh.addColorStop(1, dark ? "#b53564" : "#c12d5c");
  section(37.4, flesh);
  for (const [x, y, tilt] of [
    [-22, 7, 0.75],
    [-12, 18, 0.42],
    [1, 23, -0.1],
    [15, 17, -0.52],
    [24, 6, -0.88],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = "#4c2846";
    ctx.beginPath();
    ctx.moveTo(0, -3.5);
    ctx.bezierCurveTo(3.1, 0.6, 1.6, 3.8, -0.2, 3.2);
    ctx.bezierCurveTo(-2.4, 2.7, -2.4, 0.1, 0, -3.5);
    ctx.fill();
    ctx.restore();
  }
  if (sheen > 0 && sheen < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 37.4, 32.9, 0, 0, Math.PI);
    ctx.clip();
    const x = -58 + 116 * sheen,
      light = ctx.createLinearGradient(x - 10, 0, x + 10, 7);
    light.addColorStop(0, "transparent");
    light.addColorStop(0.5, "rgba(255,242,252,.45)");
    light.addColorStop(1, "transparent");
    ctx.fillStyle = light;
    ctx.fillRect(-42, 0, 84, 39);
    ctx.restore();
  }
}
export default memo(function ShiftSlice({ revision }: { revision: number }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    changed = useRef(-Infinity),
    last = useRef(revision);
  useEffect(() => {
    if (last.current !== revision) {
      last.current = revision;
      changed.current = performance.now();
    }
  }, [revision]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      visible = true;
    const redraw = (time: number) => {
      cancelAnimationFrame(frame);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr),
        h = Math.round(el.clientHeight * dpr);
      if (w && h) {
        if (el.width !== w || el.height !== h) {
          el.width = w;
          el.height = h;
        }
        draw(
          ctx,
          w,
          h,
          motion.matches ? 0 : time * 0.00028,
          motion.matches ? 0 : (time - changed.current) / 1050,
          document.documentElement.dataset.theme === "dark",
        );
        el.dataset.ready = "true";
      }
      if (!document.hidden && visible && !motion.matches)
        frame = requestAnimationFrame(redraw);
    };
    const refresh = () => redraw(performance.now());
    const size = new ResizeObserver(refresh);
    size.observe(el);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    intersection.observe(el);
    motion.addEventListener("change", refresh);
    window.addEventListener("srez-appearance", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", refresh);
      window.removeEventListener("srez-appearance", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <span className="shift-slice" aria-hidden="true">
      <canvas ref={canvas} data-testid="shift-slice" />
      <svg viewBox="0 0 96 64">
        <g transform="rotate(-16 48 32)">
          <path d="M6 12h85a41 37 0 0 1-82 8Z" fill="#327664" />
          <path d="M6 12h80a40 35 0 0 1-80 0Z" fill="#afe2c3" />
          <path d="M9 12h74a37 32 0 0 1-74 0Z" fill="#ed5e87" />
          <path
            d="m22 18 3 5m9 2 2 6m12-4v6m12-9-2 6m13-12-3 5"
            fill="none"
            stroke="#54314b"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </span>
  );
});
