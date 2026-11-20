import { describe, expect, it } from 'vitest';
import { createGame, defaultSetup, reduceGame, twoHeadedGiantSetup } from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import { gameSchema, type Command, type Game } from '../src/shared/schema.js';
import { dungeons } from '../src/shared/dungeons.js';
import { lifeHistory, turnShares } from '../src/client/features/gameInsights.js';
import { createRecap } from '../src/client/features/gameRecap.js';
import { shuffleSeating } from '../src/client/features/seating.js';
import { mergeStats, statRecord, MAX_STAT_RECORDS } from '../src/client/features/stats.js';
import { loadPool } from '../src/client/features/TurnTools.js';

const actorId = newId();
const action = (g: Game, c: Command, now = 2000) =>
  reduceGame(g, c, {
    id: newId(),
    operationId: newId(),
    actorId,
    actor: 'Alex',
    now,
    newGameId: c.type === 'rematch' ? newId() : undefined,
  });
const start = (count = 4) => createGame(defaultSetup(count), newId, 1000);

describe('dungeons', () => {
  it('ships connected dungeons that always reach their final room', () => {
    expect(dungeons.map((d) => d.name)).toEqual([
      'Lost Mine of Phandelver',
      'Dungeon of the Mad Mage',
      'Tomb of Annihilation',
      'Undercity',
    ]);
    for (const d of dungeons) {
      const last = d.rooms.length - 1;
      const reached = new Set([0]);
      d.rooms.forEach((room, index) => {
        expect(room.name && room.text).toBeTruthy();
        // Every path leads deeper, so no route can loop or stall before the end.
        expect(room.next.every((next) => next > index && next <= last)).toBe(true);
        expect(room.next.length > 0).toBe(index !== last);
        if (reached.has(index)) room.next.forEach((next) => reached.add(next));
      });
      expect(reached.size).toBe(d.rooms.length);
    }
  });
  it('ventures room by room, completes, and clears on a rematch', () => {
    const game = start();
    const [a, b] = game.order;
    expect(() => action(game, { type: 'venture', playerId: a })).toThrow('Choose a dungeon');
    let g = action(game, { type: 'venture', playerId: a, dungeon: 'lost-mine-of-phandelver' });
    expect(g.players[a].dungeon).toEqual({ id: 'lost-mine-of-phandelver', room: 0 });
    // The entrance forks, so the player has to choose.
    expect(() => action(g, { type: 'venture', playerId: a })).toThrow('Choose the next room');
    expect(() => action(g, { type: 'venture', playerId: a, room: 6 })).toThrow('Choose the next room');
    g = action(g, { type: 'venture', playerId: a, room: 1 });
    // A dungeon named part-way through is ignored: the marker keeps going.
    g = action(g, { type: 'venture', playerId: a, room: 3, dungeon: 'undercity' });
    expect(g.players[a].dungeon).toEqual({ id: 'lost-mine-of-phandelver', room: 3 });
    expect(action(g, { type: 'undo' }).players[a].dungeon!.room).toBe(1);
    // One exit needs no choice.
    g = action(g, { type: 'venture', playerId: a });
    expect(g.players[a].dungeon!.room).toBe(6);
    expect(g.players[b].dungeon).toBeUndefined();
    const done = action(g, { type: 'venture', playerId: a });
    expect(done.players[a].dungeon).toBeUndefined();
    expect(done.players[a].dungeonsCompleted).toBe(1);
    expect(done.history.at(-1)!.summary).toContain('completed Lost Mine of Phandelver');
    // Venturing again from the last room completes it and enters the next dungeon in one step.
    const next = action(g, { type: 'venture', playerId: a, dungeon: 'undercity' });
    expect(next.players[a]).toMatchObject({ dungeon: { id: 'undercity', room: 0 }, dungeonsCompleted: 1 });
    expect(gameSchema.safeParse(next).success).toBe(true);
    const left = action(next, { type: 'leaveDungeon', playerId: a });
    expect(left.players[a].dungeon).toBeUndefined();
    expect(left.players[a].dungeonsCompleted).toBe(1);
    expect(() => action(left, { type: 'leaveDungeon', playerId: a })).toThrow();
    const rematch = action(next, { type: 'rematch' });
    expect(rematch.players[a].dungeon).toBeUndefined();
    expect(rematch.players[a].dungeonsCompleted).toBeUndefined();
  });
});

