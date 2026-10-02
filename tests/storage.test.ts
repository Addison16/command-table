import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { Repository, gameExport, parseImport } from '../src/client/storage/repository.js';
import { createGame, defaultSetup, reduceGame, GAME_RECOVERY_MS } from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import type { RoomView } from '../src/shared/schema.js';

function roomView(): RoomView {
  const game = createGame(defaultSetup(), newId, Date.now());
  const member = {
    id: newId(),
    name: 'Alex',
    seatId: null,
    requestedSeat: null,
    status: 'approved' as const,
  };
  return {
    protocolVersion: 1,
    id: newId(),
    revision: 0,
    gameId: game.id,
    hostId: member.id,
    me: member,
    members: [member],
    seats: game.order.map((id) => ({ id, name: game.players[id].name, taken: false })),
    locked: false,
    everyoneEdits: false,
    expiresAt: Date.now() + 60_000,
    retentionDays: 7,
    serverTime: Date.now(),
    game,
  };
}

describe('local transactions and recovery', () => {
  it('handles an aborted save without leaking a rejection or partially committing, then retries', async () => {
    const repository = new Repository('a', newId());
    await repository.open();
    const original = createGame(defaultSetup(), newId, 1000);
    await repository.commit(original, undefined, true);
    const changed = reduceGame(
      original,
      { type: 'customize', playerId: original.order[0], name: 'Retry Rowan', color: 'teal' },
      { id: newId(), operationId: newId(), actorId: 'a', actor: 'Alex', now: 2000 },
    );
    const put = IDBObjectStore.prototype.put;
    let fail = true;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = put.call(this, value, key);
      if (this.name === 'records' && key === 'active' && fail) {
        fail = false;
        this.transaction.abort();
      }
      return request;
    });
    try {
      await expect(repository.commit(changed, original)).rejects.toMatchObject({ name: 'AbortError' });
      expect((await repository.active()).game).toEqual(original);
      expect(await repository.checkpoint()).toBeUndefined();
      await repository.commit(changed, original);
      expect((await repository.active()).game).toEqual(changed);
      expect(await repository.checkpoint()).toEqual(original);
    } finally {
      fault.mockRestore();
    }
  });
  it('keeps both recent rooms when two tabs save their snapshots together', async () => {
    const a = new Repository('a', newId());
    const b = new Repository('b', a.databaseName);
    await a.open();
    await b.open();
    const first = roomView();
    const second = roomView();
    await Promise.all([a.saveRoom(first), b.saveRoom(second)]);
    expect((await a.recentRooms()).map((room) => room.id).sort()).toEqual([first.id, second.id].sort());
    expect(await a.get(`room:${first.id}`)).toEqual(first);
    expect(await a.get(`room:${second.id}`)).toEqual(second);
  });
  it('does not replace a newer saved room with a delayed snapshot from another tab', async () => {
    const a = new Repository('a', newId());
    const b = new Repository('b', a.databaseName);
    await a.open();
    await b.open();
    const old = roomView();
    const fresh = structuredClone(old);
    fresh.revision = 1;
    fresh.seats[0].name = 'Renamed player';
    fresh.game!.players[fresh.seats[0].id].name = fresh.seats[0].name;
    fresh.game!.revision = 1;
    await a.saveRoom(fresh);
    await b.saveRoom(old);
    expect(await a.get(`room:${old.id}`)).toEqual(fresh);
    expect((await a.recentRooms())[0].names[0]).toBe('Renamed player');
  });
  it('does not restore archived games deleted concurrently in different tabs', async () => {
    const a = new Repository('a', newId());
    const b = new Repository('b', a.databaseName);
    await a.open();
    await b.open();
    const first = createGame(defaultSetup(), newId, 1000);
    const second = createGame(defaultSetup(), newId, 2000);
    const current = createGame(defaultSetup(), newId, 3000);
    for (const game of [first, second, current]) await a.commit(game, undefined, true);
    await Promise.all([a.deleteArchive(first.id), b.deleteArchive(second.id)]);
    expect(await a.archive()).toEqual([]);
    expect(await a.recentLocal()).toEqual([current]);
  });
  it('keeps an ended game through a new game and reload, respects leases, and expires recovery', async () => {
    let now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const a = new Repository('a', newId());
      await a.open();
      const game = createGame(defaultSetup(), newId, now);
      const context = () => ({ id: newId(), operationId: newId(), now, actorId: 'a', actor: 'Alex' });
      const changed = reduceGame(
        game,
        { type: 'adjust', playerId: game.order[0], field: 'life', delta: -7 },
        context(),
      );
      await a.commit(changed, undefined, true);
      const ended = reduceGame(changed, { type: 'end' }, context());
      await a.commit(ended, changed);
      const second = createGame(defaultSetup(2, false), newId, now);
      await a.commit(second, undefined, true);
      const b = new Repository('b', a.databaseName);
      await b.open();
      expect(await b.recentEnded()).toEqual([ended]);
      await expect(b.reopenSaved(game.id, context())).rejects.toThrow(/Another tab/);
      now += 18001;
      const reopened = (await b.reopenSaved(game.id, context())).game!;
      expect(reopened.id).toBe(game.id);
      expect(reopened.players).toEqual(changed.players);
      expect(reopened.status).toBe('active');
      expect((await b.recentLocal()).some((g) => g.id === second.id)).toBe(true);
      expect(await b.recentEnded()).toEqual([]);
      const endedAgain = reduceGame(reopened, { type: 'end' }, context());
      await b.commit(endedAgain, reopened);
      now += GAME_RECOVERY_MS;
      expect(await b.recentEnded()).toEqual([]);
      await expect(b.reopenSaved(game.id, context())).rejects.toThrow(/24-hour/);
      expect((await b.active()).game).toEqual(endedAgain);
    } finally {
      clock.mockRestore();
    }
  });
  it('reads older display preferences without losing identity or manual seat flips', async () => {
    const a = new Repository('a', newId());
    await a.open();
    const profile = await a.profile();
    const legacy: Partial<typeof profile> = { ...profile, rotations: { seat: true } };
    delete legacy.tableLayout;
    delete legacy.autoTableLayout;
    delete legacy.rotationDefaultsVersion;
    delete legacy.theme;
    delete legacy.colorTheme;
    delete legacy.accentColor;
    delete legacy.tableFinish;
    await a.put('profile', legacy);
    expect(await a.profile()).toEqual({
      ...legacy,
      tableLayout: 'upright',
      autoTableLayout: true,
      rotationDefaultsVersion: 1,
      theme: 'system',
      colorTheme: 'classic',
      accentColor: 'theme',
      tableFinish: 'glow',
    });
    await a.put('profile', { ...legacy, tableLayout: 'shared', autoTableLayout: false });
    const migrated = await a.profile();
    expect(migrated.autoTableLayout).toBe(true);
    expect(migrated.rotations).toEqual({ seat: true });
    // A fixed layout selected after adopting the default remains an explicit
    // preference, including after reopening this browser's database.
    await a.put('profile', { ...migrated, autoTableLayout: false });
    const reopened = new Repository('b', a.databaseName);
    await reopened.open();
    expect((await reopened.profile()).tableLayout).toBe('shared');
    expect((await reopened.profile()).autoTableLayout).toBe(false);
    expect((await reopened.profile()).installationId).toBe(profile.installationId);
  });
  it('resumes the original unfinished game with its latest life, names, damage and history', async () => {
    const a = new Repository('a', newId());
    await a.open();
    const original = createGame(defaultSetup(), newId, 1000);
    const context = () => ({ id: newId(), operationId: newId(), actorId: 'a', actor: 'Alex', now: 2000 });
    let changed = reduceGame(
      original,
      {
        type: 'damage',
        playerId: original.order[0],
        commanderId: Object.values(original.commanders).find((entry) => entry.ownerId !== original.order[0])!
          .id,
        amount: 7,
        subtractLife: true,
      },
      context(),
    );
    changed = reduceGame(
      changed,
      { type: 'commanderName', commanderId: Object.keys(changed.commanders)[0], label: 'Atraxa' },
      context(),
    );
    await a.commit(changed, undefined, true);
    const second = createGame(defaultSetup(2, false), newId, 3000);
    await a.commit(second, undefined, true);
    expect((await a.recentLocal()).map((g) => g.id)).toEqual([second.id, original.id]);
    expect((await a.resumeSaved(original.id)).game).toEqual(changed);
    expect((await a.recentLocal()).map((g) => g.id)).toEqual([original.id, second.id]);
    const ended = reduceGame(changed, { type: 'end' }, context());
    await a.commit(ended, changed);
    expect((await a.recentLocal()).map((g) => g.id)).toEqual([second.id]);
    await a.resumeSaved(second.id);
    expect((await a.archive()).find((g) => g.id === original.id)?.status).toBe('ended');
  });
  it('bounds unfinished games, excludes rematched games, and respects another tab when resuming', async () => {
    const a = new Repository('a', newId());
    await a.open();
    for (let i = 0; i < 12; i++) await a.commit(createGame(defaultSetup(), newId, 1000 + i), undefined, true);
    const recent = await a.recentLocal();
    expect(recent).toHaveLength(10);
    const b = new Repository('b', a.databaseName);
    await b.open();
    await expect(b.resumeSaved(recent[1].id)).rejects.toThrow(/Another tab/);
    const olderArchive = (await a.archive()).at(-1)!;
    expect(recent.map((g) => g.id)).not.toContain(olderArchive.id);
    expect((await a.resumeSaved(olderArchive.id)).game!.id).toBe(olderArchive.id);
    await a.resumeSaved(recent[0].id);
    const rematch = reduceGame(
      recent[0],
      { type: 'rematch' },
      { id: newId(), operationId: newId(), actorId: 'a', actor: 'Alex', now: 3000, newGameId: newId() },
    );
    await a.commit(rematch, recent[0]);
    expect((await a.recentLocal()).some((g) => g.id === recent[0].id)).toBe(false);
    expect((await a.archive()).find((g) => g.id === recent[0].id)?.status).toBe('ended');
  });
  it('commits before reload and prevents stale writers and tab takeover races', async () => {
    const name = newId(),
      a = new Repository('a', name),
      b = new Repository('b', name);
    await a.open();
    await b.open();
    const g = createGame(defaultSetup(), newId, 1000);
    await a.commit(g, undefined, true);
    expect((await b.active()).readOnly).toBe(true);
    const next = reduceGame(
      g,
      { type: 'adjust', playerId: g.order[0], field: 'life', delta: -3 },
      { id: newId(), operationId: newId(), actorId: 'a', actor: 'Alex', now: 2000 },
    );
    await expect(b.commit(next, g)).rejects.toThrow(/Another tab/);
    await a.commit(next, g);
    expect((await b.active()).game!.players[g.order[0]].life).toBe(37);
    await b.commit(next, next, false, true);
    await expect(a.commit(next, g)).rejects.toThrow();
    expect((await a.checkpoint())!.revision).toBe(1);
  });
  it('preserves corrupt data, offers checkpoint, bounds archives and exports no profile', async () => {
    const a = new Repository('a', newId());
    await a.open();
    const g = createGame(defaultSetup(), newId, 1000);
    await a.commit(g, undefined, true);
    for (let i = 0; i < 12; i++)
      await a.commit(createGame(defaultSetup(2), newId, 2000 + i), undefined, true);
    expect(await a.archive()).toHaveLength(10);
    expect(parseImport(gameExport(g))).toEqual(g);
    expect(gameExport(g)).not.toContain('installationId');
    await a.put('active', { game: { schemaVersion: 99 }, owner: 'a', until: 0 });
    await expect(a.active()).rejects.toThrow(/damaged/);
    expect(await a.get('active')).toEqual({ game: { schemaVersion: 99 }, owner: 'a', until: 0 });
    expect(await a.checkpoint()).toBeDefined();
    expect(() => parseImport('{"format":"mtg-util-game","version":99}')).toThrow();
  });
});
