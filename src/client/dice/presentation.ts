import type { Game, Roll } from '../../shared/schema.js';
import type { VisualDie } from './DiceCanvas.js';

/** Associate each rendered die with its seat without changing any recorded result. */
export function visualDice(roll: Roll, game: Game, round: number): VisualDie[] {
  if (roll.kind === 'd20-each')
    return (roll.rounds[round] ?? roll.candidates.map((playerId) => ({ playerId, value: 0 }))).map((r) => ({
      value: r.value,
      symbol: !roll.rounds.length,
      sides: 20,
      name: game.players[r.playerId]?.name,
      color: game.players[r.playerId]?.color ?? 'ivory',
    }));
  // A random pick must not disclose its winner through the die's color.
  if (roll.kind === 'first' || roll.kind === 'opponent')
    return [{ value: 1, sides: 20, symbol: true, color: 'ivory' }];
  const player = roll.playerId ? game.players[roll.playerId] : undefined;
  const color = player?.color ?? 'ivory';
  return roll.values.flatMap((value, i) =>
    roll.sides === 100
      ? [
          {
            value: Math.floor((value % 100) / 10) * 10,
            sides: 10,
            color,
            name: `${i + 1} · tens`,
            percent: true,
          },
          { value: value % 10, sides: 10, color, name: `${i + 1} · ones` },
        ]
      : [{ value, sides: roll.kind === 'coin' ? 2 : roll.sides, color }],
  );
}
