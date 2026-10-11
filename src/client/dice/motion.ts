import { geometry, type Face, type Vec } from './geometry.js';
import { cornerRadius } from './rounded.js';

/** Rows of a rotation from the die's result-face frame to the table. */
export type Rotation = [Vec, Vec, Vec];

/** Offsets and elevation are in die radii, relative to the resting die. */
export type DieMotionPose = {
  x: number;
  y: number;
  /** Height of the die above its resting height; zero whenever it lies flat. */
  z: number;
  rotation: Rotation;
  grounded: boolean;
  /** Rises from 0 to 1 over the last moments before the die lies still. */
  settle: number;
  finished: boolean;
};

export type DieMotionImpact = {
  time: number;
  /** Speed at which a corner struck the table, in radii per second. */
  speed: number;
};

type Quat = [number, number, number, number];
type DieMotionFrame = { time: number; x: number; y: number; z: number; q: Quat; grounded: boolean };
export type DieMotionTrack = {
  duration: number;
  restTime: number;
  frames: readonly DieMotionFrame[];
  impacts: readonly DieMotionImpact[];
  /** Angle, in radians, eased away at the end to leave the result exactly square. */
  correction: number;
};

const STEP = 1 / 240;
const FRAME = 2 * STEP;
const LIMIT = 2.6;
const GRAVITY = 60;
const FRICTION = 0.5;
const RESTITUTION = 0.36;
const MAT_LOSS = 0.07;
const BOUNCE_SPEED = 1.8;
const IMPACT_SPEED = 0.9;
const ROLLING_DAMPING = 1.8;
const ROLLING_FRICTION = 3;
const SETTLE = 0.2;
const HOLD = 0.3;
const IDENTITY: Rotation = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const matrix = ([w, x, y, z]: Quat): Rotation => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
];
const apply = (m: Rotation, v: Vec): Vec => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const multiply = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const normalize = (q: Quat): Quat => {
  const length = Math.hypot(...q);
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
};
const about = (axis: Vec, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
};
/** Quaternion of the rotation whose columns are the given orthonormal axes. */
function fromAxes(u: Vec, v: Vec, n: Vec): Quat {
  const trace = u[0] + v[1] + n[2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [s / 4, (v[2] - n[1]) / s, (n[0] - u[2]) / s, (u[1] - v[0]) / s];
  }
  if (u[0] > v[1] && u[0] > n[2]) {
    const s = Math.sqrt(1 + u[0] - v[1] - n[2]) * 2;
    return [(v[2] - n[1]) / s, s / 4, (v[0] + u[1]) / s, (n[0] + u[2]) / s];
  }
  if (v[1] > n[2]) {
    const s = Math.sqrt(1 + v[1] - u[0] - n[2]) * 2;
    return [(n[0] - u[2]) / s, (v[0] + u[1]) / s, s / 4, (n[1] + v[2]) / s];
  }
  const s = Math.sqrt(1 + n[2] - u[0] - v[1]) * 2;
  return [(u[1] - v[0]) / s, (n[0] + u[2]) / s, (n[1] + v[2]) / s, s / 4];
}

type Shape = {
  faces: Face[];
  /** Corner centers of the rounded solid; each carries a sphere of `radius`. */
  points: Vec[];
  radius: number;
  /** Center height of the solid lying on a face. */
  rest: number;
  /** Moment of inertia for unit mass; these solids are close to isotropic. */
  inertia: number;
  /** Rotations about the result face that map the solid onto itself. */
  turns: number;
  /** Only these faces can face the camera at rest. */
  results: number[];
};
const shapes = new Map<number, Shape>();
const inertia: Record<number, number> = { 2: 0.25, 4: 0.13, 6: 0.22, 8: 0.2, 10: 0.24, 12: 0.27, 20: 0.28 };
/** How many turns of its result face leave each solid looking the same. */
export const faceTurns: Record<number, number> = { 2: Infinity, 4: 3, 6: 4, 8: 3, 10: 1, 12: 5, 20: 3 };

function shape(sides: number): Shape {
  const key = sides === 100 ? 10 : sides;
  let found = shapes.get(key);
  if (!found) {
    const faces = geometry(key);
    const radius = cornerRadius(key);
    const corners = [
      ...new Map(faces.flatMap((face) => face.points).map((point) => [point.join(','), point])).values(),
    ];
    found = {
      faces,
      // A coin's rim needs far fewer contact points than its drawn outline.
      points: (key === 2 ? corners.filter((_, index) => index % 2 === 0) : corners).map((point) => [
        point[0] * (1 - radius),
        point[1] * (1 - radius),
        point[2] * (1 - radius),
      ]),
      radius,
      rest:
        (faces[0].center[0] * faces[0].normal[0] +
          faces[0].center[1] * faces[0].normal[1] +
          faces[0].center[2] * faces[0].normal[2]) *
          (1 - radius) +
        radius,
      inertia: inertia[key],
      turns: faceTurns[key],
      results: key === 2 ? [0, 1] : faces.map((_, index) => index),
    };
    shapes.set(key, found);
  }
  return found;
}

