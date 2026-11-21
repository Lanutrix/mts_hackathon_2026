import assert from "node:assert/strict";
import test from "node:test";
import {
  modelPoses,
  orbit,
  rotate,
  world,
  type Pose,
  type Vec,
} from "../apps/web/src/melonModel.ts";
import { glassMesh, melonMesh } from "../apps/web/src/melonRenderGeometry.ts";

const clearX = 0.58,
  clearY = 0.645,
  back = -0.11;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("Solid bevels of both glass meshes surround the same clear aperture", () => {
  for (const mesh of [glassMesh(), glassMesh(5, 3)]) {
    for (let i = 0; i < mesh.length; i += 21) {
      const triangle = [i, i + 7, i + 14];
      assert.ok(triangle.every((j) => Math.abs(mesh[j + 2]) < -back + 1e-6));
      assert.ok(
        [1, -1].some(
          (sign) =>
            triangle.every((j) => mesh[j] * sign >= clearX) ||
            triangle.every((j) => mesh[j + 1] * sign >= clearY),
        ),
      );
    }
  }
});

for (const hero of [true, false]) {
  test(
    "Glass stays clear throughout independent orbits of " +
      (hero ? "the hero slice" : "the displaced incident slices"),
    () => {
      const mesh = melonMesh(hero);
      const sections = mesh.sections.map(({ first, count }) => {
        const indices = new Map<string, number>(),
          points: Vec[] = [],
          triangles: number[] = [];
        for (let j = first; j < first + count; j++) {
          const point = Array.from(
            mesh.vertices.subarray(j * 7, j * 7 + 3),
          ) as Vec;
          const key = point.join(",");
          if (!indices.has(key)) {
            indices.set(key, points.length);
            points.push(point);
          }
          triangles.push(indices.get(key)!);
        }
        return { points, triangles };
      });
      for (let i = 0; i < 96; i++) {
        const turn = (yaw: number, pitch: number) => ({
          ...orbit(),
          yaw: i * yaw,
          pitch: i * pitch,
        });
        const varied = (shift: number) =>
          Array.from({ length: 4 }, (_, j) =>
            i % 5 === 0
              ? 1
              : i % 5 === 1
                ? 0
                : (1 + Math.sin(i * (j + shift))) / 2,
          );
        const poses = modelPoses(
          hero,
          i * 0.83,
          turn(1.73, -0.79),
          turn(-0.92, 1.97),
          i % 7 < 4
            ? [0, 1, 2, 3].map((group) => Number(group === i % 7))
            : varied(1),
          varied(2),
          varied(3),
          mesh.sections.map((s) => s.center),
        );
        const frame = poses.frame;
        const axes = (
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ] as Vec[]
        ).map((axis) => rotate(axis, frame.camera));
        function inFrame(point: Vec, pose: Pose): Vec {
          const p = world(point, pose).map(
            (v, k) => v - frame.origin[k],
          ) as Vec;
          return axes.map((axis) => dot(p, axis) / frame.size) as Vec;
        }
        // Clip every rendered triangle against the back of the rail. Any remaining
        // polygon must fit through the hole, with clearance even at its edge cuts.
        const margin = 0.02 / frame.size;
        const plane = back - margin;
        function inside(x: number, y: number) {
          assert.ok(
            Math.abs(x) < clearX - margin && Math.abs(y) < clearY - margin,
            `sample ${i}, fruit crosses the glass aperture at [${x}, ${y}]`,
          );
        }
        sections.forEach(({ points, triangles }, index) => {
          const vertices = points.map((p) => inFrame(p, poses.fruit[index]));
          for (const [x, y, z] of vertices) if (z >= plane) inside(x, y);
          for (let j = 0; j < triangles.length; j += 3) {
            for (let k = 0; k < 3; k++) {
              const a = vertices[triangles[j + k]],
                b = vertices[triangles[j + ((k + 1) % 3)]];
              if ((a[2] - plane) * (b[2] - plane) >= 0) continue;
              const t = (plane - a[2]) / (b[2] - a[2]);
              inside(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
            }
          }
        });
      }
    },
  );
}
