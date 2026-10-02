import { create } from 'zustand';
import { createGame, defaultSetup, setupFromGame, makeRoll, reduceGame } from '../../shared/game.js';
import { newId, randomInt } from '../../shared/random.js';
import {
  gameSchema,
  type AdminCommand,
  type Command,
  type Game,
  type RoomView,
  type Setup,
} from '../../shared/schema.js';
import { ConflictError, initialProfile, Repository, type Profile } from '../storage/repository.js';
import { acquireEditorIdentity } from '../storage/tabIdentity.js';
import { playCue, unlockAudio } from '../components/feedback.js';
import { cacheAppearance } from '../features/appearance.js';

let tabId = newId();
try {
  tabId = sessionStorage.getItem('mtg-tab') ?? tabId;
  sessionStorage.setItem('mtg-tab', tabId);
} catch {
  /* Storage denial must not prevent in-memory play. */
}
export const repository = new Repository(tabId);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mtg-util') : null;
type State = {
  ready: boolean;
  game?: Game;
  confirmed?: Game;
  localGame?: Game;
  room?: RoomView;
  profile: Profile;
  mode: 'local' | 'room';
  screen: 'home' | 'board' | 'lobby';
  connected: boolean;
  pending: number;
  readOnly: boolean;
  storageWarning: string;
  error: string;
  toast: string;
  recovery: boolean;
  clockOffset: number;
  unresolved: string[];
};
export const useApp = create<State>(() => ({
  ready: false,
  profile: initialProfile(),
  mode: 'local',
  screen: 'home',
  connected: false,
  pending: 0,
  readOnly: false,
  storageWarning: '',
  error: '',
  toast: '',
  recovery: false,
  clockOffset: 0,
  unresolved: [],
}));
let queue = Promise.resolve();
let editorResume: Promise<void> | undefined;
let localPending: { command: Command; context: Parameters<typeof reduceGame>[2] }[] = [];
let roomSend: ((command: Command | AdminCommand, groupId?: string) => Promise<void>) | undefined;
type PlayerSave = Extract<Command, { type: 'editPlayer' }>;
type SavedCommand = Extract<Command, { type: 'editPlayer' | 'groupLife' | 'damage' }>;
let roomSavePlayer: ((command: SavedCommand) => Promise<boolean>) | undefined;
let disconnectRoom: (() => void) | undefined;
export function registerRoom(
  send: typeof roomSend,
  disconnect: () => void,
  savePlayer?: typeof roomSavePlayer,
) {
  roomSend = send;
  disconnectRoom = disconnect;
  roomSavePlayer = savePlayer;
}
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
export function notify(message: string) {
  useApp.setState({ toast: message });
  setTimeout(() => {
    if (useApp.getState().toast === message) useApp.setState({ toast: '' });
  }, 3500);
}
export function report(e: unknown) {
  useApp.setState({ error: errorMessage(e) });
}
export async function updateProfile(patch: Partial<Profile>) {
  const profile = { ...useApp.getState().profile, ...patch };
  useApp.setState({ profile });
  try {
    await repository.put('profile', profile);
    if (!repository.memory) cacheAppearance(profile);
  } catch {
    useApp.setState({ storageWarning: 'Preferences could not be saved. Check available browser storage.' });
  }
}
export async function hydrate() {
  repository.tabId = await acquireEditorIdentity(repository.tabId);
  await repository.open();
  useApp.setState({ storageWarning: repository.warning });
  try {
    const profile = await repository.profile();
    if (!repository.memory) cacheAppearance(profile);
    useApp.setState({ profile });
    const { game, readOnly } = await repository.active();
    useApp.setState({ localGame: game, game, confirmed: game, readOnly });
    const join = new URLSearchParams(location.search).has('join');
    if (!join && profile.lastMode === 'room' && profile.roomId) {
      let room = await repository.get<RoomView>(`room:${profile.roomId}`);
      if (
        room &&
        (room.protocolVersion !== 1 ||
          room.id !== profile.roomId ||
          (room.game && !gameSchema.safeParse(room.game).success))
      ) {
        room = undefined;
        notify('Saved room preview is unreadable. Fetching a fresh copy.');
      }
      useApp.setState({
        mode: 'room',
        room,
        game: room?.game,
        confirmed: room?.game,
        screen: room?.game?.status === 'ended' ? 'home' : room?.game ? 'board' : 'lobby',
        readOnly: false,
      });
      const { connectRoom } = await import('../adapters/room.js');
      void connectRoom(profile.roomId);
    } else if (game?.status === 'active' && !join) {
      useApp.setState({ screen: 'board' });
      notify('Game restored');
    }
  } catch (e) {
    useApp.setState({ recovery: true, error: errorMessage(e), screen: 'home' });
  }
  useApp.setState({ ready: true });
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* Optional enhancement. */
  }
}
function renderLocalPending(confirmed: Game) {
  let preview = confirmed;
  for (const p of localPending) {
    try {
      preview = reduceGame(preview, p.command, p.context);
    } catch {
      /* The queued operation will surface validation. */
    }
  }
  useApp.setState({ game: preview, confirmed, localGame: confirmed, pending: localPending.length });
}
export function act(command: Command | AdminCommand, groupId?: string): Promise<void> {
  const state = useApp.getState();
  if (state.profile.audio && (state.mode === 'local' || state.connected)) {
    if (command.type === 'roll') void unlockAudio();
    else playCue(command.type === 'adjust' && command.delta < 0 ? 'down' : 'up');
  }
  if (state.mode === 'room') return roomSend ? roomSend(command, groupId).catch(report) : Promise.resolve();
  if (!state.game || state.readOnly || state.recovery) {
    report(new Error('Take over this tab or resolve storage recovery before editing.'));
    return Promise.resolve();
  }
  const c = command as Command;
  let roll;
  try {
    if (c.type === 'roll')
      roll = makeRoll(state.game, c, { id: newId(), now: Date.now(), actor: 'This device' }, randomInt);
  } catch (e) {
    report(e);
    return Promise.resolve();
  }
  const context = {
    id: newId(),
    operationId: newId(),
    now: Date.now(),
    actorId: state.profile.installationId,
    actor: 'This device',
    groupId,
    newGameId: c.type === 'rematch' ? newId() : undefined,
    roll,
  };
  try {
    reduceGame(state.game, c, context);
  } catch (e) {
    report(e);
    return Promise.resolve();
  }
  const operation = { command: c, context };
  localPending.push(operation);
  renderLocalPending(state.confirmed!);
  queue = queue.then(async () => {
    if (!localPending.includes(operation)) return;
    const confirmed = useApp.getState().confirmed!;
    try {
      const next = reduceGame(confirmed, c, context);
      await repository.commit(next, confirmed);
      localPending = localPending.filter((p) => p !== operation);
      renderLocalPending(next);
      channel?.postMessage('changed');
    } catch (e) {
      localPending = [];
      if (e instanceof ConflictError) {
        const active = await repository.active();
        useApp.setState({ readOnly: true });
        if (active.game) renderLocalPending(active.game);
      } else {
        renderLocalPending(confirmed);
        useApp.setState({
          storageWarning:
            'A change could not be saved and was not committed. Free browser storage or export a backup.',
        });
      }
      report(e);
    }
  });
  return queue;
}

