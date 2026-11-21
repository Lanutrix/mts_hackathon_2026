// Four sections of the same ellipsoid. The end faces, curved peel and top
// are separate surfaces so every cut retains its own normal and material.
export const radii = [1.16, 1.08, 1.82] as const;
const signalCuts = [0.16, -0.13, -0.425, -0.7, -0.984] as const;
const brandCuts = [0.32, 0.1, -0.12, -0.34] as const;
export const sectionCuts = (hero: boolean) => (hero ? brandCuts : signalCuts);
// This rectangle is inside the rounded opening of both tessellations.
export const aperture = [0.58, 0.645] as const;
export const glassHalfDepth = 0.11;
const curveSteps = 72;
const depthSteps = 10;
export type Vector = [number, number, number];
export type Section = { first: number; count: number; center: number };

function rim(depth: number, angle: number): Vector {
  const profile = Math.sqrt(1 - depth * depth);
  return [
    radii[0] * profile * Math.cos(angle),
    -radii[1] * profile * Math.sin(angle),
    depth * radii[2],
  ];
}

function skinNormal([x, y, z]: Vector): Vector {
  const nx = x / radii[0] ** 2,
    ny = y / radii[1] ** 2,
    nz = z / radii[2] ** 2;
  const length = Math.hypot(nx, ny, nz);
  return [nx / length, ny / length, nz / length];
}

export function melonMesh(hero = false) {
  const cuts = sectionCuts(hero);
  const vertices: number[] = [];
  const sections: Section[] = [];
  const vertex = (point: Vector, normal: Vector, material: number) =>
    vertices.push(...point, ...normal, material);
  const face = (points: Vector[], normal: Vector, material: number) =>
    points.forEach((point) => vertex(point, normal, material));
  for (let index = 0; index < cuts.length - 1; index++) {
    const first = vertices.length / 7;
    const front = cuts[index],
      back = cuts[index + 1];
    for (const [end, sign] of [
      [front, 1],
      [back, -1],
    ]) {
      for (let a = 0; a < curveSteps; a++) {
        face(
          [
            [0, 0, end * radii[2]],
            rim(end, (a / curveSteps) * Math.PI),
            rim(end, ((a + 1) / curveSteps) * Math.PI),
          ],
          [0, 0, sign],
          0,
        );
      }
    }
    for (let d = 0; d < depthSteps; d++) {
      const z0 = front + ((back - front) * d) / depthSteps;
      const z1 = front + ((back - front) * (d + 1)) / depthSteps;
      const top = [rim(z0, 0), rim(z1, 0), rim(z0, Math.PI), rim(z1, Math.PI)];
      face([top[0], top[1], top[2], top[2], top[1], top[3]], [0, 1, 0], 1);
      for (let a = 0; a < curveSteps; a++) {
        const t0 = (a / curveSteps) * Math.PI,
          t1 = ((a + 1) / curveSteps) * Math.PI;
        const p = [rim(z0, t0), rim(z1, t0), rim(z0, t1), rim(z1, t1)];
        for (const i of [0, 1, 2, 2, 1, 3]) vertex(p[i], skinNormal(p[i]), 2);
      }
    }
    sections.push({
      first,
      count: vertices.length / 7 - first,
      center: (front + back) * 0.5 * radii[2],
    });
  }
  return { vertices: new Float32Array(vertices), sections };
}

// Sweep a beveled rectangular cross-section around a continuous rounded path.
// Both side walls and both polished faces are present at every orientation.
export function glassMesh(steps = 12, bevelSteps = 5, hero = false) {
  const rail: { x: number; y: number; nx: number; ny: number }[] = [];
  const profile: { r: number; z: number; nr: number; nz: number }[] = [];
  const perimeter = (
    width: number,
    height: number,
    radius: number,
    steps: number,
  ) => {
    const points = [];
    for (let corner = 0; corner < 4; corner++) {
      const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width - radius);
      const cy = (corner < 2 ? 1 : -1) * (height - radius);
      for (let i = 0; i <= steps; i++) {
        const a = ((corner + i / steps) * Math.PI) / 2;
        const nx = Math.cos(a),
          ny = Math.sin(a);
        points.push({ x: cx + nx * radius, y: cy + ny * radius, nx, ny });
      }
    }
    return points;
  };
  rail.push(
    ...(hero
      ? perimeter(0.79, 0.79, 0.08, steps)
      : perimeter(0.72, 0.79, 0.165, steps)),
  );
  const crossSection = hero
    ? perimeter(0.043, 0.039, 0.014, bevelSteps)
    : perimeter(0.116, glassHalfDepth, 0.043, bevelSteps);
  for (const p of crossSection)
    profile.push({ r: p.x, z: p.y, nr: p.nx, nz: p.ny });
  const vertices: number[] = [];
  function vertex(i: number, k: number) {
    const p = rail[i % rail.length],
      q = profile[k % profile.length];
    vertices.push(
      p.x + p.nx * q.r,
      p.y + p.ny * q.r,
      q.z,
      p.nx * q.nr,
      p.ny * q.nr,
      q.nz,
      3,
    );
  }
  for (let i = 0; i < rail.length; i++)
    for (let j = 0; j < profile.length; j++) {
      vertex(i, j);
      vertex(i + 1, j);
      vertex(i, j + 1);
      vertex(i, j + 1);
      vertex(i + 1, j);
      vertex(i + 1, j + 1);
    }
  return new Float32Array(vertices);
}

// The scanner spans the opening of its polished rim. The miniature specimens
// have two solid faces and a bevel so their thickness survives a direct turn.
export function glassPlate(half: number, depth: number, material: number) {
  const vertices: number[] = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  function ring(size: number, z: number): Vector[] {
    return corners.map(([x, y]) => [x * size, y * size, z]);
  }
  function quad(points: Vector[], normal: Vector) {
    for (const i of [0, 1, 2, 0, 2, 3])
      vertices.push(...points[i], ...normal, material);
  }
  const front = ring(half - depth, depth),
    middle = ring(half, 0),
    back = ring(half - depth, -depth);
  quad(front, [0, 0, 1]);
  quad(back, [0, 0, -1]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const nx = (corners[i][0] + corners[j][0]) / 2;
    const ny = (corners[i][1] + corners[j][1]) / 2;
    quad([front[i], front[j], middle[j], middle[i]], [nx, ny, 0.6]);
    quad([middle[i], middle[j], back[j], back[i]], [nx, ny, -0.6]);
  }
  return new Float32Array(vertices);
}
