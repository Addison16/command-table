import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  archenemyOutcome,
  archenemySetup,
  createGame,
  defaultSetup,
  isTeamTurn,
  opponentsOf,
  reduceGame,
  setupFromGame,
  turnOrder,
} from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import { gameSchema, setupSchema, type AdminCommand, type Command, type Game } from '../src/shared/schema.js';
import { canUndoRoomAction } from '../src/shared/permissions.js';
import { playerStatuses } from '../src/client/features/playerStatuses.js';
import { createRecap } from '../src/client/features/gameRecap.js';
import { openDatabase } from '../src/server/database.js';
import { hash, RoomService } from '../src/server/service.js';
import { readConfig } from '../src/server/config.js';

const actorId = newId();
function action(g: Game, c: Command, now = 2000) {
  return reduceGame(g, c, {
    id: newId(),
    operationId: newId(),
    actorId,
    actor: 'Alex',
    now,
    newGameId: c.type === 'rematch' ? newId() : undefined,
  });
}
const archenemyGame = (count = 4, seat = 0) => createGame(archenemySetup(count, seat), newId, 1000);

describe('archenemy setup', () => {
  it('gives the archenemy 60 life, the team 40, and the archenemy the first turn', () => {
    const g = archenemyGame(4, 2);
    const villain = g.order[2];
    expect(g.settings.preset).toBe('Archenemy');
    expect(g.archenemy).toEqual({ playerId: villain, schemes: 0, ongoing: [] });
    expect(g.order.map((id) => g.players[id].life)).toEqual([40, 40, 60, 40]);
    expect(g.turn).toEqual({ playerId: villain, number: 1 });
    expect(setupFromGame(g).seats.map((seat) => !!seat.archenemy)).toEqual([false, false, true, false]);
  });
  it('leaves ordinary games untouched', () => {
    const g = createGame(defaultSetup(), newId, 1000);
    expect(g.archenemy).toBeUndefined();
    expect(setupFromGame(g).seats.every((seat) => !('archenemy' in seat))).toBe(true);
    expect(archenemyOutcome(g)).toBeNull();
  });
  it('requires exactly one archenemy and someone to oppose them', () => {
    const two = archenemySetup(3);
    two.seats[1].archenemy = true;
    expect(setupSchema.safeParse(two).success).toBe(false);
    expect(setupSchema.safeParse(archenemySetup(1)).success).toBe(false);
    expect(setupSchema.safeParse(archenemySetup(2)).success).toBe(true);
  });
  it('rejects an archenemy that is not at the table', () => {
    const g = archenemyGame();
    expect(gameSchema.safeParse({ ...g, archenemy: { ...g.archenemy, playerId: newId() } }).success).toBe(
      false,
    );
  });
});

