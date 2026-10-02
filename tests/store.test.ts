import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, defaultSetup, reduceGame } from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import type { Command, Game, RoomView } from '../src/shared/schema.js';
import { Repository } from '../src/client/storage/repository.js';

let store: typeof import('../src/client/app/store.js');
const readers: Repository[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(1_800_000_000_000);
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('dispatchEvent', vi.fn());
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  store = await import('../src/client/app/store.js');
  store.repository.databaseName = `store-test-${newId()}`;
  await store.repository.open();
});

afterEach(() => {
  store.repository.db?.close();
  for (const reader of readers.splice(0)) reader.db?.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connectedRoom(recovery = false) {
  const game = createGame(defaultSetup(2), newId, Date.now());
  const member = {
    id: newId(),
    name: 'Alex',
    seatId: game.order[0],
    requestedSeat: null,
    status: 'approved' as const,
  };
  const room: RoomView = {
    protocolVersion: 1,
    id: newId(),
    revision: 7,
    gameId: game.id,
    hostId: member.id,
    me: member,
    members: [member],
    seats: game.order.map((id) => ({ id, name: game.players[id].name, taken: id === member.seatId })),
    locked: false,
    everyoneEdits: false,
    expiresAt: Date.now() + 86_400_000,
    retentionDays: 1,
    serverTime: Date.now() + 120_000,
    game,
  };
  const send = vi.fn(async () => {}),
    disconnect = vi.fn();
  store.registerRoom(send, disconnect);
  store.useApp.setState({
    ready: true,
    mode: 'room',
    room,
    game,
    confirmed: game,
    screen: 'board',
    connected: true,
    readOnly: true,
    recovery,
    pending: 3,
    unresolved: ['A previous room action needs review.'],
    clockOffset: 120_000,
    error: recovery ? 'Saved data needs recovery.' : '',
  });
  await store.updateProfile({ lastMode: 'room', roomId: room.id });
  return { room, send, disconnect };
}

async function corruptActive() {
  const raw = {
    game: { schemaVersion: 99, preserved: 'unreadable save' },
    owner: newId(),
    until: Date.now() + 18_000,
  };
  await store.repository.put('active', raw);
  await expect(store.repository.active()).rejects.toThrow(/damaged|newer/);
  expect(store.repository.corrupt).toEqual(raw);
  return raw;
}

async function reopenedStorage() {
  const reader = new Repository(newId(), store.repository.databaseName);
  readers.push(reader);
  await reader.open();
  return reader;
}

function expectLocal(game: Game) {
  expect(store.useApp.getState()).toMatchObject({
    ready: true,
    mode: 'local',
    game,
    confirmed: game,
    localGame: game,
    screen: 'board',
    room: undefined,
    connected: false,
    readOnly: false,
    pending: 0,
    clockOffset: 0,
    unresolved: [],
    profile: { lastMode: 'local' },
  });
}

describe('shared-room seat controls', () => {
  it('allows only the assigned seat for hosts and guests, even with an old everyone-edits setting', async () => {
    const { room } = await connectedRoom();
    store.useApp.setState({ readOnly: false, pending: 0 });
    expect(store.canEdit(room.me.seatId!)).toBe(true);
    expect(store.canEdit(room.game!.order[1])).toBe(false);
    store.useApp.setState({ room: { ...room, everyoneEdits: true, hostId: newId() } });
    expect(store.canEdit(room.me.seatId!)).toBe(true);
    expect(store.canEdit(room.game!.order[1])).toBe(false);
    store.useApp.setState({ connected: false });
    expect(store.canEdit(room.me.seatId!)).toBe(false);
  });

  it('keeps cross-seat player saves and group effects from being submitted', async () => {
    const { room } = await connectedRoom();
    const save = vi.fn(async () => true);
    store.registerRoom(
      vi.fn(async () => {}),
      vi.fn(),
      save,
    );
    store.useApp.setState({ readOnly: false, pending: 0 });
    expect(
      await store.savePlayer({
        type: 'editPlayer',
        playerId: room.game!.order[1],
        name: 'Someone else',
        color: 'teal',
        commanders: [],
      }),
    ).toBe(false);
    expect(
      await store.saveGroupLife(
        {
          type: 'groupLife',
          casterId: room.me.seatId!,
          targetIds: [room.game!.order[1]],
          loss: 3,
        },
        {
          gameId: room.gameId,
          revision: room.game!.revision,
          mode: 'room',
          roomId: room.id,
          roomRevision: room.revision,
        },
      ),
    ).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('reviewed group life changes', () => {
  async function effect() {
    await store.startLocal(defaultSetup(4));
    const original = store.useApp.getState().confirmed!;
    const command: Extract<Command, { type: 'groupLife' }> = {
      type: 'groupLife',
      casterId: original.order[1],
      targetIds: original.order.filter((id) => id !== original.order[1]),
      loss: 3,
    };
    const review = { gameId: original.id, revision: original.revision, mode: 'local' as const };
    return { original, command, review };
  }

  it('waits for durable storage, protects the caster and rejects a duplicate submission of the same review', async () => {
    const { original, command, review } = await effect();
    const actualCommit = store.repository.commit.bind(store.repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = vi.spyOn(store.repository, 'commit').mockImplementationOnce(async (...args) => {
      await gate;
      await actualCommit(...args);
    });
    const first = store.saveGroupLife(command, review);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    const duplicate = store.saveGroupLife(command, review);
    expect(store.useApp.getState().confirmed).toEqual(original);
    release();
    expect(await first).toBe(true);
    expect(await duplicate).toBe(false);
    const saved = (await (await reopenedStorage()).active()).game!;
    expect(saved.players[command.casterId].life).toBe(40);
    for (const id of command.targetIds) expect(saved.players[id].life).toBe(37);
    expect(saved.undo).toHaveLength(1);
    await store.act({ type: 'undo' });
    expect(store.useApp.getState().confirmed!.players).toEqual(original.players);
  });

  it('keeps every total intact after storage failure and permits a confirmed retry', async () => {
    const { original, command, review } = await effect();
    vi.spyOn(store.repository, 'commit').mockRejectedValueOnce(
      new DOMException('Storage is full', 'QuotaExceededError'),
    );
    expect(await store.saveGroupLife({ ...command, gain: 7 }, review)).toBe(false);
    expect(store.useApp.getState().confirmed).toEqual(original);
    expect((await store.repository.active()).game).toEqual(original);
    expect(await store.saveGroupLife({ ...command, gain: 7 }, review)).toBe(true);
    expect(store.useApp.getState().confirmed!.players[command.casterId].life).toBe(47);
  });

  it('rejects an old preview after a total changes or a different game opens', async () => {
    const { original, command, review } = await effect();
    await store.act({ type: 'adjust', playerId: command.targetIds[0], field: 'life', delta: -1 });
    const current = store.useApp.getState().confirmed;
    expect(await store.saveGroupLife(command, review)).toBe(false);
    expect(store.useApp.getState().confirmed).toEqual(current);
    await store.startLocal(defaultSetup(4));
    expect(await store.saveGroupLife(command, review)).toBe(false);
    expect(store.useApp.getState().confirmed!.id).not.toBe(original.id);
    expect(
      Object.values(store.useApp.getState().confirmed!.players).every((player) => player.life === 40),
    ).toBe(true);
  });
});

describe('local game transitions and recovery', () => {
  it('confirms a unified player save only after its durable commit finishes', async () => {
    await store.startLocal(defaultSetup(2));
    const original = store.useApp.getState().game!;
    const playerId = original.order[0];
    const command: Extract<Command, { type: 'editPlayer' }> = {
      type: 'editPlayer',
      playerId,
      name: 'Rowan',
      color: 'teal',
      commanders: Object.values(original.commanders)
        .filter((c) => c.ownerId === playerId)
        .map((c) => ({ id: c.id, label: 'A new commander' })),
    };
    const actualCommit = store.repository.commit.bind(store.repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = vi.spyOn(store.repository, 'commit').mockImplementationOnce(async (...args) => {
      await gate;
      await actualCommit(...args);
    });
    const saved = vi.fn();
    const saving = store.savePlayer(command).then((result) => {
      saved(result);
      return result;
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(saved).not.toHaveBeenCalled();
    expect(store.useApp.getState().game).toEqual(original);
    release();
    expect(await saving).toBe(true);
    const reader = await reopenedStorage();
    const game = (await reader.active()).game!;
    expect(game.players[playerId]).toMatchObject({ name: 'Rowan', color: 'teal' });
    expect(game.commanders[command.commanders[0].id].label).toBe('A new commander');
    expect(game.revision).toBe(original.revision + 1);
    expect(game.undo).toHaveLength(1);
  });

  it('returns false on a rejected local write without losing the original or poisoning subsequent saves', async () => {
    await store.startLocal(defaultSetup(2));
    const original = store.useApp.getState().game!;
    const playerId = original.order[0];
    const command: Extract<Command, { type: 'editPlayer' }> = {
      type: 'editPlayer',
      playerId,
      name: 'Rowan',
      color: 'teal',
      commanders: Object.values(original.commanders)
        .filter((c) => c.ownerId === playerId)
        .map((c) => ({ id: c.id, label: 'A new commander' })),
    };
    vi.spyOn(store.repository, 'commit').mockRejectedValueOnce(
      new DOMException('Storage is full', 'QuotaExceededError'),
    );
    expect(await store.savePlayer(command)).toBe(false);
    expect(store.useApp.getState().game).toEqual(original);
    expect((await store.repository.active()).game).toEqual(original);
    expect(store.useApp.getState().error).toContain('Storage is full');
    expect(await store.savePlayer(command)).toBe(true);
    expect((await store.repository.active()).game!.players[playerId].name).toBe('Rowan');
  });

  it('does not report a room player save as successful without an acknowledgement sender', async () => {
    const { room, send } = await connectedRoom();
    store.useApp.setState({ readOnly: false });
    const playerId = room.game!.order[0];
    const command: Extract<Command, { type: 'editPlayer' }> = {
      type: 'editPlayer',
      playerId,
      name: 'Rowan',
      color: 'teal',
      commanders: Object.values(room.game!.commanders)
        .filter((c) => c.ownerId === playerId)
        .map((c) => ({ id: c.id, label: c.label })),
    };
    expect(await store.savePlayer(command)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(store.useApp.getState().error).toMatch(/Reconnect/);
  });
  it('restores a durable checkpoint and disconnects the room before local play continues', async () => {
    const checkpoint = createGame(defaultSetup(), newId, Date.now());
    checkpoint.players[checkpoint.order[0]].life = 27;
    await store.repository.commit(checkpoint, undefined, true);
    const next = reduceGame(
      checkpoint,
      { type: 'adjust', playerId: checkpoint.order[0], field: 'life', delta: -1 },
      { id: newId(), operationId: newId(), actorId: 'test', actor: 'Alex', now: Date.now() },
    );
    await store.repository.commit(next, checkpoint);
    await corruptActive();
    const room = await connectedRoom(true);

    await store.recoverCheckpoint();

    expectLocal(checkpoint);
    expect(store.useApp.getState()).toMatchObject({ recovery: false, error: '' });
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(store.repository.corrupt).toBeUndefined();
    const reader = await reopenedStorage();
    expect((await reader.active()).game).toEqual(checkpoint);
    expect((await reader.profile()).lastMode).toBe('local');
    // New input must save to the restored game instead of the old room sender.
    await store.act({ type: 'adjust', playerId: checkpoint.order[0], field: 'life', delta: -1 });
    expect(room.send).not.toHaveBeenCalled();
    expect((await reader.active()).game!.players[checkpoint.order[0]].life).toBe(26);
  });

  it('keeps recovery available after a failed fresh start and preserves the original on a successful retry', async () => {
    const original = await corruptActive();
    const room = await connectedRoom(true);
    const before = store.useApp.getState();
    const commit = vi.spyOn(store.repository, 'commit').mockRejectedValueOnce(new Error('Storage is full'));

    await expect(store.startFreshAfterRecovery()).rejects.toThrow('Storage is full');

    expect(store.useApp.getState()).toEqual(before);
    expect(store.repository.corrupt).toEqual(original);
    expect(await store.repository.get('active')).toEqual(original);
    expect(room.disconnect).not.toHaveBeenCalled();
    commit.mockRestore();

    await store.startFreshAfterRecovery();

    const game = store.useApp.getState().game!;
    expectLocal(game);
    expect(game.id).not.toBe(room.room.gameId);
    expect(game.order).toHaveLength(4);
    expect(game.order.map((id) => game.players[id].life)).toEqual([40, 40, 40, 40]);
    expect(store.useApp.getState()).toMatchObject({ recovery: false, error: '' });
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(store.repository.corrupt).toBeUndefined();
    const reader = await reopenedStorage();
    expect(await reader.get(`recovery:${Date.now()}`)).toEqual(original);
    expect((await reader.active()).game).toEqual(game);
    expect((await reader.profile()).lastMode).toBe('local');
  });

  it.each(['start', 'resume'])('clears shared room state when local play is %s', async (transition) => {
    const saved = createGame(defaultSetup(), newId, Date.now());
    saved.players[saved.order[0]].life = 33;
    await store.repository.commit(saved, undefined, true);
    const room = await connectedRoom();

    if (transition === 'start') await store.startLocal(defaultSetup(1, false));
    else await store.resumeLocal();

    const game = store.useApp.getState().game!;
    expectLocal(game);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    if (transition === 'resume') expect(game).toEqual(saved);
    else {
      expect(game.id).not.toBe(saved.id);
      expect(game.order).toHaveLength(1);
      expect(game.players[game.order[0]].life).toBe(20);
    }
    const reader = await reopenedStorage();
    expect((await reader.active()).game).toEqual(game);
    expect((await reader.profile()).lastMode).toBe('local');
  });
});
