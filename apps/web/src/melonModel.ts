import type { Group } from "../../../packages/domain";
import {
  aperture,
  glassHalfDepth,
  radii,
  sectionCuts,
} from "./melonRenderGeometry";

export const melonGroups: Group[] = [
  "critical",
  "coordinators",
  "high",
  "research",
];
export type MelonFilter = Group | "all";
export type Counts = Partial<Record<Group, number>>;
export type ObjectName = "fruit" | "frame";
export type MelonTracking = {
  id: string;
  group: Group;
  header: string;
  revision: number;
};
export type ModelState = {
  active: MelonFilter;
  counts?: Counts;
  unique?: number;
  tracking?: MelonTracking | null;
};
export const groupNames: Record<Group, string> = {
  critical: "Критические",
  coordinators: "У координаторов",
  high: "Высокий приоритет",
  research: "На исследовании",
};
export const groupColors = ["#c50032", "#28665c", "#664693", "#56516a"];
export type Vec = [number, number, number];
export type Pose = {
  twist: Vec;
  pivot: Vec;
  offset: Vec;
  camera: Vec;
  origin: Vec;
  size: number;
};
export type Orbit = { yaw: number; pitch: number; vx: number; vy: number };
export function orbit(): Orbit {
  return { yaw: 0, pitch: 0, vx: 0, vy: 0 };
}

export function groupLoads(data: ModelState) {
  return melonGroups.map((group) =>
    data.unique && data.unique > 0
      ? Math.min(1, Math.max(0, (data.counts?.[group] ?? 0) / data.unique))
      : 0,
  );
}

export function trackingAnchor(hero: boolean, target?: MelonTracking | null) {
  if (!hero && !target) return null;
  const index = hero ? 0 : melonGroups.indexOf(target!.group);
  const front = sectionCuts(hero)[index];
  const radius = Math.sqrt(1 - front * front);
  // The incident retains its own spot on the flesh when its group, load, or pose changes.
  let seed = 0;
  if (target)
    for (const char of target.id)
      seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const angle = target ? 0.55 + ((seed % 257) / 256) * 2 : 2.18;
  const point: Vec = [
    radii[0] * radius * 0.52 * Math.cos(angle),
    -radii[1] * radius * 0.52 * Math.sin(angle),
    radii[2] * front,
  ];
  return { index, point };
}

export function modelPoses(
  hero: boolean,
  phase: number,
  fruit: Orbit,
  frame: Orbit,
  focus: number[],
  loads: number[],
  occupied: number[],
  centers: number[],
): { fruit: Pose[]; frame: Pose } {
  const breathe = Math.sin(phase * 0.72);
  const yaw = Math.sin(phase * 0.29);
  const activity = Math.max(...occupied);
  const fruitCamera: Vec = hero
    ? [
        -0.22 + fruit.pitch + 0.05 * breathe,
        0.38 + fruit.yaw + 0.19 * yaw,
        0.36 + 0.025 * Math.sin(phase * 0.43),
      ]
    : [
        0.31 + fruit.pitch + 0.037 * breathe,
        -0.55 - 0.37 * activity + fruit.yaw + 0.12 * yaw,
        -0.055 + 0.025 * Math.sin(phase * 0.43),
      ];
  const sections = centers.map((z, index): Pose => {
    const lift = focus[index] ?? 0;
    const rank = 1.5 - index;
    let separation = 0;
    for (let gap = 1; gap <= index; gap++)
      separation +=
        (loads[gap - 1] + loads[gap]) * 0.055 +
        (occupied[gap - 1] + occupied[gap]) * 0.11;
    return {
      twist: hero
        ? [0, 0, 0]
        : [
            0.025 * rank - 0.05 * lift,
            0.042 * rank + 0.06 * lift,
            0.027 * rank,
          ],
      pivot: [0, -0.45, z],
      offset: hero
        ? [0, 0.5, -0.02]
        : [
            -0.037 * rank,
            0.42 + 0.22 * lift + 0.08 * occupied[index],
            0.73 +
              rank * (0.035 + 0.072 * activity) +
              0.2 * activity -
              separation,
          ],
      camera: fruitCamera,
      origin: hero
        ? [-0.012, -0.07 + 0.044 * breathe, 0.05]
        : [0.09, -0.018 + 0.035 * breathe, 0.05],
      size: hero ? 1.54 : 0.99,
    };
  });
  const glass: Pose = {
    twist: [0, 0, 0],
    pivot: [0, 0, 0],
    offset: [0, 0, 0],
    camera: [
      frame.pitch - 0.095 + 0.044 * Math.sin(phase * 0.57),
      frame.yaw - 0.54 + 0.14 * Math.sin(phase * 0.33),
      -0.048 + 0.032 * Math.sin(phase * 0.44),
    ],
    origin: hero
      ? [0.12, 0.012 - 0.027 * breathe, 0]
      : [0.025, 0.035 - 0.018 * breathe, 0],
    size: hero ? 1.28 : 1.01,
  };
  separateGlass(sections, glass, sectionCuts(hero));
  return { fruit: sections, frame: glass };
}
export function rotate([x, y, z]: Vec, [rx, ry, rz]: Vec): Vec {
  let c = Math.cos(rx),
    s = Math.sin(rx);
  [y, z] = [c * y - s * z, s * y + c * z];
  c = Math.cos(ry);
  s = Math.sin(ry);
  [x, z] = [c * x + s * z, -s * x + c * z];
  c = Math.cos(rz);
  s = Math.sin(rz);
  return [c * x - s * y, s * x + c * y, z];
}
export function world(point: Vec, pose: Pose): Vec {
  const local = point.map((v, i) => v - pose.pivot[i]) as Vec;
  const rotated = rotate(local, pose.twist).map(
    (v, i) => (v + pose.pivot[i] + pose.offset[i]) * pose.size,
  ) as Vec;
  return rotate(rotated, pose.camera).map((v, i) => v + pose.origin[i]) as Vec;
}

