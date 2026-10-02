import { commandSeat, createGame, isRelative, reduceGame } from '../../shared/game.js';
import { canUndoRoomAction } from '../../shared/permissions.js';
import { newId } from '../../shared/random.js';
import {
  PROTOCOL,
  recentRoomSchema,
  type AdminCommand,
  type Command,
  type Envelope,
  type Game,
  type Receipt,
  type RoomView,
  type Setup,
} from '../../shared/schema.js';
import {
  useApp,
  repository,
  registerRoom,
  updateProfile,
  report,
  errorMessage,
  notify,
} from '../app/store.js';

let csrf = '',
  socket: WebSocket | undefined,
  generation = 0,
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pending: Envelope[] = [],
  writing = Promise.resolve(),
  attempts = 0,
  lastPong = 0,
  activeRoom = '';
const confirmations = new Map<
  string,
  {
    roomId: string;
    gameId: string;
    finish: (saved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function finishConfirmation(operationId: string, saved: boolean) {
  const waiting = confirmations.get(operationId);
  if (!waiting) return;
  confirmations.delete(operationId);
  clearTimeout(waiting.timer);
  waiting.finish(saved);
}
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-MTG-Client': String(PROTOCOL),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? 'The server could not complete this action.', res.status);
  return data as T;
}
export function roomArchives(roomId: string) {
  return api<Game[]>(`/rooms/${roomId}/archives`);
}
export async function recentRooms() {
  // Read an existing guest session only. Local play never creates one.
  const rooms = recentRoomSchema.array().parse(await api('/rooms'));
  await repository.put('recentRooms', rooms);
  return rooms;
}
export async function resumeRoom(roomId: string, reopen = false) {
  const cached = await repository.get<RoomView>(`room:${roomId}`);
  disconnect();
  pending = [];
  useApp.setState({
    mode: 'room',
    room: cached,
    game: cached?.game,
    confirmed: cached?.game,
    screen: cached?.game ? 'board' : 'lobby',
    readOnly: false,
    pending: 0,
    error: '',
    unresolved: [],
  });
  await updateProfile({ lastMode: 'room', roomId });
  await connectRoom(roomId);
  if (reopen) {
    // connectRoom starts the socket; its ready frame arrives asynchronously.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        const state = useApp.getState();
        if (state.mode !== 'room' || state.room?.id !== roomId)
          finish(new Error('Room changed before it could be reopened.'));
        else if (state.connected) finish();
      };
      const unsubscribe = useApp.subscribe(check);
      const timer = setTimeout(
        () => finish(new Error('Reconnect to the room and try reopening it again.')),
        12000,
      );
      check();
    });
    await send({ type: 'reopen' });
  }
}
async function session(reset = false) {
  const start = Date.now();
  const s = await api<{ csrf: string; serverTime: number }>('/session', { reset });
  csrf = s.csrf;
  useApp.setState({ clockOffset: s.serverTime - (start + Date.now()) / 2 });
}
function persist() {
  const roomId = activeRoom,
    envelopes = [...pending];
  writing = writing.catch(() => {}).then(() => repository.savePending(roomId, envelopes));
  return writing;
}
function preview() {
  const state = useApp.getState();
  let game = state.confirmed;
  if (game)
    for (const env of pending) {
      if (env.gameId !== game.id || !['adjust', 'damage', 'cast'].includes(env.command.type)) continue;
      try {
        game = reduceGame(game, env.command as Command, {
          id: env.operationId,
          operationId: env.operationId,
          now: Date.now() + state.clockOffset,
          actorId: state.room!.me.id,
          actor: state.room!.me.name,
          groupId: env.groupId,
        });
      } catch {
        /* Server will account for rejected operations. */
      }
    }
  useApp.setState({ game, pending: pending.length });
}
function acceptView(view: RoomView, midpoint?: number) {
  const state = useApp.getState();
  if (view.protocolVersion !== PROTOCOL) {
    pause();
    report(new Error('This server uses a newer protocol. Update or reload this app.'));
    return;
  }
  if (
    state.mode !== 'room' ||
    view.id !== activeRoom ||
    (state.room?.id === view.id && state.room.revision > view.revision)
  )
    return;
  // Full snapshots converge immediately even across gaps; refresh HTTP state to repair clock/history too.
  if (!midpoint && state.connected && state.room?.id === view.id && view.revision > state.room.revision + 1) {
    const started = Date.now();
    void api<RoomView>(`/rooms/${view.id}`)
      .then((fresh) => acceptView(fresh, (started + Date.now()) / 2))
      .catch(report);
  }
  useApp.setState({
    room: view,
    confirmed: view.game,
    game: view.game,
    readOnly: false,
    screen:
      state.confirmed?.id === view.game?.id &&
      state.confirmed?.status === 'ended' &&
      view.game?.status === 'active'
        ? 'board'
        : state.screen === 'home'
          ? 'home'
          : view.game
            ? 'board'
            : 'lobby',
    ...(midpoint ? { clockOffset: view.serverTime - midpoint } : {}),
  });
  preview();
  void repository
    .saveRoom(view)
    .catch(() => report(new Error('The room is live, but its offline snapshot could not be saved.')));
}
async function receipt(r: Receipt) {
  if (!pending.some((p) => p.operationId === r.operationId)) return;
  pending = pending.filter((p) => p.operationId !== r.operationId);
  await persist();
  if (!r.ok) {
    const message = r.error ?? 'A submitted action was rejected.';
    useApp.setState((s) => ({ unresolved: [...s.unresolved, message].slice(-20) }));
    report(new Error(message));
  }
  preview();
}
function pause() {
  for (const id of confirmations.keys()) finishConfirmation(id, false);
  useApp.setState({ connected: false });
  dispatchEvent(new Event('mtg-cancel-input'));
}
function disconnect() {
  ++generation;
  activeRoom = '';
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = undefined;
  }
  pause();
}
function schedule(roomId: string, gen: number) {
  if (generation !== gen || document.hidden) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(
    () => {
      void connectRoom(roomId);
    },
    Math.min(15000, 700 * 2 ** Math.min(attempts++, 5)) + Math.random() * 450,
  );
}
export async function connectRoom(roomId: string) {
  clearTimeout(reconnectTimer);
  const gen = ++generation;
  activeRoom = roomId;
  pause();
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = undefined;
  }
  try {
    // A send may finish saving just as the connection changes and append a
    // cancellation write. Drain that write too before retrying any envelopes.
    let drained: Promise<void>;
    do {
      drained = writing;
      await drained.catch(() => {});
    } while (drained !== writing);
    if (generation !== gen) return;
    await session();
    if (generation !== gen) return;
    const savedPending = await repository.pending(roomId);
    // Storage can finish after the user has left this room. Keep that result
    // local until we know this connection still owns the active room state.
    if (generation !== gen) return;
    pending = savedPending;
    useApp.setState({ mode: 'room', pending: pending.length });
    // Re-submit only durable envelopes. Receipt lookup precedes mutable roles/game IDs on the server.
    for (const env of [...pending]) {
      const result = await api<{ receipt: Receipt; view?: RoomView }>(`/rooms/${roomId}/command`, env);
      if (generation !== gen) return;
      await receipt(result.receipt);
      if (generation !== gen) return;
    }
    const start = Date.now();
    const view = await api<RoomView>(`/rooms/${roomId}`);
    if (generation !== gen) return;
    acceptView(view, (start + Date.now()) / 2);
    const url = new URL(`/api/rooms/${roomId}/live?protocol=${PROTOCOL}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onmessage = (e) => {
      if (generation !== gen) return;
      try {
        const msg = JSON.parse(String(e.data)) as {
          type: string;
          view?: RoomView;
          receipt?: Receipt;
          error?: string;
        };
        lastPong = Date.now();
        if (msg.type === 'ready') {
          attempts = 0;
          useApp.setState({ connected: true });
        }
        if (msg.receipt) {
          pending = pending.filter((p) => {
            if (p.operationId !== msg.receipt!.operationId) return true;
            if (!msg.receipt!.ok) {
              const message = msg.receipt!.error ?? 'Action rejected';
              useApp.setState((s) => ({ unresolved: [...s.unresolved, message].slice(-20) }));
              report(new Error(message));
            }
            return false;
          });
          void persist().catch(report);
        }
        if (msg.view) acceptView(msg.view);
        else preview();
        if (msg.receipt) {
          const waiting = confirmations.get(msg.receipt.operationId);
          const current = useApp.getState();
          finishConfirmation(
            msg.receipt.operationId,
            !!(
              msg.receipt.ok &&
              waiting &&
              current.mode === 'room' &&
              current.room?.id === waiting.roomId &&
              current.confirmed?.id === waiting.gameId &&
              msg.receipt.gameId === waiting.gameId &&
              current.room.revision >= msg.receipt.revision
            ),
          );
        }
        if (msg.type === 'error') {
          for (const id of confirmations.keys()) finishConfirmation(id, false);
          report(new Error(msg.error));
        }
      } catch {
        report(new Error('An invalid server message was ignored. Reconnecting for a fresh snapshot.'));
        void connectRoom(roomId);
      }
    };
    socket.onclose = (e) => {
      if (generation !== gen) return;
      pause();
      if (e.code === 4003)
        report(new Error('Room access ended. Rejoin and ask the host to approve your seat.'));
      else schedule(roomId, gen);
    };
    socket.onerror = () => {
      if (generation === gen) pause();
    };
    lastPong = Date.now();
  } catch (e) {
    if (generation !== gen) return;
    pause();
    if (e instanceof ApiError && [401, 403, 404, 410, 426].includes(e.status)) {
      report(
        new Error(
          `${e.message} Rejoin with the room invitation or open your saved local game. Submitted actions remain recorded on this device.`,
        ),
      );
      useApp.setState((s) => ({
        unresolved: [
          ...s.unresolved,
          ...(pending.length ? [`${pending.length} submitted actions still need reconciliation.`] : []),
        ].slice(-20),
      }));
    } else {
      report(new Error(`Connection unavailable. ${errorMessage(e)}`));
      schedule(roomId, gen);
    }
  }
}
async function send(command: Command | AdminCommand, groupId?: string, track?: (envelope: Envelope) => void) {
  const state = useApp.getState();
  if (!state.connected || !state.room || socket?.readyState !== WebSocket.OPEN)
    throw new Error('Reconnecting — changes paused. No new changes were queued.');
  if (command.type === 'groupLife')
    throw new Error('In shared rooms, each player records life changes on their own seat.');
  if (
    [
      'adjust',
      'set',
      'damage',
      'damageSet',
      'cast',
      'castSet',
      'customize',
      'editPlayer',
      'commanderName',
      'eliminate',
    ].includes(command.type) &&
    (!state.confirmed ||
      state.room.me.status !== 'approved' ||
      !state.room.me.seatId ||
      commandSeat(state.confirmed, command as Command) !== state.room.me.seatId)
  )
    throw new Error('You can change only your own seat in a shared room.');
  if (
    command.type === 'undo' &&
    (!state.confirmed ||
      !canUndoRoomAction(
        state.confirmed,
        state.room.me.id,
        state.room.me.seatId,
        state.room.hostId === state.room.me.id,
      ))
  )
    throw new Error('You can undo only your own actions for your current seat.');
  if (pending.length >= 60) throw new Error('Waiting for the server to confirm your recent changes.');
  if (!isRelative(command as Command) && pending.length)
    throw new Error('Wait for the current changes to finish before making this correction.');
  const targetSocket = socket,
    targetGeneration = generation;
  const env: Envelope = {
    protocolVersion: PROTOCOL,
    roomId: state.room.id,
    gameId: state.room.gameId,
    operationId: newId(),
    baseRevision: state.room.revision,
    command,
    groupId,
  };
  track?.(env);
  // A durable envelope is saved before any bytes leave this device.
  pending.push(env);
  preview();
  try {
    await persist();
  } catch {
    pending = pending.filter((p) => p !== env);
    preview();
    throw new Error(
      'This change was not sent because its recovery record could not be saved. Check browser storage.',
    );
  }
  if (
    generation !== targetGeneration ||
    socket !== targetSocket ||
    targetSocket?.readyState !== WebSocket.OPEN ||
    !useApp.getState().connected ||
    useApp.getState().room?.id !== env.roomId ||
    useApp.getState().mode !== 'room'
  ) {
    if (activeRoom === env.roomId) pending = pending.filter((p) => p !== env);
    // Remove only this never-submitted envelope from its original room. A mode
    // or room switch must not write another room's pending list or send on its socket.
    writing = writing
      .catch(() => {})
      .then(async () => {
        const saved = await repository.pending(env.roomId);
        await repository.savePending(
          env.roomId,
          saved.filter((p) => p.operationId !== env.operationId),
        );
      });
    await writing;
    if (activeRoom === env.roomId && useApp.getState().mode === 'room') preview();
    throw new Error('Connection lost before this change was sent. Please try again after reconnecting.');
  }
  targetSocket.send(JSON.stringify({ type: 'command', csrf, envelope: env }));
}
function savePlayer(
  command: Extract<Command, { type: 'editPlayer' | 'groupLife' | 'damage' }>,
): Promise<boolean> {
  return new Promise((resolve) => {
    let operationId: string | undefined;
    void send(command, undefined, (env) => {
      operationId = env.operationId;
      const timer = setTimeout(() => {
        report(
          new Error(
            'The save has not been confirmed. Check the totals and history after reconnecting before trying again.',
          ),
        );
        finishConfirmation(env.operationId, false);
        if (activeRoom === env.roomId && useApp.getState().mode === 'room') void connectRoom(env.roomId);
      }, 12_000);
      confirmations.set(env.operationId, { roomId: env.roomId, gameId: env.gameId, finish: resolve, timer });
    }).catch((error) => {
      report(error);
      if (operationId) finishConfirmation(operationId, false);
      else resolve(false);
    });
  });
}
registerRoom(send, disconnect, savePlayer);
export async function createRoom(setup: Setup, displayName: string) {
  await session(true);
  const game = createGame(setup, newId, Date.now());
  const view = await api<RoomView>('/rooms', {
    game,
    name: displayName,
    hostPlayerId: game.order[0],
  });
  useApp.setState({
    mode: 'room',
    room: view,
    game: view.game,
    confirmed: view.game,
    screen: 'board',
    readOnly: false,
    pending: 0,
  });
  await updateProfile({ lastMode: 'room', roomId: view.id, displayName });
  await repository.saveRoom(view);
  await connectRoom(view.id);
  notify('Room created. Invite your table.');
}
export async function joinRoom(code: string, displayName: string) {
  await session(true);
  const view = await api<RoomView>('/join', { code, name: displayName });
  useApp.setState({
    mode: 'room',
    room: view,
    game: view.game,
    confirmed: view.game,
    screen: view.game ? 'board' : 'lobby',
    readOnly: false,
    pending: 0,
  });
  await updateProfile({ lastMode: 'room', roomId: view.id, displayName });
  await repository.saveRoom(view);
  history.replaceState(history.state, '', location.pathname);
  await connectRoom(view.id);
}
document.addEventListener('visibilitychange', () => {
  if (useApp.getState().mode !== 'room' || !activeRoom) return;
  if (document.hidden) {
    pause();
    socket?.close();
  } else void connectRoom(activeRoom);
});
addEventListener('online', () => {
  if (activeRoom && !useApp.getState().connected) void connectRoom(activeRoom);
});
addEventListener('offline', () => {
  if (activeRoom) {
    pause();
    socket?.close();
  }
});
setInterval(() => {
  if (!activeRoom || document.hidden) return;
  if (Date.now() - lastPong > 35000) {
    void connectRoom(activeRoom);
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
}, 15000);
setInterval(() => {
  if (activeRoom && !document.hidden && useApp.getState().connected)
    void session().catch(() => {
      pause();
      socket?.close();
    });
}, 15 * 60000);
