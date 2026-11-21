import { melonMesh } from "./melonRenderGeometry";
import { fragmentSource, vertexSource } from "./melonRenderShaders";

export type MelonFilter =
  "all" | "critical" | "coordinators" | "high" | "research";
const groups: MelonFilter[] = ["critical", "coordinators", "high", "research"];
const weights = () => new Float32Array(4);

function makeProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) return null;
  const shaders: WebGLShader[] = [];
  try {
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(kind);
      if (!shader) return null;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    return null;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      gl.deleteProgram(program);
  }
}

export function mountMelon(
  canvas: HTMLCanvasElement,
  active: MelonFilter,
  compact: boolean,
  onReady: () => void,
) {
  const context = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: true,
    powerPreference: "low-power",
    premultipliedAlpha: true,
  });
  if (!context) return null;
  const gl = context;
  const program = makeProgram(gl);
  if (!program) return null;
  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  const mesh = melonMesh();
  const floor = new Float32Array([
    -1, -1, 0, 0, 0, 1, 0, 3, -1, 0, 0, 0, 1, 0, -1, 3, 0, 0, 0, 1, 0,
  ]);
  const data = new Float32Array(mesh.vertices.length + floor.length);
  data.set(mesh.vertices);
  data.set(floor, mesh.vertices.length);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [name, size, offset] of [
    ["a_point", 3, 0],
    ["a_normal", 3, 12],
    ["a_material", 1, 24],
  ] as const) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset);
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    rotation: uniform("u_rotation"),
    camera: uniform("u_camera"),
    translation: uniform("u_translation"),
    scale: uniform("u_scale"),
    pivot: uniform("u_pivot"),
    floor: uniform("u_floor"),
    index: uniform("u_index"),
    focus: uniform("u_focus"),
  };
  // Each section moves about its own center. Positive depth points towards
  // the lens. The larger front section forms the face of the assembled fruit.
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.clearColor(0, 0, 0, 0);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const focus = weights();
  const target = weights();
  let group = groups.indexOf(active);
  if (group >= 0) {
    focus[group] = 1;
    target[group] = 1;
  }
  let width = 0,
    height = 0,
    frame = 0,
    lastTime = 0;
  let phase = reduced.matches || compact ? 1 : 0;
  let sequence: "entry" | "change" = "entry";
  let shown = true,
    ready = false,
    disposed = false;

  function render() {
    if (!width || !height || gl.isContextLost()) return;
    const scale = Math.min(width / 4.08, height / 2.55);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(u.scale, (2 * scale) / width, (2 * scale) / height);
    gl.uniform1f(u.floor, 1);
    gl.drawArrays(gl.TRIANGLES, mesh.vertices.length / 7, 3);
    gl.uniform1f(u.floor, 0);
    const entry = sequence === "entry" ? 1 - Math.pow(1 - phase, 3) : 1;
    const pulse = sequence === "change" ? Math.sin(phase * Math.PI) ** 2 : 0;
    const yawByGroup = focus.reduce(
      (sum, amount, index) => sum + amount * (0.07 - index * 0.047),
      0,
    );
    gl.uniform3f(
      u.camera,
      0.3 + pointer.y * 0.085,
      -0.77 +
        pointer.x * 0.1 +
        yawByGroup +
        (1 - entry) * 0.065 -
        pulse * 0.045,
      -0.08 + pointer.x * 0.019,
    );
    for (let i = 0; i < mesh.sections.length; i++) {
      const section = mesh.sections[i];
      const rank = 1.5 - i,
        selected = focus[i];
      const neighbors = focus.reduce(
        (sum, amount, other) => sum + Math.sign(other - i) * amount,
        0,
      );
      const spacing = 0.274 * entry - 0.187 * pulse;
      gl.uniform1f(u.index, i);
      gl.uniform1f(
        u.focus,
        Math.max(0, focus.reduce((sum, f) => sum + f, 0) - selected),
      );
      gl.uniform1f(u.pivot, section.center);
      gl.uniform3f(
        u.translation,
        -0.076 * rank * entry + selected * 0.025,
        -rank * 0.028 * entry + selected * 0.25 + (1 - entry) * 0.045,
        rank * spacing + neighbors * 0.14 + selected * 0.045,
      );
      gl.uniform3f(
        u.rotation,
        rank * 0.035 * entry - selected * 0.09,
        0.155 * rank * entry + selected * 0.13,
        rank * 0.074 * entry + selected * 0.078,
      );
      gl.drawArrays(gl.TRIANGLES, section.first, section.count);
    }
    if (!ready) {
      ready = true;
      onReady();
    }
  }

  function canDraw() {
    return shown && !disposed && !document.hidden && !gl.isContextLost();
  }
  function schedule() {
    if (!frame && canDraw()) frame = requestAnimationFrame(tick);
  }
  function tick(time: number) {
    frame = 0;
    if (!canDraw()) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.065) : 1 / 60;
    lastTime = time;
    const ease = reduced.matches ? 1 : 1 - Math.exp(-dt * 8.4);
    phase = reduced.matches
      ? 1
      : Math.min(1, phase + dt / (sequence === "entry" ? 1.25 : 0.84));
    const approach = (value: number, goal: number) =>
      Math.abs(value - goal) < 0.0008 ? goal : value + (goal - value) * ease;
    for (let i = 0; i < 4; i++) focus[i] = approach(focus[i], target[i]);
    pointer.x = approach(pointer.x, pointer.targetX);
    pointer.y = approach(pointer.y, pointer.targetY);
    render();
    if (
      phase < 1 ||
      focus.some((f, i) => Math.abs(f - target[i]) > 0.0001) ||
      pointer.x !== pointer.targetX ||
      pointer.y !== pointer.targetY
    )
      schedule();
    else lastTime = 0;
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.65 : 2);
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    schedule();
  }
  function visibility() {
    if (canDraw()) schedule();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    }
  }
  function resetPointer() {
    pointer.targetX = 0;
    pointer.targetY = 0;
    schedule();
  }
  function movePointer(event: PointerEvent) {
    if (compact || event.pointerType !== "mouse" || reduced.matches) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.targetY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    schedule();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const observer = new IntersectionObserver(([entry]) => {
    shown = entry.isIntersecting;
    visibility();
  });
  observer.observe(canvas);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerleave", resetPointer);
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", resetPointer);
  resize();
  return {
    select(filter: MelonFilter) {
      group = groups.indexOf(filter);
      for (let i = 0; i < 4; i++) target[i] = i === group ? 1 : 0;
      phase = reduced.matches ? 1 : 0;
      sequence = "change";
      schedule();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", resetPointer);
      canvas.removeEventListener("pointermove", movePointer);
      canvas.removeEventListener("pointerleave", resetPointer);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
