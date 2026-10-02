import { describe, expect, it } from 'vitest';
import { makeDieMotion, sampleDieMotion } from '../src/client/dice/motion.js';

describe('physical dice motion', () => {
  it('repeats a seeded toss exactly and gives other seeds distinct trajectories', () => {
    expect(makeDieMotion(813)).toEqual(makeDieMotion(813));
    expect(makeDieMotion(813)).not.toEqual(makeDieMotion(814));
    expect(makeDieMotion(813, true)).not.toEqual(makeDieMotion(813));
  });

  it('loses bounce energy at each contact, stays above the floor and settles before completion', () => {
    for (const coin of [false, true]) {
      for (const seed of [0, 1, 12, 813, 98451, 0xffffffff]) {
        const track = makeDieMotion(seed, coin);
        expect(track.contacts.length).toBeGreaterThanOrEqual(3);
        expect(track.contacts.at(-1)!.reboundHeight).toBe(0);
        for (let i = 1; i < track.contacts.length; i++) {
          expect(track.contacts[i].time).toBeGreaterThan(track.contacts[i - 1].time);
          expect(track.contacts[i].reboundHeight).toBeLessThan(track.contacts[i - 1].reboundHeight);
        }
        expect(track.restTime).toBeLessThan(track.duration);
        expect(track.restTime).toBeLessThan(1.8);
        for (const frame of track.frames) {
          expect(frame.z).toBeGreaterThanOrEqual(0);
          expect(frame.z).toBeLessThanOrEqual(2.3);
          expect(Math.hypot(frame.x, frame.y)).toBeLessThanOrEqual(1.600001);
        }
      }
    }
  });

  it('keeps airborne horizontal velocity constant and applies friction while grounded', () => {
    const track = makeDieMotion(813);
    const delta = 1 / 120;
    const airborne = [0.1, 0.2, 0.3].map((time) => {
      const first = sampleDieMotion(track, time);
      const second = sampleDieMotion(track, time + delta);
      expect(first.grounded).toBe(false);
      return Math.hypot(second.x - first.x, second.y - first.y) / delta;
    });
    expect(airborne[0]).toBeCloseTo(airborne[1], 9);
    expect(airborne[1]).toBeCloseTo(airborne[2], 9);
    const grounded = track.frames.filter((pose) => pose.grounded && pose.time < track.restTime);
    expect(grounded.length).toBeGreaterThan(2);
    const speeds = grounded.slice(1).map((pose, index) => {
      const earlier = grounded[index];
      return Math.hypot(pose.x - earlier.x, pose.y - earlier.y) / (pose.time - earlier.time);
    });
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-10);
  });

  it('damps angular travel through impacts and reaches exact rest without a destination glide', () => {
    const track = makeDieMotion(813);
    expect(sampleDieMotion(track, 0).rotation).toBe(1);
    const impact = track.contacts[0].time;
    const beforeImpact =
      (sampleDieMotion(track, impact - 0.03).rotation - sampleDieMotion(track, impact - 0.02).rotation) /
      0.01;
    const afterImpact =
      (sampleDieMotion(track, impact + 0.02).rotation - sampleDieMotion(track, impact + 0.03).rotation) /
      0.01;
    expect(afterImpact / beforeImpact).toBeCloseTo(0.58, 8);
    for (let i = 1; i < track.frames.length; i++) {
      expect(track.frames[i].rotation).toBeLessThanOrEqual(track.frames[i - 1].rotation);
    }
    const before = sampleDieMotion(track, track.restTime - 0.01);
    expect(before.z).toBe(0);
    expect(before.rotation).toBeLessThan(0.001);
    const rest = { x: 0, y: 0, z: 0, rotation: 0, grounded: true, finished: false };
    expect(sampleDieMotion(track, track.restTime)).toEqual(rest);
    expect(sampleDieMotion(track, (track.restTime + track.duration) / 2)).toEqual(rest);
    expect(sampleDieMotion(track, track.duration)).toEqual({ ...rest, finished: true });
    expect(sampleDieMotion(track, 1000)).toEqual({ ...rest, finished: true });
    const restingFrames = track.frames.filter((frame) => frame.time >= track.restTime);
    expect(
      restingFrames.every((frame) => frame.x === 0 && frame.y === 0 && frame.z === 0 && frame.rotation === 0),
    ).toBe(true);
  });

  it('bounds tosses and settles a broad seed sample within the physical rest window', () => {
    for (let seed = 0; seed < 64; seed++) {
      const track = makeDieMotion(Math.imul(seed, 2654435761));
      expect(track.restTime).toBeGreaterThan(1.35);
      expect(track.restTime).toBeLessThan(1.8);
      expect(track.frames.at(-1)).toMatchObject({ x: 0, y: 0, z: 0, rotation: 0, grounded: true });
    }
  });

  it('interpolates the same poses at common times regardless of rendering cadence', () => {
    const track = makeDieMotion(913);
    const at30Hz = Array.from({ length: 64 }, (_, index) => sampleDieMotion(track, index / 30));
    const at120Hz = Array.from({ length: 253 }, (_, index) => sampleDieMotion(track, index / 120));
    for (let i = 0; i < at30Hz.length; i++) expect(at30Hz[i]).toEqual(at120Hz[i * 4]);
    const left = track.frames[25];
    const right = track.frames[26];
    const middle = sampleDieMotion(track, (left.time + right.time) / 2);
    expect(middle.x).toBeCloseTo((left.x + right.x) / 2, 12);
    expect(middle.y).toBeCloseTo((left.y + right.y) / 2, 12);
    expect(middle.z).toBeCloseTo((left.z + right.z) / 2, 12);
    expect(sampleDieMotion(track, -1)).toEqual(sampleDieMotion(track, 0));
    expect(sampleDieMotion(track, Number.POSITIVE_INFINITY)).toEqual(sampleDieMotion(track, track.duration));
  });
});