describe('archenemy play', () => {
  it('counts schemes, keeps ongoing schemes until abandoned, and undoes each step', () => {
    const g = archenemyGame();
    const first = action(g, { type: 'scheme', ongoing: false });
    expect(first.archenemy).toMatchObject({ schemes: 1, ongoing: [] });
    expect(first.history.at(-1)!.summary).toBe('Player 1 set Scheme 1 in motion');
    const second = action(first, { type: 'scheme', name: 'Your Will Is Not Your Own', ongoing: true });
    expect(second.archenemy).toMatchObject({ schemes: 2, ongoing: ['Your Will Is Not Your Own'] });
    const abandoned = action(second, { type: 'abandonScheme', index: 0 });
    expect(abandoned.archenemy).toMatchObject({ schemes: 2, ongoing: [] });
    expect(() => action(abandoned, { type: 'abandonScheme', index: 0 })).toThrow(/no longer ongoing/);
    expect(action(abandoned, { type: 'undo' }).archenemy).toEqual(second.archenemy);
    expect(action(second, { type: 'undo' }).archenemy).toEqual(first.archenemy);
    expect(() => action(createGame(defaultSetup(), newId, 1000), { type: 'scheme', ongoing: false })).toThrow(
      /only in Archenemy/,
    );
  });
  it('shows the scheme deck on the archenemy seat only', () => {
    const g = action(archenemyGame(), { type: 'scheme', name: 'Feed the Machine', ongoing: true });
    expect(playerStatuses(g, g.order[0])[0]).toMatchObject({ kind: 'scheme', value: '1' });
    expect(playerStatuses(g, g.order[0])[0].label).toBe('ARCHENEMY · 1 ONGOING');
    expect(playerStatuses(g, g.order[1]).some((status) => status.kind === 'scheme')).toBe(false);
  });
  it('treats only the other side as opponents for group life', () => {
    const g = archenemyGame();
    const [villain, a, b, c] = g.order;
    expect(opponentsOf(g, villain)).toEqual([a, b, c]);
    expect(opponentsOf(g, a)).toEqual([villain]);
    const drained = action(g, {
      type: 'groupLife',
      casterId: villain,
      targetIds: [a, b, c],
      loss: 2,
      gain: 6,
    });
    expect([villain, a, b, c].map((id) => drained.players[id].life)).toEqual([66, 38, 38, 38]);
    expect(() => action(g, { type: 'groupLife', casterId: a, targetIds: [b], loss: 1 })).toThrow(/Teammates/);
    expect(
      action(g, { type: 'groupLife', casterId: a, targetIds: [villain], loss: 3 }).players[villain].life,
    ).toBe(57);
  });
  it('alternates turns between the archenemy and the whole team', () => {
    const g = action(archenemyGame(), { type: 'turnTracking', enabled: true });
    const [villain, a] = g.order;
    expect(turnOrder(g)).toEqual([villain, a]);
    expect(isTeamTurn(g)).toBe(false);
    const team = action(g, { type: 'turn', playerId: a, advance: true });
    expect(isTeamTurn(team)).toBe(true);
    const out = action(team, { type: 'eliminate', playerId: a, eliminated: true });
    expect(turnOrder(out)).toEqual([villain, out.order[2]]);
  });
  it('announces who won when a side is eliminated', () => {
    const g = archenemyGame();
    const [villain, ...team] = g.order;
    const defeated = action(g, { type: 'eliminate', playerId: villain, eliminated: true });
    expect(archenemyOutcome(defeated)).toBe('team');
    expect(defeated.history.at(-1)!.summary).toContain('The team defeated the archenemy');
    let conquered = g;
    for (const id of team)
      conquered = action(conquered, { type: 'eliminate', playerId: id, eliminated: true });
    expect(archenemyOutcome(conquered)).toBe('archenemy');
    expect(conquered.history.at(-1)!.summary).toContain('The archenemy has conquered the team');
    const ended = action(defeated, { type: 'end' });
    const recap = createRecap(ended, 3000, 'team');
    expect(recap.result).toBe('The team wins');
    expect(recap.players.map((player) => player.winner)).toEqual([false, true, true, true]);
    expect(recap.players[0].archenemy).toBe(true);
  });
  it('restores both life totals and the scheme deck on a rematch', () => {
    let g = archenemyGame();
    const [villain, a] = g.order;
    g = action(g, { type: 'scheme', name: 'Nature Demands an Offering', ongoing: true });
    g = action(g, { type: 'adjust', playerId: villain, field: 'life', delta: -20 });
    g = action(g, { type: 'adjust', playerId: a, field: 'life', delta: -10 });
    g = action(g, { type: 'turn', playerId: a, advance: true });
    const next = action(g, { type: 'rematch' });
    expect(next.players[villain].life).toBe(60);
    expect(next.players[a].life).toBe(40);
    expect(next.archenemy).toEqual({ playerId: villain, schemes: 0, ongoing: [] });
    expect(next.turn).toEqual({ playerId: villain, number: 1 });
  });
});

describe('archenemy rooms', () => {
  const close: (() => void)[] = [];
  afterEach(() => {
    while (close.length) close.pop()!();
  });
  it('lets the archenemy seat and the host run the scheme deck, but not the team', () => {
    const db = openDatabase(':memory:');
    close.push(() => db.close());
    const svc = new RoomService(
      db,
      readConfig({
        PUBLIC_ORIGIN: 'http://localhost:5173',
        ALLOW_INSECURE_HTTP: 'true',
        ROOM_TTL_DAYS: '30',
        SESSION_TTL_DAYS: '90',
      }),
      () => 1_800_000_000_000,
    );
    const session = () => {
      const s = svc.session(undefined, true);
      return { ...s, hash: hash(s.token) };
    };
    const host = session(),
      villain = session(),
      hero = session();
    const game = createGame(archenemySetup(4, 1), randomUUID, 1_800_000_000_000);
    const room = svc.create(host.hash, game, 'Host', game.order[0]);
    expect(room.seats.map((seat) => !!seat.archenemy)).toEqual([false, true, false, false]);
    const v = svc.join(villain.hash, room.code!, 'Villain'),
      h = svc.join(hero.hash, room.code!, 'Hero');
    const run = (actor: string, command: Command | AdminCommand) => {
      const view = svc.view(room.id, actor);
      return svc.execute(actor, {
        protocolVersion: 1,
        roomId: room.id,
        gameId: view.gameId,
        operationId: randomUUID(),
        baseRevision: view.revision,
        command,
      });
    };
    run(host.hash, { type: 'approve', memberId: v.me.id, playerId: game.order[1], replace: false });
    run(host.hash, { type: 'approve', memberId: h.me.id, playerId: game.order[2], replace: false });
    expect(run(hero.hash, { type: 'scheme', ongoing: false }).receipt.ok).toBe(false);
    expect(
      run(villain.hash, { type: 'scheme', name: 'Choose Your Champion', ongoing: true }).receipt.ok,
    ).toBe(true);
    const after = svc.view(room.id, villain.hash);
    expect(canUndoRoomAction(after.game!, after.me.id, after.me.seatId, false)).toBe(true);
    expect(run(villain.hash, { type: 'undo' }).receipt.ok).toBe(true);
    expect(run(host.hash, { type: 'scheme', ongoing: false }).receipt.ok).toBe(true);
    expect(run(hero.hash, { type: 'abandonScheme', index: 0 }).receipt.ok).toBe(false);
    expect(svc.view(room.id, host.hash).game!.archenemy).toMatchObject({ schemes: 1, ongoing: [] });
  });
});
