import assert from "node:assert/strict";
import test from "node:test";
import {
  modelPoses,
  orbit,
  rotate,
  specimenPoses,
  world,
  type Pose,
  type Vec,
} from "../apps/web/src/melonModel.ts";
import { glassMesh, melonMesh } from "../apps/web/src/melonRenderGeometry.ts";

test("The guest optic sweeps through the fruit and exposes separate registered cut faces", () => {
  const mesh = melonMesh(true);
  assert.ok(
    mesh.sections.length >= 3,
    "each of the three sample cuts has real geometry",
  );
  const centers = mesh.sections.map((section) => section.center);
  const zeros = [0, 0, 0, 0];
  const poses = (seconds: number) =>
    modelPoses(true, seconds, orbit(), orbit(), zeros, zeros, zeros, centers);
  const atStart = poses(0);
  const atRest = poses(7);
  const front = (scene: typeof atStart) =>
    world([0, 0, centers[0]], scene.fruit[0]);
  const back = (scene: typeof atStart) =>
    world([0, 0, centers.at(-1)!], scene.fruit.at(-1)!);
  const distance = (a: Vec, b: Vec) => Math.hypot(...a.map((v, i) => v - b[i]));
  assert.ok(
    distance(front(atRest), back(atRest)) >
      distance(front(atStart), back(atStart)) + 0.55,
  );
  const scannerDepth = (scene: typeof atStart) => {
    const face = front(scene);
    const normal = rotate([0, 0, 1], scene.fruit[0].camera);
    return dot(scene.frame.origin.map((v, i) => v - face[i]) as Vec, normal);
  };
  assert.ok(
    scannerDepth(atStart) > 0 && scannerDepth(atRest) < 0,
    "the scanner travels across the front face",
  );
  const marks = specimenPoses(atRest.fruit);
  assert.equal(marks.length, 3);
  const nextPass = specimenPoses(poses(23).fruit);
  marks.forEach((mark, i) => {
    assert.ok(
      distance(mark.origin, nextPass[i].origin) < 1e-6,
      "the cut repeats continuously",
    );
    const shifted = atRest.fruit.map((pose, j) => ({
      ...pose,
      origin: pose.origin.map((v) => (i === j ? v + 0.4 : v)) as Vec,
    }));
    specimenPoses(shifted).forEach((m, j) => {
      const delta = m.origin[0] - marks[j].origin[0];
      assert.ok(
        Math.abs(delta - (i === j ? 0.4 : 0)) < 1e-6,
        "a sample only follows its own cut",
      );
    });
  });
});

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

for (const hero of [true, false]) {
  const [clearX, clearY, back] = hero
    ? [0.71, 0.71, -0.039]
    : [0.58, 0.645, -0.11];
  test(
    "Solid bevels in both renderers surround the same aperture, hero=" + hero,
    () => {
      for (const mesh of [glassMesh(12, 5, hero), glassMesh(5, 3, hero)]) {
        for (let i = 0; i < mesh.length; i += 21) {
          const triangle = [i, i + 7, i + 14];
          assert.ok(
            triangle.every((j) => Math.abs(mesh[j + 2]) < -back + 1e-6),
          );
          assert.ok(
            [1, -1].some(
              (sign) =>
                triangle.every((j) => mesh[j] * sign >= clearX) ||
                triangle.every((j) => mesh[j + 1] * sign >= clearY),
            ),
          );
        }
      }
    },
  );
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
        // Working slices stay behind the rails. Released guest sections may
        // also pass in front. Check every vertex and clipped edge in the slab.
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
          for (const [x, y, z] of vertices)
            if (z >= plane && (!hero || z <= -plane)) inside(x, y);
          for (let j = 0; j < triangles.length; j += 3) {
            for (let k = 0; k < 3; k++) {
              const a = vertices[triangles[j + k]],
                b = vertices[triangles[j + ((k + 1) % 3)]];
              for (const boundary of hero ? [plane, -plane] : [plane]) {
                if ((a[2] - boundary) * (b[2] - boundary) >= 0) continue;
                const t = (boundary - a[2]) / (b[2] - a[2]);
                inside(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
              }
            }
          }
        });
      }
    },
  );
}
