import { glassMesh, radii } from "./melonRenderGeometry";
import {
  groupColors,
  pixels,
  rotate,
  world,
  type Pose,
  type Vec,
} from "./melonModel";
import type { SceneFrame, SceneRenderer } from "./melonWebGL";

interface Face {
  vertices: Vec[];
  normal: Vec;
  object: number;
  paint: string;
  uv?: number[][];
}
interface Projected {
  face: Face;
  points: [number, number][];
  depth: number;
  light: number;
}
const half = 192;
function fleshTexture() {
  const sheet = document.createElement("canvas");
  sheet.width = sheet.height = 2 * half;
  const ctx = sheet.getContext("2d")!;
  let seed = 0x24355;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, color] of [
    [0, "#ed344d"],
    [0.74, "#f84156"],
    [0.86, "#fc8797"],
    [0.905, "#fde9e4"],
    [0.945, "#daefe8"],
    [0.97, "#9fbfaf"],
    [0.977, "#386f5b"],
    [1, "#245c50"],
  ] as const)
    gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < 10000; i++) {
    const x = rand() * sheet.width,
      y = rand() * sheet.height;
    ctx.fillStyle =
      rand() > 0.5 ? "rgba(255,245,230,.15)" : "rgba(106,19,54,.12)";
    ctx.fillRect(x, y, rand() * 2.2 + 0.4, rand() * 1.8 + 0.45);
  }
  for (const [r, n] of [
    [0.43, 10],
    [0.67, 17],
  ])
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.22 + (rand() - 0.5) * 0.34) * 2 * Math.PI) / n;
      const radius = (r + (rand() - 0.5) * 0.075) * half;
      ctx.save();
      ctx.translate(half + Math.cos(a) * radius, half + Math.sin(a) * radius);
      ctx.rotate(a + 0.14);
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.bezierCurveTo(-2, -4.7, 7, -5, 7, 0);
      ctx.bezierCurveTo(6, 4.2, -2, 4.4, -7, 0);
      ctx.fillStyle = "#34222c";
      ctx.fill();
      ctx.fillStyle = "rgba(255,225,228,.49)";
      ctx.beginPath();
      ctx.ellipse(3, -1.8, 2, 0.65, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  return sheet;
}
function fallbackMesh(hero: boolean) {
  const cuts = hero ? [0.16, -0.12] : [0.16, -0.13, -0.425, -0.7, -0.984];
  const faces: Face[] = [];
  const centers: number[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const front = cuts[index],
      back = cuts[index + 1];
    centers.push((front + back) * 0.5 * radii[2]);
    const rim = (t: number, depth: number): Vec => [
      radii[0] * Math.sqrt(1 - depth * depth) * Math.cos(t),
      -radii[1] * Math.sqrt(1 - depth * depth) * Math.sin(t),
      radii[2] * depth,
    ];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI,
        b = ((i + 1) / 32) * Math.PI;
      for (const [depth, sign] of [
        [front, 1],
        [back, -1],
      ]) {
        const vertices: Vec[] = [
          [0, 0, depth * radii[2]],
          rim(a, depth),
          rim(b, depth),
        ];
        faces.push({
          vertices,
          object: index + 1,
          paint: "flesh",
          normal: [0, 0, sign],
          uv: vertices.map(([x, y]) => [
            half + (x / radii[0] / Math.sqrt(1 - depth * depth)) * half,
            half - (y / radii[1] / Math.sqrt(1 - depth * depth)) * half,
          ]),
        });
      }
      faces.push({
        vertices: [rim(a, front), rim(b, front), rim(b, back), rim(a, back)],
        normal: [
          Math.cos((a + b) / 2),
          -Math.sin((a + b) / 2),
          (front + back) * 0.5,
        ],
        object: index + 1,
        paint: i % 5 < 2 ? "#346957" : "#4a846c",
      });
    }
    const top = [
      rim(0, front),
      rim(Math.PI, front),
      rim(Math.PI, back),
      rim(0, back),
    ];
    for (const triangle of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      const vertices = triangle.map((n) => top[n]);
      faces.push({
        vertices,
        object: index + 1,
        normal: [0, 1, 0],
        paint: "flesh",
        uv: vertices.map(([x, , z]) => [
          half + (half * x) / radii[0],
          half + (half * z) / radii[2],
        ]),
      });
    }
  }
  const rail = glassMesh(5, 3);
  for (let i = 0; i < rail.length; i += 21) {
    const vertices = [0, 7, 14].map(
      (j) => [rail[i + j], rail[i + j + 1], rail[i + j + 2]] as Vec,
    );
    faces.push({
      vertices,
      object: 5,
      normal: [rail[i + 3], rail[i + 4], rail[i + 5]],
      paint: "glass",
    });
  }
  return { faces, centers };
}
function path(ctx: CanvasRenderingContext2D, polygon: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(...polygon[0]);
  for (const pt of polygon.slice(1)) ctx.lineTo(...pt);
  ctx.closePath();
}
function paintTriangle(
  ctx: CanvasRenderingContext2D,
  p: [number, number][],
  uv: number[][],
  sheet: HTMLCanvasElement,
) {
  const [x, y] = p[0],
    [u, v] = uv[0];
  const ax = p[1][0] - x,
    bx = p[2][0] - x,
    ay = p[1][1] - y,
    by = p[2][1] - y;
  const au = uv[1][0] - u,
    bu = uv[2][0] - u,
    av = uv[1][1] - v,
    bv = uv[2][1] - v;
  const det = au * bv - bu * av;
  if (Math.abs(det) < 0.0001) return;
  const a = (ax * bv - bx * av) / det,
    c = (bx * au - ax * bu) / det,
    b = (ay * bv - by * av) / det,
    d = (by * au - ay * bu) / det;
  ctx.save();
  ctx.clip();
  ctx.transform(a, b, c, d, x - a * u - c * v, y - b * u - d * v);
  ctx.drawImage(sheet, 0, 0);
  ctx.restore();
}
export function canvasRenderer(
  canvas: HTMLCanvasElement,
  hero: boolean,
): SceneRenderer | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ctx = context,
    mesh = fallbackMesh(hero),
    sheet = fleshTexture();
  const neutral = document.createElement("canvas");
  neutral.width = sheet.width;
  neutral.height = sheet.height;
  const faded = neutral.getContext("2d")!;
  faded.drawImage(sheet, 0, 0);
  const bitmap = faded.getImageData(0, 0, neutral.width, neutral.height);
  for (let i = 0; i < bitmap.data.length; i += 4) {
    const l =
      (bitmap.data[i] * 0.27 +
        bitmap.data[i + 1] * 0.58 +
        bitmap.data[i + 2] * 0.15) /
      255;
    bitmap.data[i] = 161 + 71 * l;
    bitmap.data[i + 1] = 158 + 72 * l;
    bitmap.data[i + 2] = 180 + 64 * l;
  }
  faded.putImageData(bitmap, 0, 0);
  let w = 0,
    h = 0,
    scale = 0,
    visible: Projected[] = [];
  function project(v: Vec, pose: Pose) {
    return pixels(world(v, pose), w, h, scale);
  }
  function draw(frame: SceneFrame) {
    ctx.clearRect(0, 0, w, h);
    const shadowY = h / 2 + (hero ? 1.21 : 0.94) * scale;
    ctx.save();
    ctx.translate(w / 2, shadowY);
    ctx.scale(scale, 0.11 * scale);
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.1);
    sh.addColorStop(0, "rgba(49,30,72,.20)");
    sh.addColorStop(1, "rgba(49,30,72,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(-1.1, -1.1, 2.2, 2.2);
    ctx.restore();
    visible = [];
    for (const face of mesh.faces) {
      const pose =
        face.object === 5 ? frame.frame : frame.fruit[face.object - 1];
      const normal = rotate(rotate(face.normal, pose.twist), pose.camera);
      const pts = face.vertices.map((p) => world(p, pose));
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      if (normal[2] < -0.12) continue;
      visible.push({
        face,
        points: pts.map((p) => pixels(p, w, h, scale)),
        depth,
        light:
          0.45 +
          0.5 *
            Math.abs(0.73 * normal[1] - 0.38 * normal[0] + 0.52 * normal[2]),
      });
    }
    visible.sort((a, b) => a.depth - b.depth);
    for (const p of visible) {
      path(ctx, p.points);
      if (p.face.uv) {
        const strength = hero ? 1 : frame.occupied[p.face.object - 1];
        ctx.fillStyle = strength > 0.5 ? "#ef6573" : "#c9c5d5";
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.65;
        ctx.stroke();
        if (strength < 0.99) paintTriangle(ctx, p.points, p.face.uv, neutral);
        if (strength > 0.001) {
          ctx.globalAlpha = strength;
          paintTriangle(ctx, p.points, p.face.uv, sheet);
          ctx.globalAlpha = 1;
        }
      } else {
        if (p.face.paint === "glass") {
          const v = p.face.vertices[0],
            n = p.face.normal;
          const light =
            p.light +
            0.19 * Math.cos(v[0] * 3.5 + v[1] * 1.3) +
            0.07 * Math.cos(n[2] * 8 + n[0] * 3);
          ctx.fillStyle =
            "hsla(268,40%," +
            Math.max(32, Math.min(97, 25 + 66 * light)) +
            "%,.86)";
        } else ctx.fillStyle = p.face.paint;
        if (
          !hero &&
          p.face.object !== 5 &&
          frame.occupied[p.face.object - 1] < 0.5
        )
          ctx.fillStyle = p.light > 0.72 ? "#c5c0d0" : "#aca8bd";
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.55;
        ctx.stroke();
        ctx.fill();
      }
    }
    if (!hero)
      frame.loads.forEach((load, i) => {
        const x = -0.55 + i * 0.275 + 0.012;
        const start = project([x, 0.79, 0.12], frame.frame),
          end = project([x + 0.23, 0.79, 0.12], frame.frame);
        ctx.strokeStyle = "#cfbedc";
        ctx.lineWidth = Math.max(1, 0.023 * scale);
        ctx.beginPath();
        ctx.moveTo(...start);
        ctx.lineTo(...end);
        ctx.stroke();
        if (load > 0) {
          ctx.strokeStyle = groupColors[i];
          ctx.beginPath();
          ctx.moveTo(...start);
          ctx.lineTo(
            start[0] + load * (end[0] - start[0]),
            start[1] + load * (end[1] - start[1]),
          );
          ctx.stroke();
        }
      });
  }
  return {
    centers: mesh.centers,
    draw,
    resize(width, height, s) {
      if (w !== width || h !== height) {
        w = width;
        h = height;
        canvas.width = w;
        canvas.height = h;
      }
      scale = s;
    },
    pick(_, x, y) {
      for (let i = visible.length - 1; i >= 0; i--) {
        path(ctx, visible[i].points);
        if (ctx.isPointInPath(x * w, y * h)) return visible[i].face.object;
      }
      return 0;
    },
    dispose() {
      visible = [];
      sheet.width = 0;
      neutral.width = 0;
    },
  };
}
