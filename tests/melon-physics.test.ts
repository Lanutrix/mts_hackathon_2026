import assert from "node:assert/strict";
import test from "node:test";
import {
  coast,
  modelPoses,
  orbit,
  rotate,
  specimenPoses,
  world,
  type Pose,
  type Vec,
} from "../apps/web/src/melonModel.ts";
import {
  glassMesh,
  melonMesh,
  radii,
  sectionCuts,
} from "../apps/web/src/melonRenderGeometry.ts";

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
  const marks = atRest.specimens!;
  assert.equal(marks.length, 3);
  const nextPass = poses(23).specimens!;
  marks.forEach((mark, i) => {
    assert.ok(
      distance(mark.origin, nextPass[i].origin) < 1e-6,
      "the cut repeats continuously",
    );
    const shifted = atRest.fruit.map((pose, j) => ({
      ...pose,
      origin: pose.origin.map((v) => (i === j ? v + 0.4 : v)) as Vec,
    }));
    specimenPoses(shifted, [1, 1, 1]).forEach((m, j) => {
      const delta = m.origin[0] - marks[j].origin[0];
      assert.ok(
        Math.abs(delta - (i === j ? 0.4 : 0)) < 1e-6,
        "a sample only follows its own cut",
      );
    });
  });
});

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("Cut samples grow on the flesh only after the blade exits their section, then disappear on rewind", () => {
  const centers = melonMesh(true).sections.map((s) => s.center);
  const zero = [0, 0, 0, 0];
  const scene = (time: number) =>
    modelPoses(true, time, orbit(), orbit(), zero, zero, zero, centers);
  const sizes = (time: number) => scene(time).specimens!.map((s) => s.size);
  assert.deepEqual(
    sizes(0),
    [0, 0, 0],
    "the assembled wedge has no sample squares",
  );
  assert.deepEqual(sizes(16), sizes(0));
  assert.ok(sizes(7).every((size) => size > 0.3));
  const counts = new Set<number>();
  for (let t = 0; t < 4; t += 0.04) {
    const frame = scene(t);
    const marks = frame.specimens!;
    const rewind = sizes(16 - t);
    counts.add(marks.filter((mark) => mark.size > 0).length);
    marks.forEach((mark, i) => {
      assert.ok(Math.abs(mark.size - rewind[i]) < 1e-8);
      if (mark.size === 0) return;
      const normal = rotate([0, 0, 1], frame.frame.camera);
      const back = world(
        [0, -0.45, sectionCuts(true)[i + 1] * radii[2]],
        frame.fruit[i],
      );
      assert.ok(
        dot(back.map((v, j) => v - frame.frame.origin[j]) as Vec, normal) > 0,
        "the blade must have cut through the section",
      );
    });
  }
  assert.deepEqual([...counts], [0, 1, 2, 3]);
  const rest = scene(7);
  rest.specimens!.forEach((mark, i) => {
    const faceZ = sectionCuts(true)[i] * radii[2];
    const section = rest.fruit[i];
    const origin = world([0, 0, faceZ], section);
    const axes = (
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec[]
    ).map((a) => rotate(rotate(a, section.twist), section.camera));
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5]) {
        const point = world([x, y, 0], mark).map(
          (v, j) => v - origin[j],
        ) as Vec;
        const [u, v, depth] = axes.map(
          (axis) => dot(point, axis) / section.size,
        );
        assert.ok(
          v < 0 &&
            (u / radii[0]) ** 2 +
              (v / radii[1]) ** 2 +
              (faceZ / radii[2]) ** 2 <
              1,
        );
        assert.ok(
          depth >= 0 && depth < 0.04,
          "the glass sits flush on the cut face",
        );
      }
  });
});

test("The violet contact grid is confined to sections crossing the actual scanner plane", () => {
  const zero = [0, 0, 0, 0];
  const mesh = melonMesh(true);
  const centers = mesh.sections.map((s) => s.center);
  for (const yaw of [0, 0.56]) {
    const seen = new Set<number>();
    for (let t = 0; t < 4; t += 0.08) {
      const frame = modelPoses(
        true,
        t,
        orbit(),
        { ...orbit(), yaw },
        zero,
        zero,
        zero,
        centers,
      );
      const normal = rotate([0, 0, 1], frame.frame.camera);
      mesh.sections.forEach(({ first, count }, i) => {
        const contact = frame.contacts?.[i];
        assert.ok(
          contact,
          "each section has a contact with the scanning plane",
        );
        let lo = Infinity,
          hi = -Infinity;
        for (let vertex = first; vertex < first + count; vertex += 7) {
          const p = Array.from(
            mesh.vertices.subarray(7 * vertex, 7 * vertex + 3),
          ) as Vec;
          const wp = world(p, frame.fruit[i]);
          const distance = dot(
            normal,
            wp.map((v, j) => v - frame.frame.origin[j]) as Vec,
          );
          const projected =
            dot(contact.plane.slice(0, 3) as Vec, p) + contact.plane[3];
          assert.ok(
            Math.abs(projected - distance) < 1e-6,
            "grid must follow the rotated scanner",
          );
          lo = Math.min(lo, distance);
          hi = Math.max(hi, distance);
        }
        if (hi < -0.01 || lo > 0.01) assert.equal(contact.strength, 0);
        if (lo < -0.09 && hi > 0.09) {
          assert.ok(contact.strength > 0.5);
          seen.add(i);
        }
      });
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2]);
  }
});

test("Release inertia travels the same distance at different display refresh rates", () => {
  const duration = 2;
  for (const fps of [24, 30, 60, 90, 120, 144]) {
    const turn = { ...orbit(), vx: 2.6, vy: -1.3 };
    for (let i = 0; i < fps * duration; i++) coast(turn, 1 / fps);
    assert.ok(
      Math.abs(turn.yaw - (2.6 * (1 - Math.exp(-3.2 * duration))) / 3.2) < 1e-9,
    );
    assert.ok(Math.abs(turn.pitch + turn.yaw / 2) < 1e-9);
  }
});

test("The guest scanner has continuous clearance through a loop and an independent drag", () => {
  const centers = melonMesh(true).sections.map((s) => s.center);
  const zero = [0, 0, 0, 0];
  for (const manual of [false, true]) {
    let previous: Vec[] | undefined;
    for (let i = 0; i <= 1980; i++) {
      const t = i / 120;
      const hand = orbit();
      if (manual) {
        hand.yaw = 0.55 * Math.sin(0.7 * t);
        hand.pitch = 0.33 * Math.sin(0.4 * t);
      }
      const frame = modelPoses(
        true,
        t,
        hand,
        orbit(),
        zero,
        zero,
        zero,
        centers,
      );
      const points = [
        world([0.79, 0.79, 0], frame.frame),
        ...frame.fruit.map((slice, k) => world([0, -0.45, centers[k]], slice)),
      ];
      for (let j = 0; previous && j < points.length; j++) {
        const last = previous[j];
        assert.ok(
          Math.hypot(...points[j].map((v, k) => v - last[k])) < 0.026,
          `jump at ${t} s, manual=${manual}`,
        );
      }
      previous = points;
    }
  }
});

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
