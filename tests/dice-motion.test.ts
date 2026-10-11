import { describe, expect, it } from 'vitest';
import { faceTurns, makeDieMotion, sampleDieMotion } from '../src/client/dice/motion.js';
import { geometry, type Vec } from '../src/client/dice/geometry.js';

const FRAME = 1 / 120;
const GRAVITY = 60;
const allSides = [2, 4, 6, 8, 10, 12, 20];
const seeds = Array.from({ length: 40 }, (_, index) => Math.imul(index + 1, 2654435761) >>> 0);
const square: Vec[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Angle between two attitudes, from the trace of one against the other. */
const turned = (a: readonly Vec[], b: readonly Vec[]) => {
  let trace = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) trace += a[i][j] * b[i][j];
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
};

describe('physical dice motion', () => {
  it('repeats a seeded throw exactly and gives other seeds and solids their own', () => {
    expect(makeDieMotion(813, 20)).toEqual(makeDieMotion(813, 20));
    expect(makeDieMotion(813, 20)).not.toEqual(makeDieMotion(814, 20));
    expect(makeDieMotion(813, 6)).not.toEqual(makeDieMotion(813, 20));
    expect(makeDieMotion(813, 2)).not.toEqual(makeDieMotion(813, 6));
  });

  it('falls freely under gravity with a steady spin until it first strikes the table', () => {
    for (const sides of [6, 20]) {
      const track = makeDieMotion(813, sides);
      const strike = Math.floor(track.impacts[0].time / FRAME);
      expect(strike).toBeGreaterThan(12);
      const flight = track.frames.slice(0, strike);
      expect(flight.every((frame) => !frame.grounded && frame.z > 0)).toBe(true);
      const spins: number[] = [];
      for (let i = 1; i < flight.length - 1; i++) {
        const [before, now, after] = [flight[i - 1], flight[i], flight[i + 1]];
        expect((after.z - 2 * now.z + before.z) / FRAME ** 2).toBeCloseTo(-GRAVITY, 6);
        expect(after.x - now.x).toBeCloseTo(now.x - before.x, 10);
        expect(after.y - now.y).toBeCloseTo(now.y - before.y, 10);
        spins.push(
          turned(sampleDieMotion(track, now.time).rotation, sampleDieMotion(track, after.time).rotation),
        );
      }
      expect(Math.min(...spins)).toBeGreaterThan(0.02);
      expect(Math.max(...spins) - Math.min(...spins)).toBeLessThan(1e-4);
    }
  });

  it('changes both its travel and its spin when a corner strikes the table', () => {
    const track = makeDieMotion(813, 6);
    const strike = track.impacts[0];
    expect(strike.speed).toBeGreaterThan(5);
    const speed = (time: number) => {
      const [a, b] = [sampleDieMotion(track, time), sampleDieMotion(track, time + FRAME)];
      return { rise: (b.z - a.z) / FRAME, spin: turned(a.rotation, b.rotation) / FRAME };
    };
    const before = speed(strike.time - 3 * FRAME);
    const after = speed(strike.time + 3 * FRAME);
    expect(before.rise).toBeLessThan(-5);
    expect(after.rise).toBeGreaterThan(before.rise + 5);
    expect(Math.abs(after.spin - before.spin)).toBeGreaterThan(0.5);
  });

  it.each(allSides)('settles a d%i on a face by itself, above the table, in good time', (sides) => {
    for (const seed of seeds) {
      const track = makeDieMotion(seed, sides);
      // Only a last fraction of a degree is eased away; the throw is not steered.
      expect(track.correction).toBeLessThan(0.03);
      expect(track.restTime).toBeGreaterThan(0.6);
      expect(track.restTime).toBeLessThan(2.45);
      expect(track.duration).toBeGreaterThan(track.restTime);
      expect(track.impacts.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < track.impacts.length; i++)
        expect(track.impacts[i].time).toBeGreaterThanOrEqual(track.impacts[i - 1].time);
      const start = track.frames[0];
      expect(start.z).toBeGreaterThan(sides === 2 ? 0.4 : 2.5);
      expect(Math.hypot(start.x, start.y)).toBeLessThan(12);
      for (const frame of track.frames) {
        expect(frame.z).toBeGreaterThanOrEqual(0);
        expect(frame.z).toBeLessThan(5);
        expect(Math.hypot(...frame.q)).toBeCloseTo(1, 9);
      }
      const still = track.frames.filter((frame) => frame.time > track.restTime - 0.05);
      expect(still.every((frame) => frame.grounded && frame.z < 0.01)).toBe(true);
    }
  });

  it('rests exactly square and still, with no further movement afterwards', () => {
    for (const sides of allSides) {
      const track = makeDieMotion(98451, sides);
      const rest = { x: 0, y: 0, z: 0, rotation: square, grounded: true, settle: 1, finished: false };
      expect(sampleDieMotion(track, track.restTime)).toEqual(rest);
      expect(sampleDieMotion(track, (track.restTime + track.duration) / 2)).toEqual(rest);
      expect(sampleDieMotion(track, track.duration)).toEqual({ ...rest, finished: true });
      expect(sampleDieMotion(track, 1000)).toEqual({ ...rest, finished: true });
      const before = sampleDieMotion(track, track.restTime - FRAME);
      expect(Math.hypot(before.x, before.y, before.z)).toBeLessThan(0.002);
      expect(turned(before.rotation, square)).toBeLessThan(0.002);
      expect(sampleDieMotion(track, 0).settle).toBe(0);
    }
  });

  it('interpolates the same poses at common times regardless of rendering cadence', () => {
    const track = makeDieMotion(913, 20);
    const at30Hz = Array.from({ length: 64 }, (_, index) => sampleDieMotion(track, index / 30));
    const at120Hz = Array.from({ length: 253 }, (_, index) => sampleDieMotion(track, index / 120));
    for (let i = 0; i < at30Hz.length; i++) expect(at30Hz[i]).toEqual(at120Hz[i * 4]);
    const left = track.frames[25];
    const right = track.frames[26];
    const middle = sampleDieMotion(track, (left.time + right.time) / 2);
    expect(middle.x).toBeCloseTo((left.x + right.x) / 2, 12);
    expect(middle.y).toBeCloseTo((left.y + right.y) / 2, 12);
    expect(middle.z).toBeCloseTo((left.z + right.z) / 2, 12);
    for (const row of middle.rotation) expect(Math.hypot(...row)).toBeCloseTo(1, 9);
    expect(sampleDieMotion(track, -1)).toEqual(sampleDieMotion(track, 0));
    expect(sampleDieMotion(track, Number.POSITIVE_INFINITY)).toEqual(sampleDieMotion(track, track.duration));
  });

  it.each([4, 6, 8, 10, 12, 20])(
    'can read any resting face of a d%i as the result without changing its shape',
    (sides) => {
      // The face that ends on top is given the recorded value. That is only
      // honest if exchanging faces, or turning one, leaves the same solid.
      const faces = geometry(sides);
      const corners = [
        ...new Map(faces.flatMap((face) => face.points).map((point) => [point.join(','), point])).values(),
      ];
      const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const onSolid = (point: Vec, mirrored: boolean) =>
        corners.some((corner) =>
          corner.every((value, axis) => Math.abs(value * (mirrored ? -1 : 1) - point[axis]) < 1e-9),
        );
      const first = faces[0];
      for (const face of faces)
        for (let turn = 0; turn < faceTurns[sides]; turn++) {
          const angle = (turn * Math.PI * 2) / faceTurns[sides];
          // A d4 shows the face it lies on, seen through from above.
          const flip = sides === 4 ? -1 : 1;
          for (const corner of corners) {
            const [a, b, c] = [dot(corner, first.u), dot(corner, first.v), dot(corner, first.normal)];
            const u = a * Math.cos(angle) - b * Math.sin(angle);
            const v = a * Math.sin(angle) + b * Math.cos(angle);
            const moved: Vec = [0, 1, 2].map(
              (axis) => u * face.u[axis] + flip * v * face.v[axis] + flip * c * face.normal[axis],
            ) as Vec;
            expect(onSolid(moved, sides === 4)).toBe(true);
          }
        }
    },
  );
});
