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

export function trackingAnchor(target?: MelonTracking | null) {
  if (!target) return null;
  const index = melonGroups.indexOf(target.group);
  const front = sectionCuts(false)[index];
  const radius = Math.sqrt(1 - front * front);
  // The incident retains its own spot on the flesh when its group, load, or pose changes.
  let seed = 0;
  for (const char of target.id)
    seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const angle = 0.55 + ((seed % 257) / 256) * 2;
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
  if (hero) return brandPoses(phase, fruit, frame, centers);
  const breathe = Math.sin(phase * 0.72);
  const yaw = Math.sin(phase * 0.29);
  const activity = Math.max(...occupied);
  const fruitCamera: Vec = [
    0.29 + fruit.pitch + 0.037 * breathe,
    -0.48 - 0.29 * activity + fruit.yaw + 0.1 * yaw,
    0.105 + 0.025 * Math.sin(phase * 0.43),
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
      twist: [
        0.025 * rank - 0.05 * lift,
        0.042 * rank + 0.06 * lift,
        0.027 * rank,
      ],
      pivot: [0, -0.45, z],
      offset: [
        -0.037 * rank,
        0.42 + 0.22 * lift + 0.08 * occupied[index],
        0.73 + rank * (0.035 + 0.072 * activity) + 0.2 * activity - separation,
      ],
      camera: fruitCamera,
      origin: [0.09, -0.018 + 0.035 * breathe, 0.05],
      size: 0.99,
    };
  });
  const glass: Pose = {
    twist: [0, 0, 0],
    pivot: [0, 0, 0],
    offset: [0, 0, 0],
    camera: [
      frame.pitch - 0.095 + 0.044 * Math.sin(phase * 0.57),
      frame.yaw - 0.7 + 0.14 * Math.sin(phase * 0.33),
      -0.048 + 0.032 * Math.sin(phase * 0.44),
    ],
    origin: [0.025, 0.035 - 0.018 * breathe, 0],
    size: 0.94,
  };
  separateGlass(sections, glass, sectionCuts(hero));
  return { fruit: sections, frame: glass };
}

export const cutDuration = 3.8;
function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function brandPoses(
  phase: number,
  fruit: Orbit,
  frame: Orbit,
  centers: number[],
) {
  // Work in the fruit's cutting coordinates. The blade crosses each seam
  // before opening that gap, so all sections begin as one intact wedge.
  const period = 16;
  const time = phase % period;
  const progress = smooth(Math.min(time, period - time) / cutDuration);
  const blade = 0.92 - 1.5 * progress;
  const cuts = sectionCuts(true);
  const gaps = cuts
    .slice(1, -1)
    .map((z) => smooth((z * radii[2] - blade + 0.11) / 0.3));
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  const orbitAngle = (phase * 2 * Math.PI) / period;
  const rest: Vec = [
    0.22 + 0.038 * Math.sin(orbitAngle),
    -0.69 + 0.09 * Math.sin(orbitAngle),
    0.22 + 0.025 * Math.sin(2 * orbitAngle),
  ];
  const camera: Vec = [rest[0] + fruit.pitch, rest[1] + fruit.yaw, rest[2]];
  let offset = total / 2;
  const sections = centers.map((z, i): Pose => {
    if (i) offset -= gaps[i - 1];
    return {
      twist: [-0.04 * offset, 0.11 * offset, 0.045 * offset],
      pivot: [0, -0.47, z],
      offset: [0, 0.51 - 0.095 * offset, 0.88 * offset],
      camera,
      origin: [-0.04, -0.055, 0],
      size: 1.12,
    };
  });
  const origin = rotate([0, 0, blade * 1.12], rest);
  const glass: Pose = {
    twist: [0, 0, 0],
    pivot: [0, 0, 0],
    offset: [0, 0, 0],
    camera: [rest[0] + frame.pitch, rest[1] + frame.yaw, rest[2]],
    origin: [origin[0] - 0.04, origin[1] - 0.055, origin[2]],
    size: 1.9,
  };
  separateGlass(sections, glass, cuts, true);
  return { fruit: sections, frame: glass };
}

// A fixed point on each section carries an etched sample number. The plates
// cant slightly toward the observer so the numerals stay legible at rest.
export function specimenPoses(sections: Pose[]): Pose[] {
  const sockets = [
    [-0.7, -0.46],
    [-0.14, 0.29],
    [1.01, 0.25],
  ];
  const cuts = sectionCuts(true);
  return sections.map((section, i) => ({
    twist: [
      -0.18 + section.twist[0],
      0.43 + section.twist[1],
      -0.055 + section.twist[2],
    ],
    pivot: [0, 0, 0],
    offset: [0, 0, 0],
    camera: section.camera,
    origin: world(
      [sockets[i][0], sockets[i][1], cuts[i] * radii[2] + 0.18],
      section,
    ),
    size: section.size * 0.57,
  }));
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

function separateGlass(
  fruit: Pose[],
  frame: Pose,
  cuts: readonly number[],
  hero = false,
) {
  const basis = axes.map((axis) => rotate(axis, frame.camera));
  const normal = basis[2];
  const opening = hero ? [0.71, 0.71] : aperture;
  const halfDepth = hero ? 0.039 : glassHalfDepth;
  const slopes = hero ? [0, 0.5, 1, 2, 4, 8, 32, 256] : [0, 0.5, 1, 2, 4, 8];
  const blocked: [number, number][] = [];
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
      // A support plane separates the entire rail from the entire section.
      function clearance(side: number) {
        let least = Infinity;
        for (const slope of slopes) {
          const n = normal.map(
            (v, k) => side * v + slope * sign * basis[axis][k],
          ) as Vec;
          const q = directions.map((v) => dot(n, v)) as Vec;
          const tip =
            dot(relative, n) +
            slice.size * sectionSupport(q, cuts[index + 1], cuts[index]);
          const glass = frame.size * (slope * opening[axis] - halfDepth);
          least = Math.min(least, tip - glass + 0.045 * Math.hypot(1, slope));
        }
        return least;
      }
      const forward = clearance(1);
      if (hero) {
        // Released slices can be entirely in front of the scanner. Only the
        // finite interval between front and back contacts can block its travel.
        blocked.push([-clearance(-1), forward]);
      } else travel = Math.max(travel, forward);
    }
  });
  blocked.sort((a, b) => a[0] - b[0]);
  for (const [start, end] of blocked)
    if (start < travel && travel < end) travel = end;
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
