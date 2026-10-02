import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGame, defaultSetup, reduceGame } from '../src/shared/game.js';
import { type Command, type AdminCommand, type Envelope, type Game } from '../src/shared/schema.js';
import { openDatabase } from '../src/server/database.js';
import { hash, RoomService } from '../src/server/service.js';
import { readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';
import type { CommanderCard } from '../src/shared/cards.js';
const config = readConfig({
  PUBLIC_ORIGIN: 'http://localhost:5173',
  ALLOW_INSECURE_HTTP: 'true',
  ROOM_TTL_DAYS: '30',
  SESSION_TTL_DAYS: '90',
});
const close: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  while (close.length) await close.pop()!();
});
function fixture(filename = ':memory:', count = 4, prepare?: (game: Game) => void) {
  let now = 1_800_000_000_000;
  const db = openDatabase(filename),
    svc = new RoomService(db, config, () => now);
  close.push(() => {
    if (db.open) db.close();
  });
  const session = () => {
    const s = svc.session(undefined, true);
    return { ...s, hash: hash(s.token) };
  };
  const host = session(),
    guest = session(),
    other = session();
  const initial = createGame(defaultSetup(count), randomUUID, now);
  prepare?.(initial);
  const room = svc.create(host.hash, initial, 'Host', initial.order.at(-1));
  const g = svc.join(guest.hash, room.code!, 'Alex'),
    o = svc.join(other.hash, room.code!, 'Sam');
  const envelope = (actor: string, command: Command | AdminCommand, baseRevision?: number): Envelope => {
    const view = svc.view(room.id, actor);
    return {
      protocolVersion: 1,
      roomId: room.id,
      gameId: view.gameId,
      operationId: randomUUID(),
      baseRevision: baseRevision ?? view.revision,
      command,
    };
  };
  const run = (actor: string, command: Command | AdminCommand, baseRevision?: number) =>
    svc.execute(actor, envelope(actor, command, baseRevision));
  const approve = () => {
    run(host.hash, { type: 'approve', memberId: g.me.id, playerId: room.seats[0].id, replace: false });
    run(host.hash, { type: 'approve', memberId: o.me.id, playerId: room.seats[1].id, replace: false });
  };
  return {
    db,
    svc,
    host,
    guest,
    other,
    room,
    g,
    o,
    run,
    envelope,
    approve,
    session,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('authoritative room transactions', () => {
  it('rejects self-damage and corrections for guests and hosts without changing the room', () => {
    const f = fixture(':memory:', 4, (game) => {
      const id = randomUUID();
      game.commanders[id] = { id, ownerId: game.order[0], label: 'Partner', casts: 0 };
    });
    f.approve();
    const before = f.svc.view(f.room.id, f.host.hash);
    for (const actor of [f.host, f.guest]) {
      const playerId = f.svc.view(f.room.id, actor.hash).me.seatId!;
      const owned = Object.values(before.game!.commanders).filter((entry) => entry.ownerId === playerId);
      for (const commander of owned) {
        const commands: Command[] = [
          { type: 'damage', playerId, commanderId: commander.id, amount: 5, subtractLife: true },
          { type: 'damage', playerId, commanderId: commander.id, amount: 5, subtractLife: false },
          { type: 'damageSet', playerId, commanderId: commander.id, value: 5 },
        ];
        for (const command of commands) {
          expect(f.run(actor.hash, command).receipt).toMatchObject({
            ok: false,
            error: expect.stringContaining('Choose another player’s commander'),
          });
          expect(f.svc.view(f.room.id, f.host.hash)).toEqual(before);
        }
      }
    }
  });
  it('rejects group life changes for every room participant without changing the table', () => {
    const f = fixture();
    f.approve();
    const command: Extract<Command, { type: 'groupLife' }> = {
      type: 'groupLife',
      casterId: f.room.seats[0].id,
      targetIds: f.room.seats.slice(1).map((seat) => seat.id),
      loss: 4,
      gain: 6,
    };
    const before = f.svc.view(f.room.id, f.host.hash);
    for (const actor of [f.host, f.guest, f.other]) {
      expect(f.run(actor.hash, command).receipt).toMatchObject({
        ok: false,
        error: expect.stringMatching(/one device/i),
      });
      expect(f.svc.view(f.room.id, f.host.hash)).toEqual(before);
    }
  });
  const playerCommands: ((game: Game, playerId: string) => Command)[] = [
    (_, playerId) => ({ type: 'adjust', playerId, field: 'life', delta: -1 }),
    (_, playerId) => ({ type: 'set', playerId, field: 'poison', value: 2 }),
    (_, playerId) => ({ type: 'adjust', playerId, field: 'energy', delta: 1 }),
    (game, playerId) => ({
      type: 'damage',
      playerId,
      commanderId: Object.values(game.commanders).find((entry) => entry.ownerId !== playerId)!.id,
      amount: 2,
      subtractLife: true,
    }),
    (game, playerId) => ({
      type: 'damageSet',
      playerId,
      commanderId: Object.values(game.commanders).find((entry) => entry.ownerId !== playerId)!.id,
      value: 2,
    }),
    (game, playerId) => ({
      type: 'cast',
      commanderId: Object.values(game.commanders).find((c) => c.ownerId === playerId)!.id,
    }),
    (game, playerId) => ({
      type: 'castSet',
      commanderId: Object.values(game.commanders).find((c) => c.ownerId === playerId)!.id,
      value: 2,
    }),
    (_, playerId) => ({ type: 'customize', playerId, name: 'Own name', color: 'teal' }),
    (game, playerId) => ({
      type: 'editPlayer',
      playerId,
      name: 'Own profile',
      color: 'teal',
      commanders: Object.values(game.commanders)
        .filter((c) => c.ownerId === playerId)
        .map(({ id }) => ({ id, label: 'Own commander' })),
    }),
    (game, playerId) => ({
      type: 'commanderName',
      commanderId: Object.values(game.commanders).find((c) => c.ownerId === playerId)!.id,
      label: 'Own commander',
    }),
    (_, playerId) => ({ type: 'eliminate', playerId, eliminated: true }),
  ];
  it.each(playerCommands.map((build, index) => ({ build, index })))(
    'restricts player command $index to its owner, including the host',
    ({ build }) => {
      const f = fixture(':memory:', 4, (game) => {
        game.settings.counters = ['energy'];
      });
      f.approve();
      for (const actor of [f.host, f.guest, f.other]) {
        const view = f.svc.view(f.room.id, actor.hash);
        for (const otherSeat of view.seats.filter((seat) => seat.id !== view.me.seatId)) {
          const before = f.svc.view(f.room.id, actor.hash);
          expect(f.run(actor.hash, build(before.game!, otherSeat.id)).receipt.ok).toBe(false);
          expect(f.svc.view(f.room.id, actor.hash)).toEqual(before);
        }
        expect(f.run(actor.hash, build(view.game!, view.me.seatId!)).receipt.ok).toBe(true);
        expect(f.run(actor.hash, { type: 'undo' }).receipt.ok).toBe(true);
      }
    },
  );
  it('disables old shared-edit policy values and cannot enable them again', () => {
    const f = fixture();
    f.approve();
    f.db.prepare('UPDATE rooms SET everyone_edits=1 WHERE id=?').run(f.room.id);
    expect(f.svc.view(f.room.id, f.host.hash).everyoneEdits).toBe(false);
    const before = f.svc.view(f.room.id, f.host.hash).game;
    expect(f.run(f.host.hash, { type: 'policy', everyoneEdits: true }).receipt.ok).toBe(false);
    expect(
      f.run(f.guest.hash, { type: 'adjust', playerId: f.room.seats[1].id, field: 'life', delta: -1 }).receipt
        .ok,
    ).toBe(false);
    expect(
      f.run(f.host.hash, { type: 'adjust', playerId: f.room.seats[0].id, field: 'life', delta: -1 }).receipt
        .ok,
    ).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(before);
    expect(f.run(f.host.hash, { type: 'policy', everyoneEdits: false }).receipt.ok).toBe(true);
  });
  it('does not let the host undo another player’s action', () => {
    const f = fixture();
    f.approve();
    f.run(f.guest.hash, { type: 'adjust', playerId: f.room.seats[0].id, field: 'life', delta: -1 });
    const before = f.svc.view(f.room.id, f.host.hash);
    expect(f.run(f.host.hash, { type: 'undo' }).receipt.ok).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash)).toEqual(before);
    expect(f.run(f.guest.hash, { type: 'undo' }).receipt.ok).toBe(true);
  });
  it('keeps an unseated host’s player access read-only while preserving table controls and their undo', () => {
    const f = fixture();
    f.approve();
    f.run(f.host.hash, { type: 'release', memberId: f.room.me.id });
    const before = f.svc.view(f.room.id, f.host.hash);
    expect(before.me.seatId).toBeNull();
    expect(before.game!.order).toHaveLength(4);
    for (const build of playerCommands)
      expect(f.run(f.host.hash, build(before.game!, before.game!.order[0])).receipt.ok).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(before.game);
    const controls: Command[] = [
      { type: 'marker', marker: 'monarch', playerId: before.game!.order[0] },
      { type: 'turn', playerId: before.game!.order[0], advance: true },
      { type: 'turnTracking', enabled: true },
      { type: 'timer', action: 'pause' },
      { type: 'trackers', counters: ['energy'], markerTrackers: ['monarch'] },
      { type: 'end' },
    ];
    for (const command of controls) {
      expect(f.run(f.guest.hash, command).receipt.ok).toBe(false);
      expect(f.run(f.host.hash, command).receipt.ok).toBe(true);
      expect(f.run(f.host.hash, { type: 'undo' }).receipt.ok).toBe(true);
    }
    const after = f.svc.view(f.room.id, f.host.hash).game!;
    expect(after.players).toEqual(before.game!.players);
    expect(after.commanders).toEqual(before.game!.commanders);
  });
  it.each(['life', 'damage', 'commander', 'group'])(
    'rejects a legacy %s undo frame that changes another seat, even for its actor',
    (kind) => {
      const f = fixture();
      f.approve();
      const game = f.svc.view(f.room.id, f.host.hash).game!;
      const playerId = game.order[0];
      const commanderId = Object.values(game.commanders).find((c) =>
        kind === 'damage' ? c.ownerId !== playerId : c.ownerId === playerId,
      )!.id;
      const command: Command =
        kind === 'life'
          ? { type: 'adjust', playerId, field: 'life', delta: -1 }
          : kind === 'damage'
            ? { type: 'damage', playerId, commanderId, amount: 2, subtractLife: false }
            : kind === 'commander'
              ? { type: 'cast', commanderId }
              : { type: 'groupLife', casterId: f.room.me.seatId!, targetIds: [playerId], loss: 2, gain: 2 };
      const legacy = reduceGame(game, command, {
        id: randomUUID(),
        operationId: randomUUID(),
        now: f.svc.now(),
        actorId: f.room.me.id,
        actor: 'Host',
      });
      f.db
        .prepare('UPDATE rooms SET game=?,undo_room_revision=revision WHERE id=?')
        .run(JSON.stringify(legacy), f.room.id);
      const before = f.svc.view(f.room.id, f.host.hash);
      expect(f.run(f.host.hash, { type: 'undo' }).receipt.ok).toBe(false);
      expect(f.svc.view(f.room.id, f.host.hash)).toEqual(before);
    },
  );
  it('commits a player profile once, lets its owner undo it, and limits edits to the assigned seat', () => {
    const f = fixture();
    const playerId = f.room.seats[0].id;
    const commander = Object.values(f.room.game!.commanders).find((entry) => entry.ownerId === playerId)!;
    const card: CommanderCard = {
      id: randomUUID(),
      name: 'Tymna the Weaver',
      imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
      scryfallUrl: 'https://scryfall.com/card/test/1/tymna-the-weaver',
      artist: 'Example Artist',
    };
    const command: Extract<Command, { type: 'editPlayer' }> = {
      type: 'editPlayer',
      playerId,
      name: 'Rowan',
      color: 'teal',
      commanders: [{ id: commander.id, label: card.name, card }],
    };
    expect(f.run(f.guest.hash, command).receipt.ok).toBe(false);
    f.approve();
    f.run(f.guest.hash, { type: 'cast', commanderId: commander.id });
    f.run(f.guest.hash, {
      type: 'damage',
      playerId,
      commanderId: Object.values(f.room.game!.commanders).find((entry) => entry.ownerId !== playerId)!.id,
      amount: 5,
      subtractLife: true,
    });
    const before = f.svc.view(f.room.id, f.host.hash);
    const envelope = f.envelope(f.guest.hash, command);
    const result = f.svc.execute(f.guest.hash, envelope);
    expect(result.receipt.ok).toBe(true);
    const edited = f.svc.view(f.room.id, f.host.hash);
    expect(edited.revision).toBe(before.revision + 1);
    expect(edited.game!.revision).toBe(before.game!.revision + 1);
    expect(edited.game!.history).toHaveLength(before.game!.history.length + 1);
    expect(edited.game!.undo).toHaveLength(before.game!.undo.length + 1);
    expect(edited.game!.players[playerId]).toEqual({
      ...before.game!.players[playerId],
      name: 'Rowan',
      color: 'teal',
    });
    expect(edited.game!.commanders[commander.id]).toEqual({
      ...before.game!.commanders[commander.id],
      label: card.name,
      card,
    });
    expect(edited.game!.damageReceived).toEqual(before.game!.damageReceived);
    expect(f.svc.execute(f.guest.hash, envelope).receipt).toEqual(result.receipt);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(edited.game);
    expect(f.run(f.guest.hash, { type: 'undo' }).receipt.ok).toBe(true);
    const undone = f.svc.view(f.room.id, f.guest.hash).game!;
    expect(undone.players).toEqual(before.game!.players);
    expect(undone.commanders).toEqual(before.game!.commanders);
    f.run(f.host.hash, { type: 'policy', everyoneEdits: true });
    const otherPlayerId = f.room.seats[1].id;
    const otherCommander = Object.values(undone.commanders).find((entry) => entry.ownerId === otherPlayerId)!;
    const otherCommand: Extract<Command, { type: 'editPlayer' }> = {
      ...command,
      playerId: otherPlayerId,
      commanders: [{ id: otherCommander.id, label: card.name, card }],
    };
    const beforeDenied = f.svc.view(f.room.id, f.host.hash).game!;
    expect(f.run(f.guest.hash, otherCommand).receipt.ok).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(beforeDenied);
    expect(f.run(f.host.hash, otherCommand).receipt.ok).toBe(false);
    expect(f.run(f.other.hash, otherCommand).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.other.hash).game!.commanders[otherCommander.id].card).toEqual(card);
  });
  it('rejects incomplete, duplicate and foreign commander IDs without partially saving a shared profile', () => {
    const f = fixture();
    const playerId = f.room.seats[0].id;
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId,
      profile: { name: 'Alex', commanders: ['One', 'Two'] },
    });
    f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId, replace: false });
    const before = f.svc.view(f.room.id, f.host.hash);
    const commanders = Object.values(before.game!.commanders)
      .filter((entry) => entry.ownerId === playerId)
      .map(({ id, label }) => ({ id, label }));
    const other = Object.values(before.game!.commanders).find((entry) => entry.ownerId !== playerId)!;
    const command: Extract<Command, { type: 'editPlayer' }> = {
      type: 'editPlayer',
      playerId,
      name: 'Should not save',
      color: 'rose',
      commanders,
    };
    for (const invalid of [
      [commanders[0]],
      [commanders[0], commanders[0]],
      [commanders[0], { id: randomUUID(), label: 'Unknown' }],
      [commanders[0], { id: other.id, label: 'Another seat' }],
    ]) {
      expect(f.run(f.guest.hash, { ...command, commanders: invalid }).receipt.ok).toBe(false);
      const after = f.svc.view(f.room.id, f.host.hash);
      expect(after.revision).toBe(before.revision);
      expect(after.game).toEqual(before.game);
    }
  });
  it('applies approved commander artwork to existing identities and protects each player’s artwork', () => {
    const f = fixture(':memory:', 4, (game) => {
      const seat = game.order[0];
      const commander = Object.values(game.commanders).find((c) => c.ownerId === seat)!;
      commander.casts = 1;
      game.players[seat].life = 35;
      game.damageReceived[seat] = { [commander.id]: 5 };
    });
    const seat = f.room.seats[0].id;
    const original = Object.values(f.room.game!.commanders).find((commander) => commander.ownerId === seat)!;
    const card: CommanderCard = {
      id: randomUUID(),
      name: 'A Legendary Commander With A Name Longer Than Forty Characters',
      imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
      scryfallUrl: 'https://scryfall.com/card/test/1/example-commander',
      artist: 'Example Artist',
    };
    const before = f.svc.view(f.room.id, f.host.hash).game!;
    const profile = { name: 'Alex', commanders: [card.name, 'Custom partner'], commanderCards: [card, null] };
    expect(f.run(f.guest.hash, { type: 'requestSeat', playerId: seat, profile }).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.guest.hash).me.seatProfile).toEqual(profile);
    expect(f.svc.view(f.room.id, f.host.hash).game!.commanders).toEqual(before.commanders);
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt.ok,
    ).toBe(true);
    const approved = f.svc.view(f.room.id, f.guest.hash).game!;
    expect(approved.commanders[original.id]).toEqual({
      ...before.commanders[original.id],
      label: card.name,
      card,
    });
    expect(approved.damageReceived).toEqual(before.damageReceived);
    expect(approved.players[seat].life).toBe(35);
    const ownCommand = { type: 'commanderName', commanderId: original.id, label: 'A custom name' } as const;
    expect(f.run(f.guest.hash, ownCommand).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.host.hash).game!.commanders[original.id]).not.toHaveProperty('card');
    expect(f.run(f.guest.hash, { ...ownCommand, label: card.name, card }).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.host.hash).game!.commanders[original.id].card).toEqual(card);
    expect(f.run(f.guest.hash, { type: 'undo' }).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.host.hash).game!.commanders[original.id]).not.toHaveProperty('card');
    const otherCommander = Object.values(approved.commanders).find(
      (commander) => commander.ownerId !== seat,
    )!;
    f.run(f.host.hash, { type: 'policy', everyoneEdits: true });
    expect(
      f.run(f.guest.hash, { ...ownCommand, commanderId: otherCommander.id, label: card.name, card }).receipt
        .ok,
    ).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game!.commanders[otherCommander.id]).toEqual(otherCommander);
    expect(f.run(f.guest.hash, { ...ownCommand, label: card.name, card }).receipt.ok).toBe(true);
    f.run(f.host.hash, { type: 'rematch' });
    const rematch = f.svc.view(f.room.id, f.guest.hash).game!;
    expect(rematch.commanders[original.id]).toEqual({ ...approved.commanders[original.id], casts: 0 });
    f.run(f.host.hash, { type: 'release', memberId: f.g.me.id });
    f.run(f.other.hash, {
      type: 'requestSeat',
      playerId: seat,
      profile: { name: 'Sam', commanders: ['Different commander'] },
    });
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.o.me.id, playerId: seat, replace: false }).receipt.ok,
    ).toBe(true);
    expect(f.svc.view(f.room.id, f.other.hash).game!.commanders[original.id]).toEqual({
      ...original,
      label: 'Different commander',
      casts: 0,
    });
  });
  it('keeps player choices pending until approval, then applies them once without resetting play', () => {
    const f = fixture(':memory:', 4, (game) => {
        const seat = game.order[0];
        const commander = Object.values(game.commanders).find((c) => c.ownerId === seat)!;
        commander.casts = 1;
        game.players[seat].life = 33;
        game.damageReceived[seat] = { [commander.id]: 7 };
      }),
      seat = f.room.seats[0].id;
    const initial = f.svc.view(f.room.id, f.host.hash).game!;
    const commander = Object.values(initial.commanders).find((c) => c.ownerId === seat)!;
    const before = f.svc.view(f.room.id, f.host.hash).game!;
    const profile = { name: 'Rowan', commanders: ['Tymna the Weaver', 'Kraum, Ludevic’s Opus'] };
    const request = f.run(f.guest.hash, { type: 'requestSeat', playerId: seat, profile });
    expect(request.receipt.ok).toBe(true);
    expect(request.view).not.toHaveProperty('game');
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(before);
    expect(request.view!.me.seatProfile).toEqual(profile);
    expect(f.svc.view(f.room.id, f.other.hash).members).toHaveLength(1);
    expect(f.svc.view(f.room.id, f.host.hash).members.find((m) => m.id === f.g.me.id)?.seatProfile).toEqual(
      profile,
    );
    expect(
      f.run(f.guest.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt
        .ok,
    ).toBe(false);
    const approval = f.envelope(f.host.hash, {
      type: 'approve',
      memberId: f.g.me.id,
      playerId: seat,
      replace: false,
    });
    expect(f.svc.execute(f.host.hash, approval).receipt.ok).toBe(true);
    const approved = f.svc.view(f.room.id, f.guest.hash),
      game = approved.game!;
    expect(approved.me.seatProfile).toBeUndefined();
    expect(approved.me.seatId).toBe(seat);
    expect(game.players[seat]).toEqual({ ...before.players[seat], name: 'Rowan' });
    expect(game.commanders[commander.id]).toEqual({
      ...before.commanders[commander.id],
      label: profile.commanders[0],
    });
    expect(
      Object.values(game.commanders)
        .filter((c) => c.ownerId === seat)
        .map((c) => c.label),
    ).toEqual(profile.commanders);
    expect(game.damageReceived).toEqual(before.damageReceived);
    expect(game.timer).toEqual(before.timer);
    expect(game.history.slice(0, -1)).toEqual(before.history);
    expect(f.svc.execute(f.host.hash, approval).receipt.ok).toBe(true);
    expect(f.svc.view(f.room.id, f.guest.hash).game).toEqual(game);
    expect(
      f.run(f.guest.hash, { type: 'commanderName', commanderId: commander.id, label: 'New label' }).receipt
        .ok,
    ).toBe(true);
    const otherCommander = Object.values(game.commanders).find((c) => c.ownerId !== seat)!;
    expect(
      f.run(f.guest.hash, { type: 'commanderName', commanderId: otherCommander.id, label: 'Not mine' })
        .receipt.ok,
    ).toBe(false);
  });
  it('validates requests and lets guests revise their choices without changing someone else’s seat', () => {
    const f = fixture(),
      seat = f.room.seats[0].id;
    for (const profile of [
      { name: ' ' },
      { name: 'Alex', commanders: ['A', 'B', 'C'] },
      { name: 'Alex', commanders: [''] },
    ]) {
      expect(() =>
        f.svc.execute(f.guest.hash, {
          ...f.envelope(f.guest.hash, { type: 'requestSeat', playerId: seat }),
          command: { type: 'requestSeat', playerId: seat, profile },
        }),
      ).toThrow();
    }
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId: seat,
      profile: { name: 'Alex', commanders: ['A'] },
    });
    f.run(f.other.hash, { type: 'requestSeat', playerId: seat, profile: { name: 'Sam', commanders: ['B'] } });
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId: seat,
      profile: { name: 'Alex revised', commanders: ['C'] },
    });
    const oldApproval = f.envelope(f.host.hash, {
      type: 'approve',
      memberId: f.o.me.id,
      playerId: seat,
      replace: false,
    });
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt.ok,
    ).toBe(true);
    expect(f.svc.execute(f.host.hash, oldApproval).receipt.ok).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game!.players[seat].name).toBe('Alex revised');
    expect(f.svc.view(f.room.id, f.other.hash).me).toMatchObject({
      status: 'seat-taken',
      seatProfile: { name: 'Sam', commanders: ['B'] },
    });
    expect(
      f.run(f.other.hash, { type: 'requestSeat', playerId: seat, profile: { name: 'Taken' } }).receipt.ok,
    ).toBe(false);
    const alternate = f.room.seats[1].id;
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.o.me.id, playerId: alternate, replace: false })
        .receipt.ok,
    ).toBe(true);
    expect(f.svc.view(f.room.id, f.host.hash).game!.players[alternate].name).toBe('Sam');
  });
  it('preserves a tracked partner and only removes an unused commander when changing to one', () => {
    const f = fixture(),
      seat = f.room.seats[0].id;
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId: seat,
      profile: { name: 'Alex', commanders: ['One', 'Two'] },
    });
    f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false });
    const commanders = Object.values(f.svc.view(f.room.id, f.host.hash).game!.commanders).filter(
      (c) => c.ownerId === seat,
    );
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId: f.room.seats[2].id,
      profile: { name: 'Solo', commanders: ['One renamed'] },
    });
    f.run(f.guest.hash, { type: 'cast', commanderId: commanders[1].id });
    const before = f.svc.view(f.room.id, f.host.hash).game!;
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt
        .error,
    ).toMatch(/Keep both commanders/);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(before);
    expect(f.svc.view(f.room.id, f.guest.hash).me.status).toBe('approved');
    f.run(f.guest.hash, { type: 'castSet', commanderId: commanders[1].id, value: 0 });
    f.run(f.host.hash, {
      type: 'damage',
      playerId: f.room.me.seatId!,
      commanderId: commanders[1].id,
      amount: 3,
      subtractLife: false,
    });
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt.ok,
    ).toBe(false);
    f.run(f.host.hash, {
      type: 'damageSet',
      playerId: f.room.me.seatId!,
      commanderId: commanders[1].id,
      value: 0,
    });
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: seat, replace: false }).receipt.ok,
    ).toBe(true);
    const game = f.svc.view(f.room.id, f.guest.hash).game!;
    expect(Object.values(game.commanders).filter((c) => c.ownerId === seat)).toEqual([
      { ...commanders[0], label: 'One renamed' },
    ]);
    expect(game.damageReceived[f.room.me.seatId!]).not.toHaveProperty(commanders[1].id);
  });
  it('migrates existing rooms and saves pending choices across server restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-join-profile-'));
    close.push(() => rmSync(dir, { recursive: true, force: true }));
    const filename = join(dir, 'rooms.sqlite'),
      f = fixture(filename);
    const original = f.svc.view(f.room.id, f.host.hash);
    // Reproduce the previous release’s schema with its existing rooms and sessions.
    f.db.exec('ALTER TABLE members DROP COLUMN seat_profile; PRAGMA user_version = 1;');
    f.db.close();
    const db = openDatabase(filename);
    close.push(() => {
      if (db.open) db.close();
    });
    const svc = new RoomService(db, config, f.svc.now);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(svc.view(f.room.id, f.host.hash)).toEqual(original);
    const card: CommanderCard = {
      id: randomUUID(),
      name: 'Atraxa',
      imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
      scryfallUrl: 'https://scryfall.com/card/test/1/atraxa',
      artist: 'Example Artist',
    };
    const profile = { name: 'Alex', commanders: ['Atraxa'], commanderCards: [card] };
    expect(
      svc.execute(f.guest.hash, {
        protocolVersion: 1,
        roomId: f.room.id,
        gameId: original.gameId,
        operationId: randomUUID(),
        baseRevision: original.revision,
        command: { type: 'requestSeat', playerId: original.seats[0].id, profile },
      }).receipt.ok,
    ).toBe(true);
    db.close();
    const reopened = openDatabase(filename);
    close.push(() => {
      reopened.close();
    });
    const fresh = new RoomService(reopened, config, f.svc.now);
    expect(fresh.view(f.room.id, f.guest.hash).me.seatProfile).toEqual(profile);
    expect(fresh.view(f.room.id, f.guest.hash)).not.toHaveProperty('game');
  });
  it('keeps commander tools disabled in a non-Commander room while applying the chosen name', () => {
    const f = fixture(),
      game = f.room.game!;
    game.settings.commander = false;
    f.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(JSON.stringify(game), f.room.id);
    expect(f.svc.view(f.room.id, f.guest.hash).commanderEnabled).toBe(false);
    f.run(f.guest.hash, {
      type: 'requestSeat',
      playerId: game.order[0],
      profile: { name: 'Alex', commanders: ['Ignored', 'Partner'] },
    });
    const approved = f.run(f.host.hash, {
      type: 'approve',
      memberId: f.g.me.id,
      playerId: game.order[0],
      replace: false,
    });
    expect(approved.receipt.ok).toBe(true);
    expect(approved.view!.game!.players[game.order[0]].name).toBe('Alex');
    expect(approved.view!.game!.commanders).toEqual(game.commanders);
  });
  it('allows only the host to reopen a recent ended room, preserving seats and enforcing expiry', () => {
    const f = fixture();
    f.approve();
    const seat = f.room.seats[0].id;
    f.run(f.guest.hash, { type: 'adjust', playerId: seat, field: 'life', delta: -7 });
    const before = f.svc.view(f.room.id, f.host.hash);
    expect(f.run(f.host.hash, { type: 'end' }).receipt.ok).toBe(true);
    const recovery = f.svc.recent(f.host.hash)[0];
    expect(recovery.canReopen).toBe(true);
    expect(recovery.status).toBe('ended');
    expect(f.run(f.guest.hash, { type: 'reopen' }).receipt.ok).toBe(false);
    f.svc.create(f.host.hash, createGame(defaultSetup(2, false), randomUUID, recovery.updatedAt), 'Host');
    expect(f.svc.recent(f.host.hash)).toHaveLength(2);
    f.advance(23 * 3600000);
    expect(f.run(f.host.hash, { type: 'reopen' }).receipt.ok).toBe(true);
    const restored = f.svc.view(f.room.id, f.guest.hash);
    expect(restored.gameId).toBe(before.gameId);
    expect(restored.game!.players).toEqual(before.game!.players);
    expect(restored.me.seatId).toBe(seat);
    f.run(f.host.hash, { type: 'end' });
    f.advance(24 * 3600000);
    expect(f.svc.recent(f.host.hash).some((r) => r.id === f.room.id)).toBe(false);
    expect(f.run(f.host.hash, { type: 'reopen' }).receipt.ok).toBe(false);
    expect(f.svc.view(f.room.id, f.host.hash).game!.status).toBe('ended');
  });
  it('lets approved players roll for everyone while keeping turn settings with the host', () => {
    const f = fixture();
    const command = { type: 'roll', kind: 'd20-each', count: 1, sides: 20 } as const;
    expect(f.run(f.guest.hash, command).receipt.ok).toBe(false);
    f.approve();
    expect(f.run(f.guest.hash, command).receipt.ok).toBe(true);
    const game = f.svc.view(f.room.id, f.host.hash).game!;
    expect(game.rolls[0].rounds[0]).toHaveLength(4);
    expect(game.turn.playerId).toBeNull();
    expect(f.run(f.guest.hash, { type: 'turnTracking', enabled: true }).receipt.ok).toBe(false);
    expect(f.run(f.host.hash, { type: 'turnTracking', enabled: true }).receipt.ok).toBe(true);
  });
  it('shares the chosen dice player without granting seat editing or rerolling a retried command', () => {
    const f = fixture();
    f.approve();
    const playerId = f.room.seats[1].id;
    const command = { type: 'roll', kind: 'dice', count: 1, sides: 20, playerId } as const;
    const envelope = f.envelope(f.guest.hash, command);
    const first = f.svc.execute(f.guest.hash, envelope);
    expect(first.receipt.ok).toBe(true);
    const roll = first.view!.game!.rolls[0];
    expect(roll.playerId).toBe(playerId);
    expect(f.svc.view(f.room.id, f.host.hash).game!.rolls[0]).toEqual(roll);
    expect(f.svc.view(f.room.id, f.other.hash).game!.rolls[0]).toEqual(roll);
    const retry = f.svc.execute(f.guest.hash, envelope);
    expect(retry.receipt).toEqual(first.receipt);
    expect(retry.view!.game!.rolls).toEqual([roll]);
    expect(f.run(f.guest.hash, { type: 'adjust', playerId, field: 'life', delta: -1 }).receipt.ok).toBe(
      false,
    );
    expect(f.run(f.guest.hash, { ...command, playerId: randomUUID() }).receipt.error).toMatch(
      /Unknown player/,
    );
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(first.view!.game);
  });
  it('lists only the guest’s own unfinished unexpired rooms without granting game access', () => {
    const f = fixture();
    expect(f.svc.recent(f.guest.hash)).toEqual([expect.objectContaining({ id: f.room.id, approved: false })]);
    expect(f.svc.recent(f.session().hash)).toEqual([]);
    expect(f.svc.recent(f.guest.hash)[0]).not.toHaveProperty('game');
    expect(f.svc.recent(f.guest.hash)[0]).not.toHaveProperty('code');
    f.approve();
    expect(f.svc.recent(f.guest.hash)[0].approved).toBe(true);
    f.run(f.host.hash, { type: 'end' });
    expect(f.svc.recent(f.guest.hash)).toEqual([
      expect.objectContaining({ status: 'ended', canReopen: false }),
    ]);
    f.run(f.host.hash, { type: 'undo' });
    expect(f.svc.recent(f.guest.hash)).toHaveLength(1);
    f.run(f.host.hash, { type: 'approve', memberId: f.o.me.id, playerId: f.room.seats[0].id, replace: true });
    expect(f.svc.recent(f.guest.hash)).toEqual([]);
    f.advance(31 * 86400000);
    expect(f.svc.recent(f.host.hash)).toEqual([]);
  });
  it('keeps pending guests private and enforces numerical vs administrative permissions', () => {
    const f = fixture();
    const own = f.room.seats[0].id,
      other = f.room.seats[1].id;
    expect(f.svc.view(f.room.id, f.guest.hash)).not.toHaveProperty('game');
    expect(f.g).not.toHaveProperty('code');
    expect(f.run(f.guest.hash, { type: 'adjust', playerId: own, field: 'life', delta: -1 }).receipt.ok).toBe(
      false,
    );
    f.approve();
    expect(f.run(f.guest.hash, { type: 'adjust', playerId: own, field: 'life', delta: -1 }).receipt.ok).toBe(
      true,
    );
    expect(
      f.run(f.guest.hash, { type: 'adjust', playerId: other, field: 'life', delta: -1 }).receipt.ok,
    ).toBe(false);
    f.run(f.host.hash, { type: 'policy', everyoneEdits: true });
    expect(
      f.run(f.guest.hash, { type: 'adjust', playerId: other, field: 'life', delta: -1 }).receipt.ok,
    ).toBe(false);
    expect(
      f.run(f.guest.hash, { type: 'customize', playerId: other, name: 'Hijacked', color: 'ember' }).receipt
        .ok,
    ).toBe(false);
    expect(f.run(f.guest.hash, { type: 'lock', locked: true }).receipt.ok).toBe(false);
  });
  it('adds simultaneous deltas in server order, rejects stale absolute edits and cannot undo intervening work', () => {
    const f = fixture();
    f.approve();
    const id = f.room.seats[0].id,
      base = f.svc.view(f.room.id, f.host.hash).revision;
    const a = f.run(f.guest.hash, { type: 'adjust', playerId: id, field: 'life', delta: -1 }, base);
    const own = f.room.me.seatId!;
    const b = f.run(f.host.hash, { type: 'adjust', playerId: own, field: 'life', delta: -1 }, base);
    expect(a.receipt.ok && b.receipt.ok).toBe(true);
    expect(b.view!.game!.players[id].life).toBe(39);
    expect(b.view!.game!.players[own].life).toBe(39);
    expect(
      f.run(f.guest.hash, { type: 'set', playerId: id, field: 'life', value: 99 }, base).receipt.ok,
    ).toBe(false);
    expect(f.run(f.guest.hash, { type: 'undo' }).receipt.ok).toBe(false);
    expect(f.run(f.host.hash, { type: 'undo' }).view!.game!.players[own].life).toBe(40);
    expect(f.run(f.host.hash, { type: 'undo' }).receipt.ok).toBe(false);
  });
  it('atomically assigns a seat and reports a competing request as taken', () => {
    const f = fixture(),
      id = f.room.seats[0].id;
    f.run(f.guest.hash, { type: 'requestSeat', playerId: id });
    f.run(f.other.hash, { type: 'requestSeat', playerId: id });
    const revision = f.svc.view(f.room.id, f.host.hash).revision;
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.g.me.id, playerId: id, replace: false }, revision)
        .receipt.ok,
    ).toBe(true);
    expect(
      f.run(f.host.hash, { type: 'approve', memberId: f.o.me.id, playerId: id, replace: false }, revision)
        .receipt.ok,
    ).toBe(false);
    expect(f.svc.view(f.room.id, f.other.hash).me.status).toBe('seat-taken');
    expect(
      f.db
        .prepare("SELECT id FROM members WHERE room_id=? AND seat_id=? AND status='approved'")
        .all(f.room.id, id),
    ).toHaveLength(1);
  });
  it('deduplicates forever within a room, rejects payload reuse and returns original rematch/transfer acknowledgements', () => {
    const f = fixture();
    f.approve();
    const id = f.room.seats[0].id;
    const op = f.envelope(f.guest.hash, { type: 'adjust', playerId: id, field: 'life', delta: -1 });
    const first = f.svc.execute(f.guest.hash, op);
    expect(f.svc.execute(f.guest.hash, op).receipt).toEqual(first.receipt);
    expect(() => f.svc.execute(f.guest.hash, { ...op, command: { ...op.command, delta: -2 } })).toThrow(
      /reused/,
    );
    const rematch = f.envelope(f.host.hash, { type: 'rematch' }),
      reset = f.svc.execute(f.host.hash, rematch);
    expect(reset.receipt.gameId).not.toBe(rematch.gameId);
    expect(f.svc.execute(f.host.hash, rematch).receipt).toEqual(reset.receipt);
    expect(f.svc.execute(f.guest.hash, op).receipt).toEqual(first.receipt);
    expect(f.svc.view(f.room.id, f.host.hash).game!.players[id].life).toBe(40);
    const transfer = f.envelope(f.host.hash, { type: 'transfer', memberId: f.g.me.id });
    const moved = f.svc.execute(f.host.hash, transfer);
    expect(f.svc.execute(f.host.hash, transfer).receipt).toEqual(moved.receipt);
    expect(moved.view!.me.seatId).toBe(f.room.me.seatId);
    expect(moved.view!.hostId).toBe(f.g.me.id);
    expect(f.svc.view(f.room.id, f.guest.hash).me.seatId).toBe(id);
  });
  it('revokes replacement guests before assignment and never reveals new data through an old receipt', () => {
    const f = fixture();
    f.approve();
    const id = f.room.seats[0].id;
    const env = f.envelope(f.guest.hash, { type: 'adjust', playerId: id, field: 'life', delta: 1 });
    const result = f.svc.execute(f.guest.hash, env);
    f.run(f.host.hash, { type: 'approve', memberId: f.o.me.id, playerId: id, replace: true });
    expect(() => f.svc.view(f.room.id, f.guest.hash)).toThrow(/access/);
    const repeat = f.svc.execute(f.guest.hash, env);
    expect(repeat.receipt).toEqual(result.receipt);
    expect(repeat).not.toHaveProperty('view', expect.anything());
    expect(() => f.svc.execute(f.guest.hash, { ...env, operationId: randomUUID() })).toThrow(/revoked/);
    expect(f.svc.view(f.room.id, f.other.hash).me.seatId).toBe(id);
  });
  it('locks/rotates invitations, retains rematch snapshots and cleans expired room records', () => {
    const f = fixture(),
      newcomer = f.session();
    f.run(f.host.hash, { type: 'lock', locked: true });
    expect(() => f.svc.join(newcomer.hash, f.room.code!, 'Late')).toThrow(/locked/);
    f.run(f.host.hash, { type: 'lock', locked: false });
    const rotated = f.run(f.host.hash, { type: 'rotateCode' }).view!;
    expect(rotated.code).not.toBe(f.room.code);
    expect(() => f.svc.join(newcomer.hash, f.room.code!, 'Late')).toThrow(/No room/);
    expect(
      f.svc.join(newcomer.hash, rotated.code!.toLowerCase().replace(/(.{4})/, '$1-'), 'Late').me.status,
    ).toBe('pending');
    f.run(f.host.hash, { type: 'rematch' });
    expect(f.svc.archives(f.room.id, f.host.hash)).toHaveLength(1);
    const expiry = f.svc.view(f.room.id, f.host.hash).expiresAt;
    f.advance(10000);
    f.svc.view(f.room.id, f.host.hash);
    expect(f.svc.view(f.room.id, f.host.hash).expiresAt).toBe(expiry);
    f.advance(31 * 86400000);
    expect(() => f.svc.view(f.room.id, f.host.hash)).toThrow(/expired/);
    f.svc.cleanup();
    expect(f.db.prepare('SELECT * FROM receipts').all()).toHaveLength(0);
  });
  it('renews only live sessions, and new identity cannot regain a lost host', () => {
    const f = fixture();
    const before = f.host.expiresAt;
    f.advance(10000);
    expect(f.svc.session(f.host.token, false).expiresAt).toBeGreaterThan(before);
    f.advance(91 * 86400000);
    expect(() => f.svc.session(f.host.token, false)).toThrow(/expired/);
    const replacement = f.svc.session(f.host.token, true);
    expect(replacement.token).not.toBe(f.host.token);
    expect(() => f.svc.member(f.room.id, hash(replacement.token))).toThrow(/access/);
  });
  it.each(['expired', 'revoked'])('updates remaining guests when a %s session frees a seat', (reason) => {
    const f = fixture();
    f.approve();
    f.run(f.guest.hash, { type: 'adjust', playerId: f.room.seats[0].id, field: 'life', delta: -1 });
    const before = f.svc.view(f.room.id, f.host.hash);
    const updatedAt = f.svc.recent(f.host.hash)[0].updatedAt;
    expect(before.undoRoomRevision).toBe(before.revision);
    const stale = f.envelope(f.host.hash, {
      type: 'set',
      playerId: f.room.seats[1].id,
      field: 'life',
      value: 55,
    });
    f.advance(10_000);
    if (reason === 'expired')
      f.db.prepare('UPDATE sessions SET expires_at=? WHERE hash=?').run(f.svc.now(), f.guest.hash);
    else f.db.prepare('UPDATE sessions SET revoked=1 WHERE hash=?').run(f.guest.hash);
    const changes: string[] = [];
    f.svc.onChange = (roomId) => {
      changes.push(roomId);
      // Notifications must observe the committed removal, never its old seat.
      const current = f.svc.view(roomId, f.host.hash);
      expect(current.seats[0].taken).toBe(false);
      expect(current.revision).toBe(before.revision + 1);
      expect(current.undoRoomRevision).toBeUndefined();
    };
    f.svc.cleanup();
    expect(changes).toEqual([f.room.id]);
    const after = f.svc.view(f.room.id, f.host.hash);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.undoRoomRevision).toBeUndefined();
    expect(after.game).toEqual(before.game);
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(f.svc.recent(f.host.hash)[0].updatedAt).toBe(updatedAt);
    expect(after.members.some((m) => m.id === f.g.me.id)).toBe(false);
    expect(after.seats[1].taken).toBe(true);
    expect(f.svc.view(f.room.id, f.other.hash).seats[0].taken).toBe(false);
    expect(f.svc.execute(f.host.hash, stale).receipt).toMatchObject({
      ok: false,
      revision: after.revision,
      error: expect.stringMatching(/room changed/i),
    });
    expect(f.run(f.host.hash, { type: 'undo' }).receipt.error).toMatch(/intervening change/i);
    expect(f.svc.view(f.room.id, f.host.hash).game).toEqual(before.game);
    f.svc.cleanup();
    expect(changes).toEqual([f.room.id]);
    expect(f.svc.view(f.room.id, f.host.hash).revision).toBe(after.revision);
  });
  it('retains a receipt after process restart and beyond bounded history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-room-'));
    close.push(() => rmSync(dir, { recursive: true, force: true }));
    const f = fixture(join(dir, 'rooms.sqlite'));
    const env = f.envelope(f.host.hash, {
      type: 'adjust',
      playerId: f.room.me.seatId!,
      field: 'life',
      delta: -1,
    });
    const first = f.svc.execute(f.host.hash, env);
    for (let i = 0; i < 205; i++)
      f.run(f.host.hash, {
        type: 'adjust',
        playerId: f.room.me.seatId!,
        field: 'life',
        delta: i % 2 === 0 ? 1 : -1,
      });
    expect(f.svc.view(f.room.id, f.host.hash).game!.history).toHaveLength(200);
    f.db.close();
    const db = openDatabase(join(dir, 'rooms.sqlite'));
    close.push(() => {
      db.close();
    });
    const svc = new RoomService(db, config, () => 1_800_000_000_000);
    expect(svc.execute(f.host.hash, env).receipt).toEqual(first.receipt);
    expect(svc.view(f.room.id, f.host.hash).game!.players[f.room.me.seatId!].life).toBe(40);
  });
  it('converges across eight guests and preserves the same recorded dice result', () => {
    const f = fixture(':memory:', 8);
    f.run(f.host.hash, { type: 'release', memberId: f.room.me.id });
    const users = [f.guest, f.other, ...Array.from({ length: 6 }, f.session)];
    users.forEach((s, i) => {
      const view = f.svc.join(s.hash, f.room.code!, `Guest ${i}`);
      f.run(f.host.hash, {
        type: 'approve',
        memberId: view.me.id,
        playerId: f.room.seats[i].id,
        replace: false,
      });
    });
    const base = f.svc.view(f.room.id, f.host.hash).revision;
    users.forEach((s, i) =>
      expect(
        f.run(s.hash, { type: 'adjust', playerId: f.room.seats[i].id, field: 'life', delta: -i - 1 }, base)
          .receipt.ok,
      ).toBe(true),
    );
    f.run(users[0].hash, { type: 'roll', kind: 'dice', count: 20, sides: 100 });
    const expected = f.svc.view(f.room.id, f.host.hash).game;
    users.forEach((s) => expect(f.svc.view(f.room.id, s.hash).game).toEqual(expected));
    expect(expected!.rolls[0].values).toHaveLength(20);
  });
});
describe('HTTP session and deployment boundaries', () => {
  it('rejects cross-origin writes and missing CSRF, issues hashed HttpOnly sessions and no-store responses', async () => {
    const { app, db } = await buildApp({ config, filename: ':memory:' });
    close.push(() => app.close());
    const headers = { origin: config.publicOrigin, 'x-mtg-client': '1' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { ...headers, origin: 'https://evil.example' },
          payload: { reset: false },
        })
      ).statusCode,
    ).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/api/session', headers, payload: { reset: false } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies[0];
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(cookie.domain).toBeUndefined();
    expect(cookie.secure).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = db.prepare('SELECT * FROM sessions').all();
    expect(JSON.stringify(rows)).not.toContain(cookie.value);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { ...headers, cookie: `mtg_guest=${cookie.value}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { ...headers, 'x-csrf-token': res.json().csrf, cookie: `mtg_guest=${cookie.value}` },
          payload: { name: 'Host', game: createGame(defaultSetup(), randomUUID, 0) },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/rooms' })).statusCode).toBe(401);
    const recent = await app.inject({
      method: 'GET',
      url: '/api/rooms',
      headers: { cookie: `mtg_guest=${cookie.value}` },
    });
    expect(recent.statusCode).toBe(200);
    expect(recent.headers['cache-control']).toBe('no-store');
    expect(recent.json()).toHaveLength(1);
    expect(recent.json()[0]).not.toHaveProperty('game');
    expect(recent.json()[0]).not.toHaveProperty('code');
  });
  it('sets Secure on HTTPS and fails contradictory origin/cookie configuration', async () => {
    expect(() => readConfig({ PUBLIC_ORIGIN: 'http://lan:8080' })).toThrow(/HTTP requires/);
    expect(() => readConfig({ PUBLIC_ORIGIN: 'https://table.example', ALLOW_INSECURE_HTTP: 'true' })).toThrow(
      /false/,
    );
    const secure = readConfig({
      PUBLIC_ORIGIN: 'https://table.example',
      ALLOW_INSECURE_HTTP: 'false',
      TRUST_PROXY_HOPS: '1',
    });
    const { app } = await buildApp({ config: secure, filename: ':memory:' });
    close.push(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin: secure.publicOrigin, 'x-mtg-client': '1' },
      payload: { reset: false },
    });
    expect(result.cookies[0].secure).toBe(true);
  });
});