type Toss = {
  steps: { x: number; y: number; z: number; q: Quat; grounded: boolean }[];
  impacts: DieMotionImpact[];
  rested: boolean;
};

/** One rigid body thrown onto a table: gravity, corner impacts and Coulomb friction. */
function toss(body: Shape, random: () => number, coin: boolean): Toss {
  const count = body.points.length;
  const inverseInertia = 1 / body.inertia;
  const lean = (random() - 0.5) * 0.5;
  const speed = coin ? 1.2 + random() * 1.4 : 6.4 + random() * 2.6;
  let px = 0,
    py = 0,
    pz = body.rest + (coin ? 0.5 + random() * 0.4 : 2.6 + random() * 1.5);
  let vx = Math.sin(lean) * speed,
    vy = Math.cos(lean) * speed,
    vz = coin ? 13 + random() * 3 : -1 + random() * 3.5;
  // A uniformly random starting attitude.
  const [a, b, c] = [random(), random() * Math.PI * 2, random() * Math.PI * 2];
  let q: Quat = [
    Math.sqrt(1 - a) * Math.sin(b),
    Math.sqrt(1 - a) * Math.cos(b),
    Math.sqrt(a) * Math.sin(c),
    Math.sqrt(a) * Math.cos(c),
  ];
  // Mostly the forward tumble of a thrown die, plus some spin of its own.
  const tumble = coin ? 22 + random() * 8 : speed * (0.9 + random() * 0.5);
  const stray = coin ? 2.5 : 5 + random() * 5;
  const strayAngle = random() * Math.PI * 2,
    strayTilt = (random() - 0.5) * 2;
  const flat = Math.sqrt(1 - strayTilt * strayTilt);
  let wx = -Math.cos(lean) * tumble + Math.cos(strayAngle) * flat * stray,
    wy = Math.sin(lean) * tumble + Math.sin(strayAngle) * flat * stray,
    wz = strayTilt * stray;
  const armX = new Float64Array(count),
    armY = new Float64Array(count),
    armZ = new Float64Array(count);
  const target = new Float64Array(count),
    normal = new Float64Array(count),
    slideX = new Float64Array(count),
    slideY = new Float64Array(count);
  const touching = new Uint8Array(count);
  const active: number[] = [];
  const impacts: DieMotionImpact[] = [];
  const steps: Toss['steps'] = [{ x: px, y: py, z: pz, q, grounded: false }];
  let calm = 0;
  let rested = false;
  const total = Math.round(LIMIT / STEP);
  for (let step = 1; step <= total; step++) {
    vz -= GRAVITY * STEP;
    const m = matrix(q);
    let lowest = Infinity;
    for (let i = 0; i < count; i++) {
      const point = body.points[i];
      armX[i] = m[0][0] * point[0] + m[0][1] * point[1] + m[0][2] * point[2];
      armY[i] = m[1][0] * point[0] + m[1][1] * point[1] + m[1][2] * point[2];
      armZ[i] = m[2][0] * point[0] + m[2][1] * point[1] + m[2][2] * point[2] - body.radius;
      lowest = Math.min(lowest, pz + armZ[i]);
    }
    // Lift a sunken corner back to the surface; nothing is stored below it.
    if (lowest < 0) pz -= lowest;
    active.length = 0;
    let struck = false;
    for (let i = 0; i < count; i++) {
      if (pz + armZ[i] > 0.004) {
        touching[i] = 0;
        continue;
      }
      const approach = vz + wx * armY[i] - wy * armX[i];
      target[i] = approach < -BOUNCE_SPEED ? -RESTITUTION * approach : 0;
      if (!touching[i] && approach < -IMPACT_SPEED) {
        impacts.push({ time: (step - 1) * STEP, speed: -approach });
        struck = true;
      }
      touching[i] = 1;
      normal[i] = slideX[i] = slideY[i] = 0;
      active.push(i);
    }
    if (struck) {
      // Each strike sinks a little into the mat and gives up some of its motion.
      vx *= 1 - MAT_LOSS;
      vy *= 1 - MAT_LOSS;
      wx *= 1 - MAT_LOSS;
      wy *= 1 - MAT_LOSS;
      wz *= 1 - MAT_LOSS;
    }
    for (let pass = 0; pass < 8; pass++)
      for (const i of active) {
        const ax = armX[i],
          ay = armY[i],
          az = armZ[i];
        // The table pushes but never pulls, so the accumulated impulse stays positive.
        const closing = vz + wx * ay - wy * ax;
        const push = Math.max(
          0,
          normal[i] + (target[i] - closing) / (1 + (ax * ax + ay * ay) * inverseInertia),
        );
        const dn = push - normal[i];
        normal[i] = push;
        vz += dn;
        wx += ay * dn * inverseInertia;
        wy -= ax * dn * inverseInertia;
        // Friction opposes sliding at the corner, up to its Coulomb limit.
        let fx = slideX[i] - (vx + wy * az - wz * ay) / (1 + (ay * ay + az * az) * inverseInertia);
        let fy = slideY[i] - (vy + wz * ax - wx * az) / (1 + (ax * ax + az * az) * inverseInertia);
        const grip = FRICTION * push,
          wanted = Math.hypot(fx, fy);
        if (wanted > grip) {
          fx *= grip / wanted;
          fy *= grip / wanted;
        }
        const dx = fx - slideX[i],
          dy = fy - slideY[i];
        slideX[i] = fx;
        slideY[i] = fy;
        vx += dx;
        vy += dy;
        wx -= az * dy * inverseInertia;
        wy += az * dx * inverseInertia;
        wz += (ax * dy - ay * dx) * inverseInertia;
      }
    if (active.length) {
      // Rolling resistance: a soft mat takes a little spin with every turn and
      // brings a slow roll to a definite stop instead of an endless creep.
      // It acts on the roll as a whole: slowing the spin alone would let
      // friction wind it straight back up from the die's forward motion.
      const pace = Math.hypot(wx, wy, wz, vx, vy);
      const keep = Math.max(0, 1 - ROLLING_DAMPING * STEP - (ROLLING_FRICTION * STEP) / (pace || 1));
      wx *= keep;
      wy *= keep;
      wz *= keep;
      vx *= keep;
      vy *= keep;
    }
    px += vx * STEP;
    py += vy * STEP;
    pz += vz * STEP;
    const half = STEP / 2;
    q = normalize([
      q[0] + half * (-wx * q[1] - wy * q[2] - wz * q[3]),
      q[1] + half * (wx * q[0] + wy * q[3] - wz * q[2]),
      q[2] + half * (wy * q[0] + wz * q[1] - wx * q[3]),
      q[3] + half * (wz * q[0] + wx * q[2] - wy * q[1]),
    ]);
    const lying = active.length >= 3 && pz - body.rest < 0.004;
    calm = lying && Math.hypot(vx, vy, vz) < 0.12 && Math.hypot(wx, wy, wz) < 0.3 ? calm + STEP : 0;
    steps.push({ x: px, y: py, z: pz, q, grounded: active.length > 0 });
    if (calm >= 0.08) {
      rested = true;
      break;
    }
  }
  return { steps, impacts, rested };
}

