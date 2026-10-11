import { describe, expect, it } from 'vitest';
import { TrafficBudget } from '../src/server/traffic.js';

describe('shared command budgets', () => {
  it('shares an allowance across tabs and retries, refills it, and leaves other sessions usable', () => {
    const budget = new TrafficBudget(3, 2);
    expect([
      budget.allow('same-guest', 1000),
      budget.allow('same-guest', 1000),
      budget.allow('same-guest', 1000),
    ]).toEqual([true, true, true]);
    expect(budget.allow('same-guest', 1000)).toBe(false);
    expect(budget.allow('other-guest', 1000)).toBe(true);
    expect(budget.allow('same-guest', 1500)).toBe(true);
    expect(budget.allow('same-guest', 1500)).toBe(false);
    expect(budget.allow('same-guest', 1200)).toBe(false);
  });
  it('bounds distinct identities and admits new ones once inactive entries expire', () => {
    const budget = new TrafficBudget(2, 1, 2);
    expect(budget.allow('one', 1000)).toBe(true);
    expect(budget.allow('two', 1000)).toBe(true);
    expect(budget.allow('three', 1000)).toBe(false);
    expect(budget.allow('three', 301001)).toBe(true);
  });
});
