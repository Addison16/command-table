import { add, dot, mul, type Vec } from './geometry.js';
import type { RoundedDie } from './rounded.js';
import type { VisualDie } from './DiceCanvas.js';

type Point = [number, number];
// Solid cast-resin pigments. Lighting changes the finish, not the seat color.
const pigments: Record<string, Vec> = {
  ivory: [237, 227, 207],
  blue: [61, 99, 151],
  violet: [111, 83, 146],
  ember: [176, 91, 63],
  green: [64, 121, 85],
  teal: [49, 124, 132],
  rose: [166, 76, 109],
  copper: [158, 107, 71],
};
const unit = (v: Vec) => mul(v, 1 / Math.hypot(...v));
const keyLight = unit([-0.42, 0.55, 0.72]);
const fillLight = unit([0.58, 0.16, 0.8]);
const keyHalf = unit(add(keyLight, [0, 0, 1]));
const fillHalf = unit(add(fillLight, [0, 0, 1]));
const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
};
const srgb = (radiance: number) => {
  const value = Math.max(0, Math.min(1, radiance));
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055));
};
const resinColors = Object.fromEntries(
  Object.entries(pigments).map(([name, color]) => [name, color.map(linear)]),
);
const brass = [207, 166, 93].map(linear);

function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}
export function diceSurfaceColor(normal: Vec, color: string, coin: boolean, variation = 0) {
  const neutral = !resinColors[color] || color === 'ivory';
  const pigment = coin && neutral ? brass : (resinColors[color] ?? resinColors.ivory);
  const diffuse =
    0.26 +
    Math.max(0, normal[1]) * 0.035 +
    Math.max(0, dot(normal, keyLight)) * 0.62 +
    Math.max(0, dot(normal, fillLight)) * 0.12 +
    variation;
  // A fixed studio light and dielectric reflection lobe follow the rotated
  // surface normals. Curved bevels catch the highlight as the solid tumbles.
  const specular =
    Math.pow(Math.max(0, dot(normal, keyHalf)), coin ? 48 : 80) * (coin ? 0.36 : 0.22) +
    Math.pow(Math.max(0, dot(normal, fillHalf)), coin ? 32 : 64) * (coin ? 0.075 : 0.035);
  const reflection = coin && neutral ? [1, 0.85, 0.55] : [1, 1, 1];
  return (
    'rgb(' + pigment.map((channel, i) => srgb(channel * diffuse + specular * reflection[i])).join(',') + ')'
  );
}

/** The front face is always the recorded value, including percentile zeroes. */
export function diceFaceLabel(die: VisualDie, faceIndex: number): string {
  if (die.symbol) return '✦';
  if (die.sides === 2) return (die.value + faceIndex) % 2 ? 'H' : 'T';
  const value = die.percent
    ? ((die.value / 10 + faceIndex) % 10) * 10
    : ((die.value - 1 + faceIndex + die.sides) % die.sides) + 1;
  return die.percent
    ? String(faceIndex === 0 ? die.value : value).padStart(2, '0')
    : String(faceIndex === 0 ? die.value : value);
}

function micrograin(ctx: CanvasRenderingContext2D, index: number) {
  // Very fine imperfections are fixed in material coordinates. They add a
  // quiet physical finish without decorative stripes or face-sized patterns.
  for (let speck = 0; speck < 38; speck++) {
    const x = Math.sin((speck + 1) * 71.23 + index * 9.7) * 110;
    const y = Math.sin((speck + 1) * 43.71 + index * 5.3) * 110;
    ctx.fillStyle = speck % 2 ? 'rgba(255,255,249,.045)' : 'rgba(5,10,20,.035)';
    ctx.fillRect(x, y, 0.85, 0.65);
  }
}