function finish(body: Shape, thrown: Toss, d4: boolean): DieMotionTrack {
  const last = thrown.steps[thrown.steps.length - 1];
  const m = matrix(last.q);
  // A d4 has no face on top, so the face it rests on is the one presented.
  let chosen = body.results[0],
    best = -Infinity;
  for (const index of body.results) {
    const up = apply(m, body.faces[index].normal)[2] * (d4 ? -1 : 1);
    if (up > best) {
      best = up;
      chosen = index;
    }
  }
  const face = body.faces[chosen];
  const flip = d4 ? -1 : 1;
  const v: Vec = [face.v[0] * flip, face.v[1] * flip, face.v[2] * flip];
  const n: Vec = [face.normal[0] * flip, face.normal[1] * flip, face.normal[2] * flip];
  const heading = apply(m, face.u);
  const yaw = Math.atan2(heading[1], heading[0]);
  // The solid is identical after a turn of its result face, so only the small
  // remainder has to be removed by turning the whole throw about the vertical.
  const turn = Number.isFinite(body.turns)
    ? -Math.round(yaw / ((Math.PI * 2) / body.turns)) * ((Math.PI * 2) / body.turns)
    : -yaw;
  const remainder = yaw + turn;
  const relabel = multiply(about(n, turn), fromAxes(face.u, v, n));
  const world = about([0, 0, 1], -remainder);
  const cos = Math.cos(-remainder),
    sin = Math.sin(-remainder);
  const restTime = (thrown.steps.length - 1) * STEP;
  const frames: DieMotionFrame[] = [];
  for (let index = 0; index < thrown.steps.length; index += 2) {
    const pose = thrown.steps[index];
    let rotation = multiply(multiply(world, pose.q), relabel);
    // Neighbouring frames stay on one side of the double cover so they blend.
    const previous = frames[frames.length - 1]?.q;
    if (previous && multiplyDot(previous, rotation) < 0)
      rotation = [-rotation[0], -rotation[1], -rotation[2], -rotation[3]];
    const dx = pose.x - last.x,
      dy = pose.y - last.y;
    frames.push({
      time: index * STEP,
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
      z: Math.max(0, pose.z - body.rest),
      q: rotation,
      grounded: pose.grounded,
    });
  }
  const sign = frames[frames.length - 1].q[0] < 0 ? -1 : 1;
  const correction = 2 * Math.acos(Math.min(1, Math.abs(frames[frames.length - 1].q[0])));
  for (const frame of frames) {
    // Ease out the last fraction of a degree so rest is exactly square.
    const settled = Math.max(0, Math.min(1, (frame.time - (restTime - SETTLE)) / SETTLE));
    const ease = settled * settled * (3 - 2 * settled);
    const q = frame.q;
    frame.q = normalize([
      q[0] * sign + (1 - q[0] * sign) * ease,
      q[1] * sign * (1 - ease),
      q[2] * sign * (1 - ease),
      q[3] * sign * (1 - ease),
    ]);
    frame.x *= 1 - ease;
    frame.y *= 1 - ease;
    frame.z *= 1 - ease;
  }
  const rest = frames[frames.length - 1].time + FRAME;
  frames.push({ time: rest, x: 0, y: 0, z: 0, q: [1, 0, 0, 0], grounded: true });
  return { duration: rest + HOLD, restTime: rest, frames, impacts: thrown.impacts, correction };
}
const multiplyDot = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/**
 * Throw one die with rigid-body physics and record its flight. The die that
 * comes to rest is then read the way a real one is: whichever face ends on top
 * carries the recorded result. Turning the whole throw about the vertical and
 * sliding it across the table changes nothing physical, so every die can also
 * finish square to the viewer in its own place without being steered there.
 */
