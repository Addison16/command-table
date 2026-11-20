import type { Setup } from '../../shared/schema.js';
import { randomInt } from '../../shared/random.js';

type Seat = Setup['seats'][number];
/**
 * Deal the players into a random seating order. The archenemy's chair and the
 * team chairs stay where they are; the people move.
 */
export function shuffleSeating(seats: Seat[], pick: (max: number) => number = randomInt): Seat[] {
  const order = seats.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return seats.map((chair, index) => {
    const { archenemy: _archenemy, team: _team, ...person } = seats[order[index]];
    return {
      ...person,
      ...(chair.archenemy !== undefined ? { archenemy: chair.archenemy } : {}),
      ...(chair.team !== undefined ? { team: chair.team } : {}),
    };
  });
}