/** A player editor may discard its draft only after this returns true. */
export function savePlayer(command: PlayerSave): Promise<boolean> {
  return saveCommand(command);
}
/** Quick damage closes only after the combined damage/life change is confirmed. */
export function saveDamage(command: Extract<Command, { type: 'damage' }>): Promise<boolean> {
  return saveCommand(command);
}
export type LifeReview = {
  gameId: string;
  revision: number;
  mode: State['mode'];
  roomId?: string;
  roomRevision?: number;
};
/** Apply a reviewed group effect only to the same confirmed game and totals. */
export function saveGroupLife(command: Extract<Command, { type: 'groupLife' }>, review: LifeReview) {
  return saveCommand(command, review);
}
async function saveCommand(command: SavedCommand, review?: LifeReview): Promise<boolean> {
  const reviewMatches = (state: State) =>
    !review ||
    (state.confirmed?.id === review.gameId &&
      state.confirmed.revision === review.revision &&
      state.mode === review.mode &&
      state.room?.id === review.roomId &&
      state.room?.revision === review.roomRevision &&
      state.screen === 'board' &&
      !state.pending &&
      state.mode === 'local');
  try {
    await editorResume;
  } catch (error) {
    report(error);
    return false;
  }
  const state = useApp.getState();
  if (!reviewMatches(state)) {
    report(new Error('The table changed. Review the current totals before applying this effect.'));
    return false;
  }
  if (state.mode === 'room') {
    if (command.type === 'groupLife' || !canEdit(command.playerId)) {
      report(new Error('You can change only your own seat in a shared room.'));
      return false;
    }
    if (!roomSavePlayer) {
      report(new Error('Reconnect before saving. Your changes have been kept.'));
      return false;
    }
    try {
      return await roomSavePlayer(command);
    } catch (error) {
      report(error);
      return false;
    }
  }
  if (!state.game || state.readOnly || state.recovery) {
    report(new Error('Take over this tab or resolve storage recovery before editing.'));
    return false;
  }
  const gameId = state.game.id;
  const context = {
    id: newId(),
    operationId: newId(),
    now: Date.now(),
    actorId: state.profile.installationId,
    actor: 'This device',
  };
  // Wait for a durable write before dismissing a reviewed effect or edited draft.
  const result = queue
    .catch(report)
    .then(async () => {
      const current = useApp.getState();
      const confirmed = current.confirmed;
      if (
        current.mode !== 'local' ||
        !confirmed ||
        confirmed.id !== gameId ||
        current.readOnly ||
        current.recovery ||
        !reviewMatches(current)
      ) {
        report(new Error('The game changed before saving. Your edits have been kept.'));
        return false;
      }
      let writing = false;
      try {
        const next = reduceGame(confirmed, command, context);
        writing = true;
        await repository.commit(next, confirmed);
        const active = useApp.getState();
        if (active.mode !== 'local' || active.confirmed?.id !== gameId) return false;
        renderLocalPending(next);
        channel?.postMessage('changed');
        return true;
      } catch (error) {
        if (error instanceof ConflictError) {
          localPending = [];
          const active = await repository.active();
          if (useApp.getState().mode === 'local') {
            useApp.setState({ readOnly: true });
            if (active.game) renderLocalPending(active.game);
          }
        } else if (writing) {
          useApp.setState({
            storageWarning:
              'The change could not be saved. Your edits have been kept; check available browser storage.',
          });
        }
        report(error);
        return false;
      }
    })
    .catch((error) => {
      report(error);
      return false;
    });
  queue = result.then(() => {});
  return result;
}
export async function startLocal(setup: Setup, source?: Game) {
  await editorResume;
  await queue;
  const game = source
    ? { ...structuredClone(source), id: newId(), revision: 0, undo: [], redo: [] }
    : createGame(setup, newId, Date.now());
  await repository.commit(game, undefined, true);
  disconnectRoom?.();
  useApp.setState({
    mode: 'local',
    screen: 'board',
    game,
    confirmed: game,
    localGame: game,
    room: undefined,
    connected: false,
    readOnly: false,
    recovery: false,
    pending: 0,
    clockOffset: 0,
    unresolved: [],
  });
  await updateProfile({ lastMode: 'local', setup });
  channel?.postMessage('changed');
}
export async function resumeLocal(gameId?: string, reopen = false) {
  await editorResume;
  await queue;
  const { game, readOnly } =
    gameId && reopen
      ? await repository.reopenSaved(gameId, {
          id: newId(),
          operationId: newId(),
          now: Date.now(),
          actorId: useApp.getState().profile.installationId,
          actor: 'This device',
        })
      : gameId
        ? await repository.resumeSaved(gameId)
        : await repository.active();
  disconnectRoom?.();
  useApp.setState({
    mode: 'local',
    game,
    confirmed: game,
    localGame: game,
    screen: game ? 'board' : 'home',
    readOnly,
    room: undefined,
    pending: 0,
    connected: false,
    clockOffset: 0,
    unresolved: [],
  });
  await updateProfile({ lastMode: 'local', ...(game ? { setup: setupFromGame(game) } : {}) });
  channel?.postMessage('changed');
}
export async function openHome() {
  await queue;
  dispatchEvent(new Event('mtg-cancel-input'));
  useApp.setState({ screen: 'home' });
}
export async function takeOver() {
  await editorResume;
  const { game } = await repository.active();
  if (game) {
    await repository.commit(game, game, false, true);
    useApp.setState({ game, confirmed: game, localGame: game, readOnly: false });
    channel?.postMessage('changed');
    notify('This tab now controls the game');
  }
}
export async function recoverCheckpoint() {
  await editorResume;
  await queue;
  const game = await repository.checkpoint();
  if (!game) throw new Error('No valid checkpoint is available. Your recovery export is still available.');
  await repository.commit(game, undefined, true, true);
  disconnectRoom?.();
  useApp.setState({
    game,
    confirmed: game,
    localGame: game,
    recovery: false,
    error: '',
    mode: 'local',
    screen: 'board',
    room: undefined,
    connected: false,
    readOnly: false,
    pending: 0,
    clockOffset: 0,
    unresolved: [],
  });
  await updateProfile({ lastMode: 'local', setup: setupFromGame(game) });
  channel?.postMessage('changed');
}
export async function startFreshAfterRecovery() {
  await editorResume;
  await queue;
  const active = await repository.get('active');
  if (active) await repository.put(`recovery:${Date.now()}`, active);
  const profile = useApp.getState().profile;
  await repository.put('profile', profile);
  const setup = defaultSetup(),
    game = createGame(setup, newId, Date.now());
  await repository.commit(game, undefined, true, true);
  disconnectRoom?.();
  useApp.setState({
    mode: 'local',
    game,
    confirmed: game,
    localGame: game,
    screen: 'board',
    recovery: false,
    error: '',
    readOnly: false,
    room: undefined,
    connected: false,
    pending: 0,
    clockOffset: 0,
    unresolved: [],
  });
  await updateProfile({ lastMode: 'local', setup });
  channel?.postMessage('changed');
}
function resumeEditor() {
  if (editorResume || !useApp.getState().ready) return;
  if (useApp.getState().mode === 'local') useApp.setState({ readOnly: true });
  editorResume = (async () => {
    await queue;
    repository.tabId = await acquireEditorIdentity(repository.tabId);
    if (useApp.getState().mode !== 'local' || useApp.getState().recovery) return;
    const { game, readOnly } = await repository.active();
    if (useApp.getState().mode !== 'local') return;
    useApp.setState({ game, confirmed: game, localGame: game, readOnly, pending: 0 });
  })()
    .catch(report)
    .finally(() => {
      editorResume = undefined;
    });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) resumeEditor();
  });
  document.addEventListener('resume', resumeEditor);
}
channel?.addEventListener('message', async () => {
  if (!useApp.getState().ready || useApp.getState().mode !== 'local') return;
  try {
    const { game, readOnly } = await repository.active();
    if (game && (readOnly || game.revision > (useApp.getState().confirmed?.revision ?? -1))) {
      localPending = [];
      useApp.setState({ game, confirmed: game, localGame: game, readOnly, pending: 0 });
    }
  } catch (e) {
    report(e);
  }
});
setInterval(() => {
  const state = useApp.getState();
  if (!state.ready || state.mode !== 'local' || document.hidden || state.recovery) return;
  if (!state.readOnly) void repository.lease().catch(report);
  else
    void repository
      .active()
      .then(async (active) => {
        if (!active.game || active.readOnly || useApp.getState().mode !== 'local') return;
        await repository.commit(active.game, active.game);
        if (useApp.getState().mode === 'local') {
          useApp.setState({
            game: active.game,
            confirmed: active.game,
            localGame: active.game,
            readOnly: false,
          });
          channel?.postMessage('changed');
        }
      })
      .catch(() => {
        /* A live editor may have renewed its lease in the meantime. */
      });
}, 6000);
export function isHost() {
  const s = useApp.getState();
  return s.mode === 'local' || s.room?.hostId === s.room?.me.id;
}
export function canEdit(playerId: string) {
  const s = useApp.getState();
  return (
    !s.readOnly &&
    (s.mode === 'local' || (s.connected && s.room?.me.status === 'approved' && s.room.me.seatId === playerId))
  );
}
