import { glassMesh, melonMesh } from "./melonRenderGeometry";
import { fragmentSource, vertexSource } from "./melonRenderShaders";
import type { Pose } from "./melonModel";

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
};
export interface SceneRenderer {
  centers: number[];
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
    glass = glassMesh();
  const floor = new Float32Array([
    -1, -1, 0, 0, 0, 1, 0, 3, -1, 0, 0, 0, 1, 0, -1, 3, 0, 0, 0, 1, 0,
  ]);
  const glassFirst = mesh.vertices.length / 7,
    floorFirst = glassFirst + glass.length / 7;
  const data = new Float32Array(
    mesh.vertices.length + glass.length + floor.length,
  );
  data.set(mesh.vertices);
  data.set(glass, mesh.vertices.length);
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
      "viewport",
      "loads",
      "selection",
      "occupied",
      "pick",
      "backdrop",
    ].map((k) => [k, uniform(k)]),
  );
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
    height = 0;
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
    pose(frame.frame);
    if (!picking) {
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
      // Populate the nearest glass surface first to prevent self-blending along the bevel.
      gl.colorMask(false, false, false, false);
      gl.drawArrays(gl.TRIANGLES, glassFirst, glass.length / 7);
      gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLES, glassFirst, glass.length / 7);
    gl.depthFunc(gl.LESS);
  }
  return {
    centers: mesh.sections.map((s) => s.center),
    resize(w, h, scale) {
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
      draw(frame, true);
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.min(width - 1, Math.max(0, Math.floor(x * width))),
        Math.min(height - 1, Math.max(0, Math.floor((1 - y) * height))),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      draw(frame);
      return pixel[0];
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteTexture(backdrop);
      gl.deleteProgram(program);
    },
  };
}
