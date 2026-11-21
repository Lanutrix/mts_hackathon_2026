import { glassMesh, glassPlate, melonMesh } from "./melonRenderGeometry";
import { fragmentSource, vertexSource } from "./melonRenderShaders";
import { pixels, rotate, world, type Pose } from "./melonModel";
import { specimenDecals } from "./melonSpecimen";

function makeProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) return null;
  const shaders: WebGLShader[] = [];
  let linked = false;
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
    linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    return linked ? program : null;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
    if (!linked) gl.deleteProgram(program);
  }
}

export type SceneFrame = {
  fruit: Pose[];
  frame: Pose;
  focus: number[];
  loads: number[];
  occupied: number[];
  specimens?: Pose[];
};
export interface SceneRenderer {
  centers: number[];
  theme(dark: boolean, paper: [number, number, number]): void;
  resize(width: number, height: number, scale: number): void;
  draw(frame: SceneFrame): void;
  pick(frame: SceneFrame, x: number, y: number): number;
  dispose(): void;
}

export function webGLRenderer(
  canvas: HTMLCanvasElement,
  hero: boolean,
): SceneRenderer | null {
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
  const buffer = gl.createBuffer(),
    backdrop = gl.createTexture();
  if (!buffer || !backdrop) {
    gl.deleteBuffer(buffer);
    gl.deleteTexture(backdrop);
    gl.deleteProgram(program);
    return null;
  }
  const mesh = melonMesh(hero),
    glass = glassMesh(12, 5, hero);
  const pane = hero ? glassPlate(0.766, 0.008, 4) : new Float32Array();
  const specimen = hero ? glassPlate(0.5, 0.036, 5) : new Float32Array();
  const floor = new Float32Array([
    -1, -1, 0, 0, 0, 1, 0, 3, -1, 0, 0, 0, 1, 0, -1, 3, 0, 0, 0, 1, 0,
  ]);
  const glassFirst = mesh.vertices.length / 7,
    specimenFirst = glassFirst + (glass.length + pane.length) / 7,
    floorFirst = specimenFirst + specimen.length / 7;
  const data = new Float32Array(floorFirst * 7 + floor.length);
  data.set(mesh.vertices);
  data.set(glass, mesh.vertices.length);
  data.set(pane, mesh.vertices.length + glass.length);
  data.set(specimen, specimenFirst * 7);
  data.set(floor, floorFirst * 7);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [name, size, offset] of [
    ["a_point", 3, 0],
    ["a_normal", 3, 12],
    ["a_material", 1, 24],
  ] as const) {
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, offset);
  }
  const uniform = (name: string) => gl.getUniformLocation(program, "u_" + name);
  const uniforms = Object.fromEntries(
    [
      "rotation",
      "camera",
      "translation",
      "origin",
      "size",
      "scale",
      "pivot",
      "floor",
      "index",
      "focus",
      "hero",
      "dark",
      "paper",
      "scannerPlane",
      "glassSide",
      "viewport",
      "loads",
      "selection",
      "occupied",
      "pick",
      "backdrop",
      "decal",
    ].map((k) => [k, uniform(k)]),
  );
  const decal = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, decal);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (hero)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      specimenDecals(),
    );
  else
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  gl.uniform1i(uniforms.decal, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backdrop);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.backdrop, 0);
  gl.uniform1f(uniforms.hero, hero ? 1 : 0);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.DITHER);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.clearColor(0, 0, 0, 0);
  let width = 0,
    height = 0,
    renderScale = 0;
  function captureGlass(p: Pose, small: boolean) {
    let x = 0,
      y = 0,
      w = width,
      h = height;
    if (small) {
      const corners = [-0.5, 0.5].flatMap((u) =>
        [-0.5, 0.5].map((v) =>
          pixels(world([u, v, 0], p), width, height, renderScale),
        ),
      );
      const xs = corners.map((pt) => pt[0]);
      const ys = corners.map((pt) => height - pt[1]);
      // Include the projected bevel and the furthest chromatic refraction tap.
      const padx = width * 0.055 + 3,
        pady = height * 0.055 + 3;
      x = Math.max(0, Math.floor(Math.min(...xs) - padx));
      y = Math.max(0, Math.floor(Math.min(...ys) - pady));
      w = Math.min(width, Math.ceil(Math.max(...xs) + padx)) - x;
      h = Math.min(height, Math.ceil(Math.max(...ys) + pady)) - y;
    }
    if (w > 0 && h > 0)
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x, y, x, y, w, h);
  }
  function pose(p: Pose) {
    gl.uniform3fv(uniforms.rotation, p.twist);
    gl.uniform3fv(uniforms.translation, p.offset);
    gl.uniform3fv(uniforms.camera, p.camera);
    gl.uniform3fv(uniforms.origin, p.origin);
    gl.uniform3fv(uniforms.pivot, p.pivot);
    gl.uniform1f(uniforms.size, p.size);
  }
  function draw(frame: SceneFrame, picking = false) {
    if (!width || gl.isContextLost()) return;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(uniforms.pick, picking ? 1 : 0);
    gl.uniform4fv(uniforms.loads, frame.loads);
    gl.uniform4fv(uniforms.occupied, frame.occupied);
    gl.uniform4fv(uniforms.selection, frame.focus);
    if (!picking) {
      gl.enable(gl.BLEND);
      gl.uniform1f(uniforms.floor, 1);
      gl.drawArrays(gl.TRIANGLES, floorFirst, 3);
    }
    gl.disable(gl.BLEND);
    gl.uniform1f(uniforms.floor, 0);
    mesh.sections.forEach((s, i) => {
      pose(frame.fruit[i]);
      gl.uniform1f(uniforms.index, i);
      gl.uniform1f(
        uniforms.focus,
        Math.max(0, 1 - frame.focus[i]) * Math.max(...frame.focus),
      );
      gl.drawArrays(gl.TRIANGLES, s.first, s.count);
    });
    let plates = [
      {
        pose: frame.frame,
        first: glassFirst,
        count: specimenFirst - glassFirst,
        index: -1,
        side: 0,
      },
      ...(frame.specimens ?? []).map((p, i) => ({
        pose: p,
        first: specimenFirst,
        count: specimen.length / 7,
        index: i,
        side: 0,
      })),
    ];
    if (hero && !picking) {
      const normal = rotate([0, 0, 1], frame.frame.camera);
      const offset = -normal.reduce(
        (s, n, i) => s + n * frame.frame.origin[i],
        0,
      );
      const towardEye = normal[2] * 8 + offset >= 0 ? 1 : -1;
      gl.uniform4f(
        uniforms.scannerPlane,
        normal[0] * towardEye,
        normal[1] * towardEye,
        normal[2] * towardEye,
        offset * towardEye,
      );
      const [scanner, ...samples] = plates;
      const rear: typeof plates = [],
        front: typeof plates = [];
      samples.sort((a, b) => a.pose.origin[2] - b.pose.origin[2]);
      for (const sample of samples) {
        const side =
          normal.reduce((s, n, i) => s + n * sample.pose.origin[i], offset) *
          towardEye;
        const radius = sample.pose.size * 0.71;
        // A crossing specimen has fragments on each side of the optic. Let
        // the cut move across its pixels instead of swapping the entire tile.
        if (side - radius <= 0) rear.push({ ...sample, side: -1 });
        if (side + radius >= 0) front.push({ ...sample, side: 1 });
      }
      plates = [...rear, scanner, ...front];
      gl.enable(gl.BLEND);
      gl.depthMask(false);
    }
    for (const plate of plates) {
      pose(plate.pose);
      gl.uniform1f(uniforms.glassSide, plate.side);
      gl.uniform1f(uniforms.index, plate.index);
      // Render one glass surface per pixel even on overlapping bevels.
      if (!picking) {
        // Each plate refracts the color already rendered behind it, including
        // sample numbers visible through the large scanner.
        captureGlass(plate.pose, plate.index >= 0);
      }
      if (!picking && !hero) {
        gl.colorMask(false, false, false, false);
        gl.drawArrays(gl.TRIANGLES, plate.first, plate.count);
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
      }
      gl.drawArrays(gl.TRIANGLES, plate.first, plate.count);
      gl.depthFunc(gl.LESS);
    }
    gl.depthMask(true);
  }
  return {
    centers: mesh.sections.map((s) => s.center),
    theme(dark, paper) {
      gl.uniform1f(uniforms.dark, Number(dark));
      gl.uniform3fv(uniforms.paper, paper);
    },
    resize(w, h, scale) {
      renderScale = scale;
      if (width !== w || height !== h) {
        width = w;
        height = h;
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          w,
          h,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        gl.uniform2f(uniforms.viewport, w, h);
      }
      gl.uniform2f(uniforms.scale, (2 * scale) / w, (2 * scale) / h);
    },
    draw,
    pick(frame, x, y) {
      const px = Math.min(width - 1, Math.max(0, Math.floor(x * width)));
      const py = Math.min(
        height - 1,
        Math.max(0, Math.floor((1 - y) * height)),
      );
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(px, py, 1, 1);
      draw(frame, true);
      const pixel = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.disable(gl.SCISSOR_TEST);
      draw(frame);
      return pixel[0];
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteTexture(backdrop);
      gl.deleteTexture(decal);
      gl.deleteProgram(program);
    },
  };
}
