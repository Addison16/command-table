export type Vec = [number, number, number];
export type Face = { points: Vec[]; center: Vec; normal: Vec; u: Vec; v: Vec; inradius: number };
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec, n: number): Vec => [a[0] * n, a[1] * n, a[2] * n];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec) => mul(v, 1 / Math.hypot(...v));
const subtract = (a: Vec, b: Vec) => add(a, mul(b, -1));
const cache = new Map<number, Face[]>();

// Build actual convex polyhedra. Rendering them in Canvas2D avoids requiring a
// WebGL context on older phones; every face still has a 3D normal and projection.
function hull(vertices: Vec[]): Face[] {
  const planes = new Map<string, { ids: number[]; normal: Vec }>();
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++) {
        let n = cross(subtract(vertices[b], vertices[a]), subtract(vertices[c], vertices[a]));
        if (Math.hypot(...n) < 1e-6) continue;
        n = unit(n);
        const distances = vertices.map((v) => dot(n, subtract(v, vertices[a])));
        if (distances.some((d) => d > 1e-5) && distances.some((d) => d < -1e-5)) continue;
        if (dot(n, vertices[a]) < 0) n = mul(n, -1);
        const ids = distances.flatMap((d, i) => (Math.abs(d) < 1e-5 ? [i] : []));
        planes.set(ids.join(','), { ids, normal: n });
      }
  return [...planes.values()].map(({ ids, normal }) => {
    const center = mul(
      ids.reduce<Vec>((sum, i) => add(sum, vertices[i]), [0, 0, 0]),
      1 / ids.length,
    );
    let u = unit(subtract(vertices[ids[0]], center)),
      v = cross(normal, u);
    const points = ids
      .map((i) => vertices[i])
      .sort(
        (a, b) =>
          Math.atan2(dot(subtract(a, center), v), dot(subtract(a, center), u)) -
          Math.atan2(dot(subtract(b, center), v), dot(subtract(b, center), u)),
      );
    // Give the face a deliberate upright outline: square edges are level;
    // triangular, pentagonal and kite faces point toward the top of the screen.
    const radii = points.map((p) => Math.hypot(...subtract(p, center)));
    if (points.length === 4 && Math.max(...radii) - Math.min(...radii) < 1e-5) {
      u = unit(subtract(points[1], points[0]));
      v = cross(normal, u);
    } else {
      const top = points[radii.indexOf(Math.max(...radii))];
      v = unit(subtract(top, center));
      u = cross(v, normal);
    }
    const inradius = Math.min(
      ...points.map((p, i) => {
        const edge = subtract(points[(i + 1) % points.length], p);
        return Math.abs(dot(cross(edge, subtract(center, p)), normal)) / Math.hypot(...edge);
      }),
    );
    return { points, center, normal, u, v, inradius };
  });
}
function dual(vertices: Vec[]) {
  const points = hull(vertices).map((f) => mul(f.normal, 1 / dot(f.normal, f.center)));
  const radius = Math.max(...points.map((v) => Math.hypot(...v)));
  return points.map((v) => mul(v, 1 / radius));
}
function coinGeometry(): Face[] {
  // Construct the cylinder directly. A dense convex-hull search would make a
  // smooth coin unnecessarily expensive on its first appearance on a phone.
  const segments = 32;
  const radius = Math.hypot(1, 0.16);
  const ring = (z: number): Vec[] =>
    Array.from({ length: segments }, (_, i) => [
      Math.cos((i * Math.PI * 2) / segments) / radius,
      Math.sin((i * Math.PI * 2) / segments) / radius,
      z / radius,
    ]);
  const top = ring(0.16),
    bottom = ring(-0.16);
  const faces: Face[] = [
    {
      points: top,
      center: [0, 0, 0.16 / radius],
      normal: [0, 0, 1],
      u: [1, 0, 0],
      v: [0, 1, 0],
      inradius: Math.cos(Math.PI / segments) / radius,
    },
    {
      points: [...bottom].reverse(),
      center: [0, 0, -0.16 / radius],
      normal: [0, 0, -1],
      u: [1, 0, 0],
      v: [0, -1, 0],
      inradius: Math.cos(Math.PI / segments) / radius,
    },
  ];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const angle = ((i + 0.5) * Math.PI * 2) / segments;
    const normal: Vec = [Math.cos(angle), Math.sin(angle), 0];
    faces.push({
      points: [bottom[i], bottom[next], top[next], top[i]],
      center: mul(normal, Math.cos(Math.PI / segments) / radius),
      normal,
      u: [-Math.sin(angle), Math.cos(angle), 0],
      v: [0, 0, 1],
      inradius: Math.min(0.16, Math.sin(Math.PI / segments)) / radius,
    });
  }
  return faces;
}
export function geometry(sides: number): Face[] {
  const key = sides === 100 ? 10 : sides;
  if (cache.has(key)) return cache.get(key)!;
  if (key === 2) {
    const faces = coinGeometry();
    cache.set(key, faces);
    return faces;
  }
  let vertices: Vec[] = [];
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico: Vec[] = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  if (key === 4)
    vertices = [
      [1, 1, 1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, -1, -1],
    ];
  else if (key === 6)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push([x, y, z]);
  else if (key === 8)
    vertices = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  else if (key === 10) {
    const anti: Vec[] = Array.from({ length: 10 }, (_, i) => [
      Math.cos((i * Math.PI) / 5),
      Math.sin((i * Math.PI) / 5),
      i % 2 ? 0.82 : -0.82,
    ]);
    vertices = dual(anti);
  } else if (key === 12) vertices = dual(ico);
  else vertices = ico;
  const radius = Math.max(...vertices.map((v) => Math.hypot(...v)));
  const faces = hull(vertices.map((v) => mul(v, 1 / radius)));
  cache.set(key, faces);
  return faces;
}

export function orient(point: Vec, face: Face, spin: Vec): Vec {
  let [x, y, z] = [dot(point, face.u), dot(point, face.v), dot(point, face.normal)];
  const [a, b, c] = spin;
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  return [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
}

// The result face must finish exactly square to the viewer, with level edges
// and upright lettering. Remaining angular travel comes from the motion track.
export function rollSpin(progress: number, seed: number): Vec {
  const amount = 1 - Math.max(0, Math.min(1, progress));
  return [amount * (6.2 + seed * 4), amount * (8.6 + seed * 4.5), amount * (2.2 + seed * 2.4)];
}