export function makeDieMotion(seed: number, sides = 20): DieMotionTrack {
  const body = shape(sides);
  const coin = sides === 2;
  let chosen: DieMotionTrack | undefined;
  let chosenScore = Infinity;
  // A few throws are compared for the best one; one that failed to settle in
  // time is never kept while further throws remain to try.
  for (let attempt = 0; attempt < (chosenScore < 10 ? 8 : 20); attempt++) {
    const thrown = toss(body, seededRandom(seed + Math.imul(attempt, 0x9e3779b1)), coin);
    const track = finish(body, thrown, sides === 4);
    // Prefer a throw that settles in good time and, for dice, one that crosses
    // a fair stretch of table from the players' side of the screen.
    const start = track.frames[0];
    const score =
      (thrown.rested ? 0 : 10) +
      Math.max(0, 1 - track.restTime) +
      Math.max(0, track.restTime - 2.3) * 2 +
      (coin
        ? 0
        : Math.max(0, Math.abs(Math.atan2(start.x, -start.y)) - 0.9) +
          Math.max(0, 3 - Math.hypot(start.x, start.y)) / 2);
    if (score < chosenScore) {
      chosen = track;
      chosenScore = score;
    }
    if (score === 0) break;
  }
  return chosen!;
}

export const restingPose: DieMotionPose = {
  x: 0,
  y: 0,
  z: 0,
  rotation: IDENTITY,
  grounded: true,
  settle: 1,
  finished: true,
};

/** Sample by elapsed time; results are independent of rendering frame rate. */
export function sampleDieMotion(track: DieMotionTrack, elapsedSeconds: number): DieMotionPose {
  const elapsed = Math.max(0, Math.min(track.duration, Number.isNaN(elapsedSeconds) ? 0 : elapsedSeconds));
  if (elapsed >= track.restTime) return { ...restingPose, finished: elapsed >= track.duration };
  const index = Math.min(track.frames.length - 2, Math.floor(elapsed / FRAME));
  const left = track.frames[index];
  const right = track.frames[index + 1];
  const fraction = Math.max(0, Math.min(1, (elapsed - left.time) / (right.time - left.time)));
  const mix = (a: number, b: number) => a + (b - a) * fraction;
  return {
    x: mix(left.x, right.x),
    y: mix(left.y, right.y),
    z: Math.max(0, mix(left.z, right.z)),
    rotation: matrix(
      normalize([
        mix(left.q[0], right.q[0]),
        mix(left.q[1], right.q[1]),
        mix(left.q[2], right.q[2]),
        mix(left.q[3], right.q[3]),
      ]),
    ),
    grounded: left.grounded && right.grounded,
    settle: Math.max(0, Math.min(1, (elapsed - (track.restTime - SETTLE)) / SETTLE)),
    finished: false,
  };
}