const axes: Vec[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Maximum of q·p over the entire half-ellipsoid between the two cut planes.
// At a fixed depth its support is a half-ellipse. Its one-dimensional maximum
// lies at the unconstrained ellipsoid support or one of the two cut depths.
function sectionSupport(q: Vec, back: number, front: number) {
  const rim = Math.hypot(radii[0] * q[0], radii[1] * Math.min(0, q[1]));
  const depth = radii[2] * q[2];
  const length = Math.hypot(rim, depth);
  const z = Math.max(back, Math.min(front, length ? depth / length : 0));
  return rim * Math.sqrt(1 - z * z) + depth * z;
}

function separateGlass(fruit: Pose[], frame: Pose, cuts: readonly number[]) {
  const basis = axes.map((axis) => rotate(axis, frame.camera));
  const normal = basis[2];
  let travel = 0;
  fruit.forEach((slice, index) => {
    const relative = world([0, 0, 0], slice).map(
      (v, i) => v - frame.origin[i],
    ) as Vec;
    const directions = axes.map((axis) =>
      rotate(rotate(axis, slice.twist), slice.camera),
    );
    for (let rail = 0; rail < 4; rail++) {
      const axis = Math.floor(rail / 2);
      const sign = rail % 2 ? -1 : 1;
      let leastTravel = Infinity;
      // Each rail is outside one side of the aperture and in the depth slab.
      // Any one of these planes separates that whole rail from the whole slice.
      // Taking min/max of continuous supports also keeps contact continuous
      // through direct turns, inertia, and changing slice offsets.
      for (const slope of [0, 0.5, 1, 2, 4, 8]) {
        const n = normal.map(
          (v, k) => v + slope * sign * basis[axis][k],
        ) as Vec;
        const q = directions.map((v) => dot(n, v)) as Vec;
        const tip =
          dot(relative, n) +
          slice.size * sectionSupport(q, cuts[index + 1], cuts[index]);
        const glass = frame.size * (slope * aperture[axis] - glassHalfDepth);
        leastTravel = Math.min(
          leastTravel,
          tip - glass + 0.045 * Math.hypot(1, slope),
        );
      }
      travel = Math.max(travel, leastTravel);
    }
  });
  // Share the rigid translation so contact does not push the composition off centre.
  for (let k = 0; k < 3; k++) {
    frame.origin[k] += 0.5 * travel * normal[k];
    for (const slice of fruit) slice.origin[k] -= 0.5 * travel * normal[k];
  }
}
export function pixels(
  point: Vec,
  width: number,
  height: number,
  scale: number,
): [number, number] {
  const perspective = 8 / (8 - point[2]);
  return [
    width / 2 + point[0] * scale * perspective,
    height / 2 - point[1] * scale * perspective,
  ];
}
