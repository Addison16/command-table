import { describe, expect, it } from 'vitest';
import { archenemySetup, createGame, defaultSetup, reduceGame } from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import type { Command, Game } from '../src/shared/schema.js';
import { gameMoments, stillWinner } from '../src/client/features/gameMoments.js';

const apply = (game: Game, command: Command) =>
  reduceGame(game, command, {
    id: newId(),
    operationId: newId(),
    now: Date.now(),
    actorId: 'tester',
    actor: 'Tester',
    newGameId: newId(),
  });
const eliminate = (game: Game, seat: number, eliminated = true) =>
  apply(game, { type: 'eliminate', playerId: game.order[seat], eliminated });

describe('elimination and victory moments', () => {
  it('notices each elimination and only the one that leaves a single player', () => {
    const start = createGame(defaultSetup(3), newId, Date.now());
    const first = eliminate(start, 0);
    expect(gameMoments(start, first)).toEqual({ fallen: [start.order[0]], winner: null });
    const second = eliminate(first, 1);
    expect(gameMoments(first, second)).toEqual({ fallen: [start.order[1]], winner: start.order[2] });
    // A snapshot that skipped the middle revision still reports both.
    expect(gameMoments(start, second)).toEqual({
      fallen: [start.order[0], start.order[1]],
      winner: start.order[2],
    });
  });

  it('stays quiet for other changes, a first snapshot, another match and a solo table', () => {
    const start = createGame(defaultSetup(2), newId, Date.now());
    const decided = eliminate(start, 0);
    const quiet = { fallen: [], winner: null };
    expect(gameMoments(undefined, decided)).toEqual(quiet);
    expect(
      gameMoments(
        decided,
        apply(decided, { type: 'adjust', playerId: start.order[1], field: 'life', delta: -1 }),
      ),
    ).toEqual(quiet);
    expect(gameMoments(decided, eliminate(decided, 0, false))).toEqual(quiet);
    expect(gameMoments(decided, apply(decided, { type: 'rematch' }))).toEqual(quiet);
    const solo = createGame(defaultSetup(1), newId, Date.now());
    expect(gameMoments(solo, eliminate(solo, 0))).toEqual({ fallen: [solo.order[0]], winner: null });
  });

  it('keeps a winner only while that player is the last one standing in the same active match', () => {
    const start = createGame(defaultSetup(2), newId, Date.now());
    const decided = eliminate(start, 0);
    const winner = { gameId: start.id, playerId: start.order[1] };
    expect(stillWinner(decided, winner)).toBe(true);
    expect(stillWinner(apply(decided, { type: 'undo' }), winner)).toBe(false);
    expect(stillWinner(apply(decided, { type: 'end' }), winner)).toBe(false);
    expect(stillWinner(apply(decided, { type: 'rematch' }), winner)).toBe(false);
    expect(stillWinner(decided, undefined)).toBe(false);
    expect(stillWinner(undefined, winner)).toBe(false);
  });

  it('preserves Archenemy team victories without declaring an individual teammate the winner', () => {
    const start = createGame(archenemySetup(3), newId, Date.now());
    const teamWins = eliminate(start, 0);
    expect(gameMoments(start, teamWins)).toEqual({ fallen: [start.order[0]], winner: null });
    const oneTeammate = eliminate(teamWins, 1);
    expect(gameMoments(teamWins, oneTeammate)).toEqual({ fallen: [start.order[1]], winner: null });
    expect(stillWinner(oneTeammate, { gameId: start.id, playerId: start.order[2] })).toBe(false);

    const oneOpponent = eliminate(start, 1);
    const archenemyWins = eliminate(oneOpponent, 2);
    expect(gameMoments(oneOpponent, archenemyWins)).toEqual({
      fallen: [start.order[2]],
      winner: start.order[0],
    });
    expect(stillWinner(archenemyWins, { gameId: start.id, playerId: start.order[0] })).toBe(true);
  });
});