describe('time on turns', () => {
  it('banks each turn for its holder, leaves out pauses, and never counts a turn twice', () => {
    const game = start();
    const [a, b] = game.order;
    let g = action(game, { type: 'turnTracking', enabled: true }, 1000);
    g = action(g, { type: 'turn', playerId: a, advance: false }, 10_000);
    expect(turnShares(g, 10_500)).toEqual([]);
    g = action(g, { type: 'turn', playerId: b, advance: true }, 70_000);
    expect(g.turnTime).toEqual({ [a]: 60_000 });
    g = action(g, { type: 'timer', action: 'pause' }, 80_000);
    g = action(g, { type: 'timer', action: 'resume' }, 500_000);
    g = action(g, { type: 'turn', playerId: a, advance: true }, 520_000);
    expect(g.turnTime).toEqual({ [a]: 60_000, [b]: 30_000 });
    // The running turn is included while the game is live.
    expect(turnShares(g, 525_000).map((share) => share.ms)).toEqual([65_000, 30_000, 0, 0]);
    const ended = action(g, { type: 'end' }, 530_000);
    expect(ended.turnTime).toEqual({ [a]: 70_000, [b]: 30_000 });
    expect(turnShares(ended, 900_000).map((share) => share.ms)).toEqual([70_000, 30_000, 0, 0]);
    const recap = createRecap(ended, 900_000);
    expect(recap.turns!.slice(0, 2).map((share) => share.time)).toEqual(['1m 10s', '30s']);
    // Reopening and ending again adds only the time played since.
    let again = action(ended, { type: 'reopen' }, 600_000);
    if (again.timer.pausedAt !== null) again = action(again, { type: 'timer', action: 'resume' }, 600_000);
    again = action(again, { type: 'end' }, 605_000);
    expect(again.turnTime).toEqual({ [a]: 75_000, [b]: 30_000 });
    expect(gameSchema.safeParse(again).success).toBe(true);
    expect(action(again, { type: 'rematch' }, 700_000).turnTime).toBeUndefined();
    expect(createRecap(start(), 5000).turns).toBeUndefined();
  });
  it('counts nothing while turn tracking is off', () => {
    // Archenemy gives the archenemy the first turn even when turns are not tracked.
    const setup = defaultSetup(3);
    setup.settings.preset = 'Archenemy';
    setup.seats[0].archenemy = true;
    const game = createGame(setup, newId, 1000);
    expect(game.turn.playerId).toBe(game.order[0]);
    expect(createRecap(action(game, { type: 'end' }, 900_000), 900_000).turns).toBeUndefined();
    expect(turnShares(game, 900_000)).toEqual([]);
    // Switching tracking off closes the interval; switching it on starts a fresh one.
    let g = action(game, { type: 'turnTracking', enabled: true }, 100_000);
    g = action(g, { type: 'turnTracking', enabled: false }, 130_000);
    expect(g.turnTime).toEqual({ [game.order[0]]: 30_000 });
    expect(turnShares(g, 500_000).map((share) => share.ms)).toEqual([30_000, 0]);
    g = action(g, { type: 'turnTracking', enabled: true }, 600_000);
    expect(action(g, { type: 'end' }, 610_000).turnTime).toEqual({ [game.order[0]]: 40_000 });
  });
  it('adds a shared turn to the side that took it', () => {
    const game = createGame(twoHeadedGiantSetup(), newId, 1000);
    const [a, , c] = game.order;
    let g = action(game, { type: 'turnTracking', enabled: true }, 1000);
    g = action(g, { type: 'turn', playerId: a, advance: false }, 1000);
    g = action(g, { type: 'turn', playerId: c, advance: true }, 41_000);
    const shares = turnShares(g, 51_000);
    expect(shares.map((share) => share.ms)).toEqual([40_000, 10_000]);
    expect(shares[0].name).toContain('Team A');
  });
});

describe('life history', () => {
  it('lists one seat’s changes newest first', () => {
    const game = start();
    const [a, b] = game.order;
    let g = action(game, { type: 'adjust', playerId: a, field: 'life', delta: -3 }, 61_000);
    g = action(g, { type: 'adjust', playerId: b, field: 'life', delta: -9 }, 70_000);
    g = action(g, { type: 'adjust', playerId: a, field: 'life', delta: 5 }, 131_000);
    expect(lifeHistory(g, a)).toEqual([
      { at: 130_000, delta: 5, life: 42 },
      { at: 60_000, delta: -3, life: 37 },
    ]);
    expect(lifeHistory(g, b)).toEqual([{ at: 69_000, delta: -9, life: 31 }]);
    expect(lifeHistory(g, g.order[2])).toEqual([]);
    expect(lifeHistory(g, 'nobody')).toEqual([]);
  });
});

describe('setup and stats helpers', () => {
  it('shuffles the people and leaves the archenemy and team chairs in place', () => {
    const seats = twoHeadedGiantSetup().seats.map((seat, index) => ({ ...seat, name: `P${index + 1}` }));
    // Always picking the first candidate rotates everyone one chair.
    const moved = shuffleSeating(seats, () => 0);
    expect(moved.map((seat) => seat.name)).toEqual(['P2', 'P3', 'P4', 'P1']);
    expect(moved.map((seat) => seat.team)).toEqual(seats.map((seat) => seat.team));
    expect(moved.map((seat) => seat.color).sort()).toEqual(seats.map((seat) => seat.color).sort());
    const villain = defaultSetup(3).seats.map((seat, index) => ({ ...seat, archenemy: index === 0 }));
    expect(shuffleSeating(villain, () => 0).map((seat) => seat.archenemy)).toEqual([true, false, false]);
  });
  it('merges exported stats without duplicating or accepting bad records', () => {
    const record = (endedAt: number) => {
      const game = action(start(), { type: 'end' }, endedAt);
      return statRecord(game, 'local', endedAt);
    };
    const mine = [record(5000), record(4000)];
    const theirs = [record(6000), mine[1], { id: 'nope' }, 'junk'];
    const merged = mergeStats(mine, theirs);
    expect(merged.added).toBe(1);
    expect(merged.records.map((entry) => entry.endedAt)).toEqual([6000, 5000, 4000]);
    expect(mergeStats(mine, { not: 'a list' })).toEqual({ records: mine, added: 0 });
    const many = Array.from({ length: MAX_STAT_RECORDS + 5 }, (_, index) => record(10_000 + index));
    expect(mergeStats(mine, many).records).toHaveLength(MAX_STAT_RECORDS);
  });
  it('keeps the turn scratchpad for its own turn only', () => {
    const stored = JSON.stringify({ turn: 'g:3:p', storm: 4, mana: { R: 2, X: 9, G: -1 } });
    expect(loadPool('g:3:p', stored)).toMatchObject({ storm: 4, mana: { R: 2, G: 0, W: 0 } });
    expect(loadPool('g:4:q', stored)).toEqual({ turn: 'g:4:q', storm: 0, mana: {} });
    expect(loadPool('g:3:p', '{broken')).toEqual({ turn: 'g:3:p', storm: 0, mana: {} });
  });
});
