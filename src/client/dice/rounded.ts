import { add, dot, geometry, mul, type Face, type Vec } from './geometry.js';

export type Surface = {
  points: Vec[];
  normal: Vec;
  center: Vec;
  normals?: Vec[];
  faceIndex?: number;
};
export type RoundedDie = { faces: Face[]; surfaces: Surface[] };
const unit = (v: Vec) => mul(v, 1 / Math.hypot(...v));
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mean = (points: Vec[]) =>
  mul(
    points.reduce((a, b) => add(a, b), [0, 0, 0]),
    1 / points.length,
  );
const cache = new Map<string, RoundedDie>();

// A smaller polyhedron swept by a sphere: flat numbered faces, cylindrical
// edge fillets and spherical corner caps form a continuous, closed surface.
export function roundedGeometry(sides: number, segments = 4): RoundedDie {
  const key = `${sides}:${segments}`;
  if (cache.has(key)) return cache.get(key)!;
  const source = geometry(sides);
  const radius = sides === 2 ? 0.045 : sides === 6 ? 0.1 : sides === 4 ? 0.075 : 0.065;
  const inset = (point: Vec, normal: Vec) => add(mul(point, 1 - radius), mul(normal, radius));
  const faces = source.map((f) => ({
    ...f,
    points: f.points.map((p) => inset(p, f.normal)),
    center: inset(f.center, f.normal),
    inradius: f.inradius * (1 - radius),
  }));
  const surfaces: Surface[] = faces.map((f, faceIndex) => ({ ...f, faceIndex }));
  const edges = new Map<string, { a: Vec; b: Vec; normals: Vec[] }>();
  const corners = new Map<string, { point: Vec; normals: Vec[] }>();
  source.forEach((face) =>
    face.points.forEach((p, i) => {
      const next = face.points[(i + 1) % face.points.length];
      const edgeKey = [p.join(','), next.join(',')].sort().join('|');
      const edge = edges.get(edgeKey) ?? { a: p, b: next, normals: [] };
      edge.normals.push(face.normal);
      edges.set(edgeKey, edge);
      const corner = corners.get(p.join(',')) ?? { point: p, normals: [] };
      corner.normals.push(face.normal);
      corners.set(p.join(','), corner);
    }),
  );
  const arc = (a: Vec, b: Vec, t: number) => unit(add(mul(a, 1 - t), mul(b, t)));
  const surface = (points: Vec[], normal: Vec, normals: Vec[]) =>
    surfaces.push({ points, normal, normals, center: mean(points) });
  for (const {
    a,
    b,
    normals: [first, second],
  } of edges.values()) {
    for (let i = 0; i < segments; i++) {
      const n1 = arc(first, second, i / segments),
        n2 = arc(first, second, (i + 1) / segments);
      surface([inset(a, n1), inset(b, n1), inset(b, n2), inset(a, n2)], arc(n1, n2, 0.5), [n1, n1, n2, n2]);
    }
  }
  for (const { point, normals } of corners.values()) {
    const normal = unit(mean(normals));
    const u = unit(add(normals[0], mul(normal, -dot(normals[0], normal)))),
      v = cross(normal, u);
    normals.sort((a, b) => Math.atan2(dot(a, v), dot(a, u)) - Math.atan2(dot(b, v), dot(b, u)));
    const center = inset(point, normal);
    normals.forEach((a, i) => {
      const b = normals[(i + 1) % normals.length];
      for (let j = 0; j < segments; j++) {
        const n1 = arc(a, b, j / segments),
          n2 = arc(a, b, (j + 1) / segments);
        surface([center, inset(point, n1), inset(point, n2)], unit(add(add(n1, n2), normal)), [
          normal,
          n1,
          n2,
        ]);
      }
    });
  }
  const mesh = { faces, surfaces };
  cache.set(key, mesh);
  return mesh;
}