function coinRim(ctx: CanvasRenderingContext2D, radius: number) {
  const ring = (r: number, color: string, width: number) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  ring(radius, 'rgba(38,27,12,.32)', 1.2);
  ring(radius - 1, 'rgba(255,248,216,.45)', 0.7);
  ring(radius - 8, 'rgba(38,27,12,.2)', 0.6);
  for (let mark = 0; mark < 64; mark++) {
    const angle = (mark * Math.PI) / 32;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (radius - 2.5), Math.sin(angle) * (radius - 2.5));
    ctx.lineTo(Math.cos(angle) * (radius - 5.5), Math.sin(angle) * (radius - 5.5));
    ctx.strokeStyle = mark % 2 ? 'rgba(255,248,216,.35)' : 'rgba(38,27,12,.28)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

export function drawIvoryDie(
  ctx: CanvasRenderingContext2D,
  mesh: RoundedDie,
  project: (v: Vec) => Point,
  rotate: (v: Vec) => Vec,
  die: VisualDie,
  scale: number,
) {
  const coin = die.sides === 2;
  const pearl = die.color === 'ivory' || !pigments[die.color];
  const visible = mesh.surfaces
    .map((surface) => ({ ...surface, normal: rotate(surface.normal), depth: rotate(surface.center)[2] }))
    .filter((s) => s.normal[2] * 4.8 - dot(s.normal, rotate(s.center)) > 0)
    .sort((a, b) => a.depth - b.depth);
  ctx.lineJoin = 'round';
  for (const surface of visible) {
    const points = surface.points.map(project);
    polygon(ctx, points);
    const color = diceSurfaceColor(surface.normal, die.color, coin);
    ctx.fillStyle = color;
    if (surface.normals) {
      // Blend the actual normals across a curved fillet. Matching endpoint
      // lighting removes the hard polygon bands from a polished rounded edge.
      const quad = points.length === 4;
      const start: Point = quad
        ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]
        : points[0];
      const end: Point = quad
        ? [(points[2][0] + points[3][0]) / 2, (points[2][1] + points[3][1]) / 2]
        : [(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2];
      const endNormal = quad ? surface.normals[2] : unit(add(surface.normals[1], surface.normals[2]));
      const gradient = ctx.createLinearGradient(start[0], start[1], end[0], end[1]);
      gradient.addColorStop(0, diceSurfaceColor(rotate(surface.normals[0]), die.color, coin));
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, diceSurfaceColor(rotate(endNormal), die.color, coin));
      ctx.fillStyle = gradient;
    } else if (surface.faceIndex !== undefined) {
      // Only a slight variation over a flat face: the finish stays smooth
      // while the large-area light falls off across the physical surface.
      const [x, y] = project(surface.center);
      const gradient = ctx.createLinearGradient(
        x - scale * 0.5,
        y - scale * 0.7,
        x + scale * 0.5,
        y + scale * 0.7,
      );
      gradient.addColorStop(0, diceSurfaceColor(surface.normal, die.color, coin, 0.012));
      gradient.addColorStop(1, diceSurfaceColor(surface.normal, die.color, coin, -0.012));
      ctx.fillStyle = gradient;
    }
    ctx.fill();
    // Fill tiny rasterization gaps using the same material; no edge outline.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.35;
    ctx.stroke();
  }
  for (const surface of visible) {
    const i = surface.faceIndex;
    if (i === undefined || surface.normal[2] < 0.14) continue;
    const face = mesh.faces[i];
    if (coin && face.points.length < 5) continue;
    const center = project(face.center);
    const u = project(add(face.center, mul(face.u, 0.1))),
      v = project(add(face.center, mul(face.v, 0.1)));
    ctx.save();
    polygon(ctx, face.points.map(project));
    ctx.clip();
    ctx.transform(
      (u[0] - center[0]) / 10,
      (u[1] - center[1]) / 10,
      (v[0] - center[0]) / -10,
      (v[1] - center[1]) / -10,
      center[0],
      center[1],
    );
    if (scale > 34) micrograin(ctx, i);
    if (coin) coinRim(ctx, face.inradius * 87);
    const label = diceFaceLabel(die, i);
    let fontSize = Math.min(coin ? 80 : 64, face.inradius * (label.length > 1 ? 132 : 150));
    const fontFamily = coin ? "'Cormorant Garamond', Georgia, serif" : 'Inter, sans-serif';
    ctx.font = '500 ' + fontSize + 'px ' + fontFamily;
    fontSize *= Math.min(1, (face.inradius * 145) / ctx.measureText(label).width);
    ctx.font = '500 ' + fontSize + 'px ' + fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(label);
    const baseline = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    // A small dark incision above and a fine reflected lip below make the
    // opaque ink sit inside the face rather than float as outlined lettering.
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = pearl ? 'rgba(47,34,19,.14)' : 'rgba(3,8,15,.35)';
    ctx.strokeText(label, 0, baseline - 0.3);
    ctx.fillStyle = pearl ? 'rgba(255,255,247,.5)' : 'rgba(255,250,230,.28)';
    ctx.fillText(label, 0, baseline + 0.55);
    ctx.fillStyle = pearl ? '#51483c' : '#e9e3d3';
    if (coin) {
      const metal = ctx.createLinearGradient(0, baseline - fontSize / 2, 0, baseline + fontSize / 2);
      metal.addColorStop(0, pearl ? '#51402b' : '#eee7d2');
      metal.addColorStop(0.5, pearl ? '#655139' : '#e0d6b9');
      metal.addColorStop(1, pearl ? '#483a2a' : '#ece3cb');
      ctx.fillStyle = metal;
    }
    ctx.shadowColor = pearl ? 'rgba(37,25,13,.22)' : 'rgba(3,8,15,.3)';
    ctx.shadowBlur = 0.45;
    ctx.shadowOffsetY = -0.35;
    ctx.fillText(label, 0, baseline);
    ctx.restore();
  }
}
