import { describe, expect, it } from 'vitest';
import {
  createGame,
  defaultSetup,
  GIANT_LIFE,
  makePlanarDeck,
  makeRoll,
  reduceGame,
  standingWinners,
  turnOrder,
  twoHeadedGiantSetup,
} from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import { gameSchema, MAX_LIFE_LOG, setupSchema, type Command, type Game } from '../src/shared/schema.js';
import { planarFaces, planes, shufflePlanarDeck } from '../src/shared/planes.js';
import { planeCards } from '../src/shared/planeCards.js';
import { gameMoments, stillWinner } from '../src/client/features/gameMoments.js';
import { createRecap, recordedResult } from '../src/client/features/gameRecap.js';
import { statChange, statRecord, summarize, wasPlayed, winRate } from '../src/client/features/stats.js';
import { scannedCode } from '../src/client/features/QrScanner.js';
import { playerStatuses } from '../src/client/features/playerStatuses.js';

const actorId = newId();
function action(g: Game, c: Command, extra: { now?: number; planarRoll?: number } = {}) {
  return reduceGame(g, c, {
    id: newId(),
    operationId: newId(),
    actorId,
    actor: 'Alex',
    now: extra.now ?? 2000,
    newGameId: c.type === 'rematch' ? newId() : undefined,
    planarDeck: makePlanarDeck(g, c, () => 0),
    planarRoll: extra.planarRoll,
  });
}
const life = (g: Game) => g.order.map((id) => g.players[id].life);

describe('Two-Headed Giant', () => {
  const start = () => createGame(twoHeadedGiantSetup(), newId, 1000);
  it('pairs seats into teams that share one life total, poison total and turn', () => {
    const game = start();
    expect(gameSchema.parse(game).teams).toEqual([game.order.slice(0, 2), game.order.slice(2)]);
    expect(life(game)).toEqual([GIANT_LIFE, GIANT_LIFE, GIANT_LIFE, GIANT_LIFE]);
    const [a, b, c] = game.order;
    const hit = action(game, { type: 'adjust', playerId: b, field: 'life', delta: -7 });
    expect(life(hit)).toEqual([23, 23, 30, 30]);
    const poisoned = action(hit, { type: 'set', playerId: c, field: 'poison', value: 4 });
    expect(poisoned.order.map((id) => poisoned.players[id].poison)).toEqual([0, 0, 4, 4]);
    expect(turnOrder(poisoned)).toEqual([a, c]);
    // One undo restores both heads.
    expect(life(action(hit, { type: 'undo' }))).toEqual([30, 30, 30, 30]);
  });
  it('treats teammates as one side for group effects, opponents and elimination', () => {
    const game = start();
    const [a, b, c, d] = game.order;
    expect(() => action(game, { type: 'groupLife', casterId: a, targetIds: [b], loss: 2 })).toThrow(
      /teammates/i,
    );
    const drained = action(game, { type: 'groupLife', casterId: a, targetIds: [c, d], loss: 2, gain: 1 });
    expect(life(drained)).toEqual([31, 31, 26, 26]);
    const roll = makeRoll(
      game,
      { type: 'roll', kind: 'opponent', sides: 20, count: 1, playerId: a },
      { id: newId(), now: 1, actor: 'Alex' },
      () => 1,
    );
    expect(roll.candidates).toEqual([c, d]);
    expect(roll.winner).toBe(d);
    const out = action(game, { type: 'eliminate', playerId: c, eliminated: true });
    expect(out.players[d].eliminated).toBe(true);
    expect(standingWinners(out)).toEqual([a, b]);
    expect(gameMoments(game, out)).toEqual({ fallen: [c, d], winner: a });
    expect(stillWinner(out, { gameId: out.id, playerId: a })).toBe(true);
    expect(stillWinner(action(out, { type: 'undo' }), { gameId: out.id, playerId: a })).toBe(false);
  });
  it('accepts only complete teams of two', () => {
    const setup = twoHeadedGiantSetup(6);
    expect(setupSchema.safeParse(setup).success).toBe(true);
    setup.seats[5] = { ...setup.seats[5], team: 1 };
    expect(setupSchema.safeParse(setup).success).toBe(false);
    expect(twoHeadedGiantSetup(5).seats).toHaveLength(4);
  });
});

