import { canvasRenderer } from "./melonCanvas";
import {
  coast,
  heroRestPhase,
  groupLoads,
  melonGroups,
  modelPoses,
  orbit,
  pixels,
  trackingAnchor,
  world,
  type Vec,
  type MelonFilter,
  type ModelState,
  type ObjectName,
} from "./melonModel";
import { glassHalfDepth, radii, sectionCuts } from "./melonRenderGeometry";
import { webGLRenderer, type SceneFrame } from "./melonWebGL";
export type { MelonFilter } from "./melonModel";

type Events = {
  ready: (mode: "webgl" | "canvas" | "poster") => void;
  target: (name: ObjectName) => void;
  select?: (filter: MelonFilter) => void;
  paused: (value: boolean) => void;
  track: (x: number, y: number) => void;
};
export function mountMelon(
  glCanvas: HTMLCanvasElement,
  plane: HTMLCanvasElement,
  surface: HTMLElement,
  initial: ModelState,
  hero: boolean,
  compact: boolean,
  events: Events,
  forceFallback = false,
) {
  let hardware: ReturnType<typeof webGLRenderer> = null;
  try {
    if (!forceFallback) hardware = webGLRenderer(glCanvas, hero);
  } catch {
    /* 2D uses a separate context. */
  }
  const renderer = hardware ?? canvasRenderer(plane, hero);
  if (!renderer) {
    events.ready("poster");
    return null;
  }
  const scene = renderer;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const rotations = { fruit: orbit(), frame: orbit() };
  const nudges = { fruit: { yaw: 0, pitch: 0 }, frame: { yaw: 0, pitch: 0 } };
  let target: ObjectName = "fruit",
    paused = reduced.matches;
  let model = initial,
    loads = groupLoads(model),
    focus = melonGroups.map((g) => Number(model.active === g));
  const occupied = melonGroups.map((g) => Number((model.counts?.[g] ?? 0) > 0));
  let anchor = hero ? null : trackingAnchor(initial.tracking);
  const depths = sectionCuts(hero);
  const samples: Vec[][] = scene.centers.map((_, i) =>
    [depths[i], depths[i + 1]].flatMap((z) =>
      Array.from(
        { length: 7 },
        (_, j) =>
          [
            radii[0] * Math.sqrt(1 - z * z) * Math.cos((j * Math.PI) / 6),
            -radii[1] * Math.sqrt(1 - z * z) * Math.sin((j * Math.PI) / 6),
            radii[2] * z,
          ] as Vec,
      ),
    ),
  );
  const framePoints: Vec[] = [];
  for (const x of [-0.836, 0.836])
    for (const y of [-0.906, 0.906])
      for (const z of [-glassHalfDepth, glassHalfDepth])
        framePoints.push([x, y, z]);
  let backingWidth = 1,
    backingHeight = 1,
    baseScale = 1;
  let request = 0,
    lastTick = 0,
    lastDraw = 0,
    phase = hero && reduced.matches ? heroRestPhase : 0,
    pickFrame: SceneFrame | null = null;
  let shown = false,
    resetting = false,
    disposed = false,
    width = 0,
    height = 0,
    first = true;
  let drag: {
    id: number;
    object: ObjectName;
    startX: number;
    startY: number;
    x: number;
    y: number;
    last: number;
    hit: number;
    moved: boolean;
  } | null = null;
  const cap = (v: number, max: number) => Math.min(max, Math.max(-max, v));
  function canDraw() {
    return !disposed && shown && width > 0 && height > 0 && !document.hidden;
  }
  function schedule() {
    if (!request && canDraw()) request = requestAnimationFrame(tick);
  }
  function draw() {
    const poses = modelPoses(
      hero,
      phase,
      rotations.fruit,
      rotations.frame,
      focus,
      loads,
      occupied,
      scene.centers,
    );
    // Keep the outermost section in view even when two independent manual turns
    // bring a rear cut toward the lens. The gauge and floor stay at the same scale.
    let reachX = 0,
      reachY = 0;
    const measure = (p: Vec) => {
      const k = 8 / (8 - p[2]);
      reachX = Math.max(reachX, Math.abs(p[0]) * k);
      reachY = Math.max(reachY, Math.abs(p[1]) * k);
    };
    samples.forEach((points, i) =>
      points.forEach((p) => measure(world(p, poses.fruit[i]))),
    );
    framePoints.forEach((p) => measure(world(p, poses.frame)));
    poses.specimens?.forEach((pose) => {
      if (!pose.size) return;
      for (const x of [-0.5, 0.5])
        for (const y of [-0.5, 0.5]) measure(world([x, y, 0.04], pose));
    });
    const scale = Math.min(
      baseScale,
      (backingWidth * 0.485) / Math.max(0.1, reachX),
      (backingHeight * 0.475) / Math.max(0.1, reachY),
    );
    scene.resize(backingWidth, backingHeight, scale);
    pickFrame = { ...poses, focus, loads, occupied };
    scene.draw(pickFrame);
    if (anchor) {
      const [x, y] = pixels(
        world(anchor.point, poses.fruit[anchor.index]),
        backingWidth,
        backingHeight,
        scale,
      );
      events.track((x / backingWidth) * width, (y / backingHeight) * height);
    }
    if (first) {
      first = false;
      events.ready(hardware ? "webgl" : "canvas");
    }
  }
  function tick(time: number) {
    request = 0;
    if (!canDraw()) return;
    // A floating instrument has no high-frequency detail at rest. Direct manipulation
    // still draws at the refresh rate when the renderer supports it.
    const interval = hardware && (hero || drag) ? 0 : 1000 / 30;
    if (lastDraw && time - lastDraw < interval - 0.8) {
      schedule();
      return;
    }
    const dt = lastTick ? Math.min((time - lastTick) / 1000, 0.05) : 0;
    lastDraw =
      interval && lastDraw
        ? lastDraw +
          Math.max(1, Math.floor((time - lastDraw + 0.8) / interval)) * interval
        : time;
    lastTick = time;
    if (!paused) phase += dt;
    let moving = false;
    if (resetting) {
      const remaining = Math.exp(-8 * dt);
      for (const a of Object.values(rotations)) {
        a.yaw *= remaining;
        a.pitch *= remaining;
      }
      resetting = Object.values(rotations).some(
        (a) => Math.abs(a.yaw) + Math.abs(a.pitch) > 0.001,
      );
      moving = resetting;
    }
    for (const key of ["fruit", "frame"] as const) {
      const a = rotations[key];
      const nudge = nudges[key];
      if (Math.abs(nudge.yaw) + Math.abs(nudge.pitch) > 0.0001) {
        const blend = paused ? 1 : 1 - Math.exp(-16 * dt);
        a.yaw += nudge.yaw * blend;
        a.pitch += nudge.pitch * blend;
        nudge.yaw *= 1 - blend;
        nudge.pitch *= 1 - blend;
        moving = true;
      }
      if (
        drag?.object !== key &&
        !paused &&
        Math.abs(a.vx) + Math.abs(a.vy) > 0.015
      ) {
        coast(a, dt);
        moving = true;
      }
    }
    const ease = paused ? 1 : 1 - Math.exp(-8 * dt);
    const newLoads = groupLoads(model);
    melonGroups.forEach((group, i) => {
      const active = Number(group === model.active);
      const hasIncidents = Number((model.counts?.[group] ?? 0) > 0);
      occupied[i] += (hasIncidents - occupied[i]) * ease;
      focus[i] += (active - focus[i]) * ease;
      loads[i] += (newLoads[i] - loads[i]) * ease;
      if (
        Math.abs(active - focus[i]) +
          Math.abs(newLoads[i] - loads[i]) +
          Math.abs(hasIncidents - occupied[i]) >
        0.001
      )
        moving = true;
    });
    draw();
    if (moving || !paused) schedule();
    else {
      lastTick = 0;
      lastDraw = 0;
    }
  }
  function visibility() {
    if (canDraw()) schedule();
    else {
      cancelAnimationFrame(request);
      request = 0;
      lastTick = 0;
      lastDraw = 0;
    }
  }
  function resize() {
    const rect = surface.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const maxPixels = hero ? 830 : 560;
    const ratio = Math.min(
      devicePixelRatio || 1,
      compact ? 1.6 : 2,
      maxPixels / Math.max(1, width),
    );
    const w = Math.max(1, Math.round(width * ratio)),
      h = Math.max(1, Math.round(height * ratio));
    backingWidth = w;
    backingHeight = h;
    baseScale = hero
      ? Math.min(w / 4.12, h / 2.83)
      : Math.min(w / 3.14, h / 2.04);
    schedule();
  }
  function choose(name: ObjectName) {
    target = name;
    events.target(name);
  }
  function setPaused(value: boolean) {
    paused = value;
    if (value) {
      resetting = false;
      for (const a of Object.values(rotations)) {
        a.vx = 0;
        a.vy = 0;
      }
    }
    events.paused(value);
    schedule();
  }
  function reset() {
    for (const nudge of Object.values(nudges)) nudge.yaw = nudge.pitch = 0;
    if (hero && !paused) {
      for (const a of Object.values(rotations)) {
        a.yaw = Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw));
        a.pitch = Math.atan2(Math.sin(a.pitch), Math.cos(a.pitch));
        a.vx = a.vy = 0;
      }
      resetting = true;
      schedule();
      return;
    }
    Object.assign(rotations.fruit, orbit());
    Object.assign(rotations.frame, orbit());
    phase = hero ? heroRestPhase : 0;
    schedule();
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || drag || !pickFrame) return;
    const rect = surface.getBoundingClientRect();
    const hit = scene.pick(
      pickFrame,
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
    if (!hit && e.pointerType === "touch") return;
    const selected = hit === 5 ? "frame" : hit > 0 ? "fruit" : target;
    choose(selected);
    resetting = false;
    nudges[selected].yaw = nudges[selected].pitch = 0;
    const a = rotations[selected];
    a.vx = 0;
    a.vy = 0;
    drag = {
      id: e.pointerId,
      object: selected,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      last: e.timeStamp,
      hit,
      moved: false,
    };
    surface.setPointerCapture(e.pointerId);
    surface.dataset.dragging = "true";
    surface.focus({ preventScroll: true });
  }
  function move(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4
    )
      return;
    drag.moved = true;
    const a = rotations[drag.object];
    const angle = 3.6 / Math.max(165, Math.min(width, height * 1.5));
    a.yaw += dx * angle;
    a.pitch += dy * angle;
    const elapsed = Math.max(4, e.timeStamp - drag.last) / 1000;
    const blend = 1 - Math.exp(-elapsed * 24);
    a.vx += (cap((dx * angle) / elapsed, 4.2) - a.vx) * blend;
    a.vy += (cap((dy * angle) / elapsed, 4.2) - a.vy) * blend;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.last = e.timeStamp;
    schedule();
  }
  function end(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const prev = drag;
    drag = null;
    if (surface.hasPointerCapture(e.pointerId))
      surface.releasePointerCapture(e.pointerId);
    delete surface.dataset.dragging;
    if (e.type !== "pointerup" || e.timeStamp - prev.last > 110) {
      rotations[prev.object].vx = 0;
      rotations[prev.object].vy = 0;
    }
    if (
      e.type === "pointerup" &&
      !prev.moved &&
      !hero &&
      prev.hit >= 1 &&
      prev.hit <= 4
    ) {
      const g = melonGroups[prev.hit - 1];
      events.select?.(g === model.active ? "all" : g);
    }
    schedule();
  }
  function keyboard(e: KeyboardEvent) {
    resetting = false;
    const a = hero && !paused ? nudges[target] : rotations[target],
      step = e.shiftKey ? 0.42 : 0.14;
    switch (e.key) {
      case "1":
        choose("fruit");
        break;
      case "2":
        choose("frame");
        break;
      case "Enter": {
        if (!events.select) return;
        const index =
          model.active === "all" ? -1 : melonGroups.indexOf(model.active);
        if (!e.repeat) events.select(melonGroups[index + 1] ?? "all");
        break;
      }
      case "ArrowLeft":
        a.yaw -= step;
        break;
      case "ArrowRight":
        a.yaw += step;
        break;
      case "ArrowUp":
        a.pitch -= step;
        break;
      case "ArrowDown":
        a.pitch += step;
        break;
      case "Home":
        reset();
        break;
      case " ":
        if (!e.repeat) setPaused(!paused);
        break;
      default:
        return;
    }
    e.preventDefault();
    schedule();
  }
  const motionChange = () => {
    if (hero && reduced.matches) phase = heroRestPhase;
    setPaused(reduced.matches);
  };
  const root = document.documentElement;
  function updateTheme() {
    const dark = root.dataset.theme === "dark";
    const background = getComputedStyle(
      surface.closest(".landing") ?? root,
    ).backgroundColor;
    const rgb = background.match(/[\d.]+/g)?.map(Number);
    const paper: Vec =
      rgb && background.startsWith("rgb") && rgb.length >= 3 && rgb[3] !== 0
        ? [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
        : dark
          ? [0.071, 0.065, 0.085]
          : [0.886, 0.878, 0.933];
    scene.theme(dark, paper);
    schedule();
  }
  const palette = new MutationObserver(updateTheme);
  palette.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  updateTheme();
  const obs = new ResizeObserver(resize);
  obs.observe(surface);
  const intersect = new IntersectionObserver(([entry]) => {
    shown = entry.isIntersecting;
    visibility();
  });
  intersect.observe(surface);
  const abort = new AbortController();
  const listener = { signal: abort.signal };
  surface.addEventListener("pointerdown", down, listener);
  surface.addEventListener("pointermove", move, listener);
  surface.addEventListener("pointerup", end, listener);
  surface.addEventListener("pointercancel", end, listener);
  surface.addEventListener("lostpointercapture", end, listener);
  surface.addEventListener("dblclick", reset, listener);
  surface.addEventListener("keydown", keyboard, listener);
  document.addEventListener("visibilitychange", visibility, listener);
  reduced.addEventListener("change", motionChange, listener);
  events.paused(paused);
  resize();
  return {
    select(data: ModelState) {
      model = data;
      anchor = hero ? null : trackingAnchor(data.tracking);
      schedule();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(request);
      abort.abort();
      intersect.disconnect();
      palette.disconnect();
      obs.disconnect();
      scene.dispose();
    },
  };
}
