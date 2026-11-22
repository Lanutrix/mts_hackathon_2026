import { memo, useLayoutEffect, useRef } from "react";

// The rind is a curved extrusion. Its section and the pips share the same
// object coordinates, so the cut stays attached as the viewing angle changes.
type Point = [number, number];
const radius = 42;
const halfDepth = 9;
const pips = [
  { x: -16, y: 12, angle: 0.65 }, { x: 17, y: 12, angle: -0.65 },
  { x: -6, y: 24, angle: 0.19 }, { x: 6, y: 24, angle: -0.19 },
];
const pipScale = (share: number, index: number) => Math.sqrt(Math.max(0, Math.min(1, 4 * share - index)));
const shell = Array.from({ length: 31 }, (_, i): Point => {
  const angle = (Math.PI * i) / 30;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.88];
});
function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tilt: number,
  overdueShare: number,
  consequenceShare: number,
  dark: boolean,
) {
  const yaw = -0.45 + 0.16 * tilt;
  const pitch = 0.42 + 0.05 * tilt;
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
  cap(-36.5, 36.5, dark ? "#9cd2bd" : "#89c5ac");
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
  flesh.addColorStop(0, dark ? "#81bdab" : "#93cbb5");
  flesh.addColorStop(1, dark ? "#387d6d" : "#438872");
  section(37.4, flesh);
  if (overdueShare > 0) {
    const pink = ctx.createLinearGradient(-27, 0, 24, 29);
    pink.addColorStop(0, dark ? "#ff9ab8" : "#ff86a6");
    pink.addColorStop(1, dark ? "#d34b7a" : "#c93b6a");
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.ellipse(0, 0, 37.4, 37.4 * 0.88, 0, Math.PI * (1 - overdueShare), Math.PI);
    ctx.closePath();
    ctx.fillStyle = pink;
    ctx.fill();
  }
  for (const [i, pip] of pips.entries()) {
    const size = pipScale(consequenceShare, i);
    if (!size) break;
    ctx.save();
    ctx.translate(pip.x, pip.y);
    ctx.rotate(pip.angle);
    ctx.scale(size * 0.7, size * 0.7);
    ctx.fillStyle = "#342639";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.bezierCurveTo(3, -3, 7, 5, 1, 6);
    ctx.bezierCurveTo(-5, 7, -5, 1, 0, -7);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = "#f3ead8";
    ctx.stroke();
    ctx.restore();
  }
}
const legend = "Розовый сектор — доля просроченных. Полная косточка — четверть выборки с отметкой об устранении последствий.";
export default memo(function ShiftSlice({ total, overdue, consequences, loading }: {
  total: number; overdue: number; consequences: number; loading: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = !loading && total > 0;
  const overdueShare = ready ? overdue / total : 0;
  const consequenceShare = ready ? consequences / total : 0;
  const shown = useRef<{ overdue: number; consequences: number } | null>(null);
  useLayoutEffect(() => {
    const from = shown.current;
    if (!ready) shown.current = null;
    const el = canvas.current,
      ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const started = performance.now();
    let frame = 0,
      visible = true;
    const redraw = (time: number) => {
      cancelAnimationFrame(frame);
      const progress = from && !motion.matches ? Math.min(1, Math.max(0, (time - started) / 680)) : 1;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr),
        h = Math.round(el.clientHeight * dpr);
      if (w && h) {
        if (el.width !== w || el.height !== h) {
          el.width = w;
          el.height = h;
        }
        const remaining = (1 - progress) ** 3;
        const sample = { overdue: overdueShare + ((from?.overdue ?? overdueShare) - overdueShare) * remaining,
          consequences: consequenceShare + ((from?.consequences ?? consequenceShare) - consequenceShare) * remaining };
        shown.current = sample;
        draw(
          ctx,
          w,
          h,
          Math.sin(progress * Math.PI),
          sample.overdue,
          sample.consequences,
          document.documentElement.dataset.theme === "dark",
        );
        el.dataset.ready = "true";
      }
      if (!document.hidden && visible && progress < 1)
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
  }, [ready, overdueShare, consequenceShare]);
  const label = loading ? "Загрузка выборки" : !total ? "В выборке нет заявок под наблюдением" :
    `Просрочены ${overdue} из ${total}. Отметка об устранении последствий у ${consequences} из ${total}.`;
  const theta = Math.PI * (1 - overdueShare);
  return (
    <span className="shift-slice" role="img" tabIndex={0}
      aria-label={`Срез очереди. ${label}`} data-hint={ready ? label + " " + legend : label}>
      {ready && <canvas ref={canvas} data-testid="shift-slice" aria-hidden="true" />}
      <svg viewBox="0 0 96 64" aria-hidden="true">
        <g transform="rotate(-16 48 32)">
          {ready ? <>
            <path d="M6 12h85a41 37 0 0 1-82 8Z" fill="#327664" />
            <path d="M6 12h80a40 35 0 0 1-80 0Z" fill="#afe2c3" />
            <path d="M9 12h74a37 32 0 0 1-74 0Z" fill="#70ab94" />
            {overdueShare > 0 && <path d={`M46 12 L${46 + 37 * Math.cos(theta)} ${12 + 32 * Math.sin(theta)} A37 32 0 0 1 9 12Z`} fill="#e85d87" />}
            {pips.map((pip, i) => {
              const size = pipScale(consequenceShare, i);
              return size > 0 && <path key={i} d="M0-5C3-2 4 4 0 4S-3 0 0-5Z" fill="#342639" stroke="#f3ead8"
                strokeWidth=".7" transform={`translate(${46 + pip.x} ${12 + pip.y}) rotate(${pip.angle * 180 / Math.PI}) scale(${size})`} />;
            })}
          </> : <path d="M7 13h81a41 35 0 0 1-81 0Z" fill="none" stroke="currentColor"
            strokeWidth="3" strokeDasharray={loading ? "7 5" : undefined} />}
        </g>
      </svg>
    </span>
  );
});
