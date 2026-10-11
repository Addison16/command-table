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
    command: Extract<Command, { type: 'editPlayer' | 'groupLife' | 'set' | 'castSet' | 'damageSet' }>,
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

  it('refuses a malformed save before queuing or sending it', async () => {
    const f = await liveRoom();
    const invalid = {
      ...f.command,
      commanders: f.command.commanders.map((c) => ({ ...c, label: 'x'.repeat(101) })),
    };
    expect(await f.savePlayer(invalid)).toBe(false);
    expect(f.socket.send).not.toHaveBeenCalled();
    expect(f.repository.savePending).not.toHaveBeenCalled();
    expect(f.state.error).toMatch(/check your values/);
    expect(f.state.pending).toBe(0);
  });

  it('reconciles an unconfirmed save when the server answers with an error instead of a receipt', async () => {
    const f = await liveRoom();
    const saving = f.savePlayer(f.command);
    const env = await f.submitted();
    f.socket.emit({ type: 'error', error: 'Invalid socket command.' });
    expect(await saving).toBe(false);
    await vi.waitFor(() =>
      expect(
        f.fetch.mock.calls.some(
          ([path, init]) =>
            path.endsWith('/command') && JSON.parse(String(init?.body)).operationId === env.operationId,
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(f.state.pending).toBe(0));
    expect(await f.repository.pending()).toEqual([]);
  });
});

describe('saved actions the server will not record', () => {
  it.each([400, 409])('sets aside an action refused with %i and still reopens the room', async (status) => {
    const f = await liveRoom();
    const refused: Envelope = {
      protocolVersion: 1,
      roomId: f.room.id,
      gameId: f.room.gameId,
      operationId: newId(),
      baseRevision: f.room.revision,
      command: { type: 'adjust', playerId: f.room.me.seatId!, field: 'life', delta: -1 },
    };
    await f.repository.savePending(f.room.id, [refused]);
    f.fetch.mockClear();
    f.fetch
      .mockImplementationOnce(async () => Response.json({ csrf: 'test', serverTime: Date.now() }))
      .mockImplementationOnce(async () => Response.json({ error: 'Invalid request.' }, { status }));
    const { connectRoom } = await import('../src/client/adapters/room.js');
    await connectRoom(f.room.id);
    expect(f.fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/session',
      `/api/rooms/${f.room.id}/command`,
      `/api/rooms/${f.room.id}`,
    ]);
    expect(await f.repository.pending()).toEqual([]);
    expect(f.state.pending).toBe(0);
    expect(f.state.unresolved.at(-1)).toMatch(/set aside. Invalid request/);
    expect(f.state.error).not.toMatch(/Connection unavailable/);
  });

  it('keeps retrying an action when the server is only temporarily unable to answer', async () => {
    const f = await liveRoom();
    const waiting: Envelope = {
      protocolVersion: 1,
      roomId: f.room.id,
      gameId: f.room.gameId,
      operationId: newId(),
      baseRevision: f.room.revision,
      command: { type: 'adjust', playerId: f.room.me.seatId!, field: 'life', delta: -1 },
    };
    await f.repository.savePending(f.room.id, [waiting]);
    f.fetch
      .mockImplementationOnce(async () => Response.json({ csrf: 'test', serverTime: Date.now() }))
      .mockImplementationOnce(async () => Response.json({ error: 'Please retry.' }, { status: 500 }));
    const { connectRoom } = await import('../src/client/adapters/room.js');
    await connectRoom(f.room.id);
    expect(await f.repository.pending()).toEqual([waiting]);
    expect(f.state.pending).toBe(1);
    expect(f.state.error).toMatch(/Connection unavailable/);
  });
});

describe('room reconnection cancellation', () => {
  it('aborts a stalled connection when replacing it, and gives its replacement a deadline', async () => {
    const f = await liveRoom();
    const signals: AbortSignal[] = [];
    f.fetch.mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    const { connectRoom } = await import('../src/client/adapters/room.js');
    const old = connectRoom(f.room.id);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const replacement = connectRoom(f.room.id);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await old;
    await vi.advanceTimersByTimeAsync(10_000);
    await replacement;
    expect(signals[1].aborted).toBe(true);
    expect(f.state.error).toMatch(/timed out/);
    f.disconnect();
  });

  it('cancels a stalled fetch when leaving the room and keeps all saved operations', async () => {
    const f = await liveRoom();
    let signal!: AbortSignal;
    f.fetch.mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          signal = init!.signal!;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    const { connectRoom } = await import('../src/client/adapters/room.js');
    const waiting = connectRoom(f.room.id);
    await vi.waitFor(() => expect(signal).toBeDefined());
    f.disconnect();
    await waiting;
    expect(signal.aborted).toBe(true);
    expect(f.state.error).toBe('');
  });

  it.each(['set', 'castSet', 'damageSet'] as const)(
    'does not confirm an exact %s correction on rejection',
    async (type) => {
      const f = await liveRoom();
      const commander = Object.values(f.room.game!.commanders).find((c) => c.ownerId === f.room.me.seatId)!;
      const opponent = Object.values(f.room.game!.commanders).find((c) => c.ownerId !== f.room.me.seatId)!;
      const command =
        type === 'set'
          ? { type, playerId: f.room.me.seatId!, field: 'life', value: 17 }
          : type === 'castSet'
            ? { type, commanderId: commander.id, value: 3 }
            : { type, playerId: f.room.me.seatId!, commanderId: opponent.id, value: 9 };
      const saving = f.savePlayer(command);
      const envelope = await f.submitted();
      f.socket.emit({
        type: 'ack',
        receipt: {
          operationId: envelope.operationId,
          gameId: f.room.gameId,
          revision: f.room.revision,
          ok: false,
          error: 'Review the latest totals.',
        },
        view: f.room,
      });
      expect(await saving).toBe(false);
      expect(f.state.confirmed).toEqual(f.room.game);
      expect(f.state.error).toMatch(/latest totals/);
    },
  );

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
