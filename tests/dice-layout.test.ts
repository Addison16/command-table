import { describe, expect, it } from 'vitest';
import { dieAnchor, diceColumns } from '../src/client/dice/layout.js';

describe('dice layout', () => {
  it('settles each table size into its squarest grid', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => diceColumns(n, 390, 500))).toEqual([
      1, 2, 2, 2, 3, 3, 3, 3, 3, 4,
    ]);
    // A four-player table is 2×2 in both orientations.
    expect(diceColumns(4, 900, 290)).toBe(2);
  });

  it('gathers dice at the center before gliding exactly to their cells', () => {
    const center: [number, number] = [200, 300];
    const target: [number, number] = [100, 200];
    const start = dieAnchor(center, target, 0, 2);
    expect(Math.hypot(start[0] - center[0], start[1] - center[1])).toBeLessThan(
      Math.hypot(target[0] - center[0], target[1] - center[1]) / 2,
    );
    expect(dieAnchor(center, target, 0.5, 2)).toEqual(start);
    expect(dieAnchor(center, target, 2, 2)).toEqual(target);
  });
});
