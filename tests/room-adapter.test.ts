import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Envelope, RoomView } from '../src/shared/schema.js';
import { newId } from '../src/shared/random.js';
import { createGame, defaultSetup, reduceGame } from '../src/shared/game.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('../src/client/app/store.js');
});

async function liveRoom() {
  vi.useFakeTimers();
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('dispatchEvent', vi.fn());
  vi.stubGlobal('location', { href: 'https://table.example/' });
  const game = createGame(defaultSetup(2), newId, Date.now());
  const member = {
    id: newId(),
    name: 'Alex',
    status: 'approved' as const,
    seatId: game.order[0],
    requestedSeat: null,
  };
  const room: RoomView = {
    protocolVersion: 1,
    id: newId(),
    revision: 10,
    gameId: game.id,
    hostId: member.id,
    me: member,
    members: [member],
    seats: game.order.map((id) => ({ id, name: game.players[id].name, taken: id === member.seatId })),
    locked: false,
    everyoneEdits: false,
    expiresAt: Date.now() + 86_400_000,
    retentionDays: 1,
    serverTime: Date.now(),
    game,
  };
  const state = {
    mode: 'room' as 'room' | 'local',
    room,
    game,
    confirmed: game,
    connected: false,
    pending: 0,
    screen: 'board',
    clockOffset: 0,
    readOnly: false,
    unresolved: [] as string[],
    error: '',
  };
  let persisted: Envelope[] = [];
  const repository = {
    pending: async () => structuredClone(persisted),
    savePending: vi.fn(async (_id: string, envelopes: Envelope[]) => {
      persisted = structuredClone(envelopes);
    }),
    saveRoom: vi.fn(async () => {}),
  };
  let savePlayer: (
    command: Extract<Command, { type: 'editPlayer' | 'groupLife' }>,
  ) => Promise<boolean> = async () => false;
  let disconnect = () => {};
  vi.doMock('../src/client/app/store.js', () => ({
    useApp: {
      getState: () => state,
      setState: (patch: Partial<typeof state> | ((current: typeof state) => Partial<typeof state>)) =>
        Object.assign(state, typeof patch === 'function' ? patch(state) : patch),
    },
    repository,
    registerRoom: (_send: unknown, stop: () => void, confirmed: typeof savePlayer) => {
      disconnect = stop;
      savePlayer = confirmed;
    },
    updateProfile: vi.fn(),
    report: (error: Error) => {
      state.error = error.message;
    },
    errorMessage: (error: Error) => error.message,
    notify: vi.fn(),
  }));
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    send = vi.fn<(data: string) => void>();
    constructor() {
      Socket.instances.push(this);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    emit(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/session') return Response.json({ csrf: 'test', serverTime: Date.now() });
    if (path === `/api/rooms/${room.id}`) return Response.json(room);
    if (path === `/api/rooms/${room.id}/command`) {
      const env = JSON.parse(String(init?.body)) as Envelope;
      return Response.json({
        receipt: {
          operationId: env.operationId,
          gameId: game.id,
          revision: room.revision,
          ok: false,
          error: 'Review the pending save.',
        },
        view: room,
      });
    }
    return Response.json({ error: 'Unexpected request' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  const { connectRoom } = await import('../src/client/adapters/room.js');
  await connectRoom(room.id);
  const socket = Socket.instances[0];
  socket.emit({ type: 'ready', view: room });
  const command: Extract<Command, { type: 'editPlayer' }> = {
    type: 'editPlayer',
    playerId: game.order[0],
    name: 'Rowan',
    color: 'teal',
    commanders: Object.values(game.commanders)
      .filter((c) => c.ownerId === game.order[0])
      .map((c) => ({ id: c.id, label: 'New commander' })),
  };
  const submitted = async () => {
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    return (JSON.parse(socket.send.mock.calls[0][0]) as { envelope: Envelope }).envelope;
  };
  return { state, room, command, socket, repository, fetch, savePlayer, disconnect, submitted };
}

describe('confirmed player saves in shared rooms', () => {
  it('rejects group effects and other-seat edits before previewing or sending them', async () => {
    const f = await liveRoom();
    const before = f.state.confirmed;
    expect(
      await f.savePlayer({
        type: 'groupLife',
        casterId: before.order[0],
        targetIds: [before.order[1]],
        loss: 4,
        gain: 2,
      }),
    ).toBe(false);
    expect(await f.savePlayer({ ...f.command, playerId: before.order[1] })).toBe(false);
    expect(f.socket.send).not.toHaveBeenCalled();
    expect(await f.repository.pending()).toEqual([]);
    expect(f.state.game).toEqual(before);
    expect(f.state.confirmed).toEqual(before);
  });
  it('waits for the matching successful receipt, even after a new snapshot arrives', async () => {
    const f = await liveRoom();
    const completed = vi.fn();
    const saving = f.savePlayer(f.command).then((saved) => {
      completed(saved);
      return saved;
    });
    const env = await f.submitted();
    expect(completed).not.toHaveBeenCalled();
    expect(await f.repository.pending()).toEqual([env]);
    const game = reduceGame(f.room.game!, f.command, {
      id: newId(),
      operationId: env.operationId,
      actorId: f.room.me.id,
      actor: 'Alex',
      now: Date.now(),
    });
    const view = { ...f.room, revision: f.room.revision + 1, game };
    f.socket.emit({ type: 'state', view });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    f.socket.emit({
      type: 'ack',
      receipt: { operationId: env.operationId, gameId: game.id, revision: view.revision, ok: true },
      view,
    });
    expect(await saving).toBe(true);
    expect(f.state.confirmed.players[f.command.playerId].name).toBe('Rowan');
    expect(f.state.pending).toBe(0);
  });

  it('returns false on server rejection and keeps the confirmed player unchanged', async () => {
    const f = await liveRoom();
    const saving = f.savePlayer(f.command);
    const env = await f.submitted();
    f.socket.emit({
      type: 'ack',
      receipt: {
        operationId: env.operationId,
        gameId: f.room.gameId,
        revision: f.room.revision,
        ok: false,
        error: 'That player belongs to another guest.',
      },
      view: f.room,
    });
    expect(await saving).toBe(false);
    expect(f.state.game).toEqual(f.room.game);
    expect(f.state.error).toMatch(/another guest/);
  });

  it('returns false when changing rooms and ignores late acknowledgements from the old socket', async () => {
    const f = await liveRoom();
    const saving = f.savePlayer(f.command);
    const env = await f.submitted();
    f.disconnect();
    f.state.mode = 'local';
    expect(await saving).toBe(false);
    f.socket.emit({
      type: 'ack',
      receipt: { operationId: env.operationId, gameId: f.room.gameId, revision: f.room.revision, ok: true },
      view: f.room,
    });
    expect(f.state.mode).toBe('local');
    expect(f.state.game).toEqual(f.room.game);
    expect(await f.repository.pending()).toEqual([env]);
  });

  it('never sends or reports success when the pending recovery record cannot be saved', async () => {
    const f = await liveRoom();
    f.repository.savePending.mockRejectedValueOnce(new DOMException('Storage is full', 'QuotaExceededError'));
    expect(await f.savePlayer(f.command)).toBe(false);
    expect(f.socket.send).not.toHaveBeenCalled();
    expect(f.state.error).toMatch(/not sent/);
    expect(f.state.game).toEqual(f.room.game);
  });

  it('times out without false success and reconciles the original operation after reconnecting', async () => {
    const f = await liveRoom();
    const saving = f.savePlayer(f.command);
    const env = await f.submitted();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await saving).toBe(false);
    expect(
      f.fetch.mock.calls.some(
        ([path, init]) =>
          path.endsWith('/command') && JSON.parse(String(init?.body)).operationId === env.operationId,
      ),
    ).toBe(true);
    expect(f.state.game).toEqual(f.room.game);
  });
});

describe('room reconnection cancellation', () => {
  it('does not reopen a room or submit its saved actions after switching to local play during storage loading', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('dispatchEvent', vi.fn());
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/session') return Response.json({ csrf: 'test', serverTime: Date.now() });
      return Response.json({ error: 'Unexpected stale room request' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const readStarted = deferred<void>();
    const saved = deferred<Envelope[]>();
    const state = { mode: 'room', connected: false, pending: 0 };
    let disconnect = () => {};
    vi.doMock('../src/client/app/store.js', () => ({
      useApp: {
        getState: () => state,
        setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
      },
      repository: {
        pending: () => {
          readStarted.resolve();
          return saved.promise;
        },
      },
      registerRoom: (_send: unknown, stop: () => void) => {
        disconnect = stop;
      },
      updateProfile: vi.fn(),
      report: vi.fn(),
      errorMessage: (error: Error) => error.message,
      notify: vi.fn(),
    }));
    const { connectRoom } = await import('../src/client/adapters/room.js');
    const roomId = newId();
    const connecting = connectRoom(roomId);
    await readStarted.promise;
    disconnect();
    state.mode = 'local';
    saved.resolve([
      {
        protocolVersion: 1,
        roomId,
        gameId: newId(),
        operationId: newId(),
        baseRevision: 0,
        command: { type: 'adjust', playerId: newId(), field: 'life', delta: -1 },
      },
    ]);
    await connecting;
    expect(state.mode).toBe('local');
    expect(state.pending).toBe(0);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/session']);
  });
});