describe('recorded results and stats', () => {
  const start = () => createGame(defaultSetup(3), newId, 1000);
  it('records, changes and clears a winner, including after the game has ended', () => {
    const game = start();
    const [a, b] = game.order;
    const won = action(game, { type: 'declareWinner', winners: [b] });
    expect(won.result).toEqual({ winners: [b] });
    expect(action(won, { type: 'undo' }).result).toBeUndefined();
    const ended = action(won, { type: 'end' });
    const changed = action(ended, { type: 'declareWinner', winners: [a] });
    expect(changed.result).toEqual({ winners: [a] });
    expect(action(changed, { type: 'declareWinner', winners: [], draw: true }).result).toEqual({
      winners: [],
      draw: true,
    });
    expect(action(changed, { type: 'declareWinner', winners: [] }).result).toBeUndefined();
    expect(() => action(game, { type: 'declareWinner', winners: [newId()] })).toThrow();
    expect(action(won, { type: 'rematch' }).result).toBeUndefined();
  });
  it('counts a game when it ends, on a rematch, and again when its result is corrected', () => {
    const game = start();
    const [a, b, c] = game.order;
    expect(wasPlayed(game)).toBe(false);
    const played = action(game, { type: 'adjust', playerId: a, field: 'life', delta: -40 });
    expect(statChange(game, played)).toEqual({});
    const ended = action(action(played, { type: 'declareWinner', winners: [c] }), { type: 'end' });
    expect(statChange(played, ended).record).toBe(ended);
    const corrected = action(ended, { type: 'declareWinner', winners: [b] });
    expect(statChange(ended, corrected).record).toBe(corrected);
    expect(statChange(ended, action(ended, { type: 'reopen' }))).toEqual({ remove: ended.id });
    const rematch = action(played, { type: 'rematch' });
    expect(statChange(played, rematch).record).toBe(played);
    // An untouched table that is simply closed is not a game.
    expect(statChange(game, action(game, { type: 'end' }))).toEqual({});
  });
  it('summarizes wins by player name and commander', () => {
    const build = (winner: number, names: string[]) => {
      let game = createGame(defaultSetup(3), newId, 1000);
      names.forEach((name, index) => {
        const id = game.order[index];
        const commander = Object.values(game.commanders).find((entry) => entry.ownerId === id)!;
        game = action(game, {
          type: 'editPlayer',
          playerId: id,
          name,
          color: game.players[id].color,
          commanders: [{ id: commander.id, label: index === 0 ? 'Atraxa' : commander.label }],
        });
      });
      game = action(game, { type: 'declareWinner', winners: [game.order[winner]] });
      return statRecord(action(game, { type: 'end' }), 'local', 5000);
    };
    const records = [
      build(0, ['Mira', 'Sol', 'Ren']),
      build(1, ['mira ', 'Sol', 'Ren']),
      build(0, ['Mira', 'Sol', 'Kai']),
    ];
    const summary = summarize(records);
    expect(summary.games).toBe(3);
    expect(summary.decided).toBe(3);
    expect(summary.players[0]).toEqual({ name: 'Mira', games: 3, wins: 2 });
    expect(winRate(summary.players[0])).toBe('67%');
    expect(summary.players.find((row) => row.name === 'Sol')).toEqual({ name: 'Sol', games: 3, wins: 1 });
    // Placeholder commander labels are not counted as commanders.
    expect(summary.commanders).toEqual([{ name: 'Atraxa', games: 3, wins: 2 }]);
  });
  it('carries a recorded winner and the life history into the recap', () => {
    const game = start();
    const [a, b] = game.order;
    let played = action(game, { type: 'adjust', playerId: a, field: 'life', delta: -5 }, { now: 10_000 });
    played = action(played, { type: 'adjust', playerId: b, field: 'life', delta: 3 }, { now: 20_000 });
    expect(played.lifeLog).toEqual([
      { t: 1000, l: [40, 40, 40] },
      { t: 10_000, l: [35, 40, 40] },
      { t: 20_000, l: [35, 43, 40] },
    ]);
    const ended = action(action(played, { type: 'declareWinner', winners: [b] }, { now: 21_000 }), {
      type: 'end',
    });
    expect(recordedResult(ended)).toBe(b);
    const recap = createRecap(ended, 30_000, recordedResult(ended));
    expect(recap.result).toBe(`${ended.players[b].name} wins`);
    expect(recap.life?.points).toHaveLength(3);
    expect(createRecap(game, 30_000).life).toBeUndefined();
  });
  it('keeps the life history bounded in a very long game', () => {
    let game = start();
    const id = game.order[0];
    for (let step = 0; step < MAX_LIFE_LOG + 60; step++)
      game = action(
        game,
        { type: 'adjust', playerId: id, field: 'life', delta: 1 },
        { now: 5000 + step * 2000 },
      );
    expect(game.lifeLog!.length).toBeLessThanOrEqual(MAX_LIFE_LOG);
    expect(game.lifeLog![0]).toEqual({ t: 1000, l: [40, 40, 40] });
    expect(game.lifeLog!.at(-1)!.l[0]).toBe(40 + MAX_LIFE_LOG + 60);
    expect(gameSchema.safeParse(game).success).toBe(true);
  });
});

