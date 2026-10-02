/** Horizontal offsets and elevation are measured in die radii. */
export type DieMotionPose = {
  x: number;
  y: number;
  z: number;
  /** Remaining angular travel, normalized from 1 at release to 0 at rest. */
  rotation: number;
  grounded: boolean;
  finished: boolean;
};

export type DieMotionContact = {
  time: number;
  /** Height of the following rebound; zero means the die stays on the floor. */
  reboundHeight: number;
};

type DieMotionFrame = Omit<DieMotionPose, 'finished'> & { time: number };
export type DieMotionTrack = {
  duration: number;
  restTime: number;
  frames: readonly DieMotionFrame[];
  contacts: readonly DieMotionContact[];
};

const STEP = 1 / 120;
const DURATION = 2.1;
const GRAVITY = 19;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Precompute a toss with ballistic flight, inelastic impacts and floor friction.
 * The complete path is translated once to its final horizontal position. Its
 * screen-space destination therefore never attracts a die while it is moving.
 */
export function makeDieMotion(seed: number, coin = false): DieMotionTrack {
  const random = seededRandom(seed);
  const direction = random() * Math.PI * 2;
  const speed = 2 + random() * 0.7;
  const distance = 1.05 + random() * 0.55;
  let x = 0;
  let y = 0;
  let z = (coin ? 1.35 : 1.5) + random() * (coin ? 0.45 : 0.65);
  let vx = Math.cos(direction) * speed;
  let vy = Math.sin(direction) * speed;
  let vz = 0.6 + random() * 0.7;
  let angularSpeed = (coin ? 18 : 12) + random() * 4;
  let angle = 0;
  let restitution = (coin ? 0.44 : 0.57) + random() * 0.035;
  const floorFriction = coin ? 1.3 : 1.6;
  const angularFriction = coin ? 7.5 : 9;
  const impactFriction = coin ? 0.58 : 0.62;
  const angularRetention = coin ? 0.59 : 0.58;
  let grounded = false;
  let restTime = DURATION;
  const contacts: DieMotionContact[] = [];
  const physical: { time: number; x: number; y: number; z: number; angle: number; grounded: boolean }[] = [
    { time: 0, x, y, z, angle, grounded },
  ];

  for (let frame = 1; frame <= Math.round(DURATION / STEP); frame++) {
    let remaining = STEP;
    let elapsed = (frame - 1) * STEP;
    while (remaining > 1e-10) {
      if (grounded) {
        // Coulomb friction slows only a contacting die. Integrate to its actual
        // stopping time so the final movement never reverses or overshoots.
        const horizontalSpeed = Math.hypot(vx, vy);
        const movingTime = Math.min(remaining, horizontalSpeed / floorFriction);
        const travel = horizontalSpeed * movingTime - (floorFriction * movingTime * movingTime) / 2;
        if (horizontalSpeed > 0) {
          x += (vx / horizontalSpeed) * travel;
          y += (vy / horizontalSpeed) * travel;
          const nextSpeed = Math.max(0, horizontalSpeed - floorFriction * remaining);
          vx *= nextSpeed / horizontalSpeed;
          vy *= nextSpeed / horizontalSpeed;
        }
        const turningTime = Math.min(remaining, angularSpeed / angularFriction);
        angle += angularSpeed * turningTime - (angularFriction * turningTime * turningTime) / 2;
        angularSpeed = Math.max(0, angularSpeed - angularFriction * remaining);
        remaining = 0;
      } else {
        // Solve the floor intersection within this step. No stored pose goes
        // beneath the table and an impact does not discard elapsed flight time.
        const untilContact = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * z)) / GRAVITY;
        const flight = Math.min(remaining, untilContact);
        x += vx * flight;
        y += vy * flight;
        z = Math.max(0, z + vz * flight - (GRAVITY * flight * flight) / 2);
        vz -= GRAVITY * flight;
        angle += angularSpeed * flight;
        elapsed += flight;
        remaining -= flight;
        if (untilContact <= flight + 1e-10) {
          z = 0;
          vz = Math.abs(vz) * restitution;
          restitution *= coin ? 0.64 : 0.69;
          vx *= impactFriction;
          vy *= impactFriction;
          angularSpeed *= angularRetention;
          let reboundHeight = (vz * vz) / (2 * GRAVITY);
          if (reboundHeight < 0.012) {
            reboundHeight = 0;
            vz = 0;
            grounded = true;
          }
          contacts.push({ time: elapsed, reboundHeight });
        }
      }
    }
    const time = frame * STEP;
    if (grounded && vx === 0 && vy === 0 && angularSpeed === 0 && restTime === DURATION) {
      restTime = time;
    }
    physical.push({ time, x, y, z, angle, grounded });
  }

  const end = physical[physical.length - 1];
  // A constant scale keeps tosses inside their cells. This also scales all
  // horizontal velocities and friction uniformly, preserving the motion.
  const horizontalScale = distance / Math.hypot(end.x, end.y);
  const frames = physical.map((pose): DieMotionFrame => ({
    time: pose.time,
    x: (pose.x - end.x) * horizontalScale,
    y: (pose.y - end.y) * horizontalScale,
    z: pose.z,
    rotation: Math.max(0, Math.min(1, (end.angle - pose.angle) / end.angle)),
    grounded: pose.grounded,
  }));
  return { duration: DURATION, restTime, frames, contacts };
}

/** Sample by elapsed time; results are independent of rendering frame rate. */
export function sampleDieMotion(track: DieMotionTrack, elapsedSeconds: number): DieMotionPose {
  const elapsed = Math.max(0, Math.min(track.duration, Number.isNaN(elapsedSeconds) ? 0 : elapsedSeconds));
  if (elapsed >= track.restTime) {
    return { x: 0, y: 0, z: 0, rotation: 0, grounded: true, finished: elapsed >= track.duration };
  }
  const index = Math.min(track.frames.length - 2, Math.floor(elapsed / STEP));
  const left = track.frames[index];
  const right = track.frames[index + 1];
  const fraction = (elapsed - left.time) / (right.time - left.time);
  const mix = (a: number, b: number) => a + (b - a) * fraction;
  const z = Math.max(0, mix(left.z, right.z));
  return {
    x: mix(left.x, right.x),
    y: mix(left.y, right.y),
    z,
    rotation: Math.max(0, Math.min(1, mix(left.rotation, right.rotation))),
    grounded: left.grounded && right.grounded,
    finished: false,
  };
}