describe('Planechase and table markers', () => {
  it('ships rules text for every plane in the index', () => {
    expect(planes.length).toBeGreaterThan(150);
    for (const plane of planes) expect(planeCards[plane.id]?.text, plane.name).toBeTruthy();
    expect(new Set(planes.map((plane) => plane.id)).size).toBe(planes.length);
    const deck = shufflePlanarDeck(['who'], () => 0);
    expect(deck).toHaveLength(planes.filter((plane) => plane.set === 'who').length);
  });
  it('cycles the planar deck, counts die rolls each turn and undoes cleanly', () => {
    const game = createGame(defaultSetup(2), newId, 1000);
    expect(() => action(game, { type: 'planeswalk' })).toThrow(/shuffle/i);
    const started = action(game, { type: 'shufflePlanes', sets: ['pca', 'moc'] });
    const { deck } = started.planechase!;
    expect(started.planechase).toMatchObject({ current: deck[0], position: 1, die: null, rolls: 0 });
    const chaos = action(started, { type: 'planarDie' }, { planarRoll: planarFaces.indexOf('chaos') });
    expect(chaos.planechase).toMatchObject({ die: 'chaos', rolls: 1 });
    const again = action(chaos, { type: 'planarDie' }, { planarRoll: 0 });
    expect(again.planechase).toMatchObject({ die: 'blank', rolls: 2 });
    expect(action(again, { type: 'undo' }).planechase).toEqual(chaos.planechase);
    const walked = action(again, { type: 'planeswalk' });
    expect(walked.planechase).toMatchObject({ current: deck[1], position: 2, die: null, rolls: 0 });
    let lap = walked;
    for (let step = 0; step < deck.length - 1; step++) lap = action(lap, { type: 'planeswalk' });
    expect(lap.planechase!.current).toBe(deck[0]);
    const next = action(chaos, { type: 'turn', playerId: game.order[1], advance: true });
    expect(next.planechase!.rolls).toBe(0);
    expect(next.turn.startedAt).toBe(2000);
    // Time spent paused is not part of the turn.
    const paused = action(next, { type: 'timer', action: 'pause' }, { now: 2010 });
    const resumed = action(paused, { type: 'timer', action: 'resume' }, { now: 2310 });
    expect(resumed.turn.startedAt).toBe(2300);
    const during = action(paused, { type: 'turn', playerId: game.order[0], advance: true }, { now: 2100 });
    expect(action(during, { type: 'timer', action: 'resume' }, { now: 2310 }).turn.startedAt).toBe(2310);
    expect(action(lap, { type: 'endPlanechase' }).planechase).toBeUndefined();
    expect(gameSchema.safeParse(lap).success).toBe(true);
  });
  it('keeps extra trackers off until chosen and shows a counter chip above zero', () => {
    const game = createGame(defaultSetup(2), newId, 1000);
    const id = game.order[0];
    expect(game.settings.counters).toEqual([]);
    expect(game.settings.markerTrackers).toEqual([]);
    const on = action(game, {
      type: 'trackers',
      counters: ['Energy'],
      markerTrackers: ['monarch', 'dayNight'],
    });
    expect(playerStatuses(on, id).some((status) => status.kind === 'counter')).toBe(false);
    const charged = action(on, { type: 'adjust', playerId: id, field: 'Energy', delta: 3 });
    expect(playerStatuses(charged, id)).toContainEqual(
      expect.objectContaining({ kind: 'counter', label: 'ENERGY', value: '3' }),
    );
    const night = action(charged, { type: 'dayNight', value: 'night' });
    expect(night.markers.dayNight).toBe('night');
    expect(action(night, { type: 'undo' }).markers.dayNight ?? null).toBeNull();
    const crowned = action(night, { type: 'marker', marker: 'monarch', playerId: id });
    expect(crowned.history.at(-1)!.summary).toMatch(/monarch/i);
  });
  it('picks a random opponent only from players still in the game', () => {
    const game = createGame(defaultSetup(4), newId, 1000);
    const [a, b, c, d] = game.order;
    const thinned = action(game, { type: 'eliminate', playerId: c, eliminated: true });
    const context = { id: newId(), now: 1, actor: 'Alex' };
    const roll = makeRoll(
      thinned,
      { type: 'roll', kind: 'opponent', sides: 20, count: 1, playerId: a },
      context,
      () => 1,
    );
    expect(roll.candidates).toEqual([b, d]);
    expect(roll.winner).toBe(d);
    expect(() =>
      makeRoll(thinned, { type: 'roll', kind: 'opponent', sides: 20, count: 1 }, context, () => 0),
    ).toThrow();
  });
});

describe('scanned room codes', () => {
  it('reads the code from a join or spectator link, or a bare code', () => {
    expect(scannedCode('https://table.example/?join=ABCD2345')).toEqual({ code: 'ABCD2345', watch: false });
    expect(scannedCode('https://table.example/?join=abcd2345&watch=1')).toEqual({
      code: 'ABCD2345',
      watch: true,
    });
    expect(scannedCode('abcd 2345')).toEqual({ code: 'ABCD2345', watch: false });
    expect(scannedCode('https://example.com/')).toBeNull();
    expect(scannedCode('WIFI:T:WPA;S:home;;')).toBeNull();
  });
});
