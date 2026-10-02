import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSetup } from '../../shared/game.js';
import { canUndoRoomAction } from '../../shared/permissions.js';
import { type Game, type Roll } from '../../shared/schema.js';
import {
  hydrate,
  useApp,
  act,
  startLocal,
  report,
  repository,
  recoverCheckpoint,
  startFreshAfterRecovery,
  takeOver,
  isHost,
  openHome,
  resumeLocal,
} from './store.js';
import { ask, ConfirmationDialog, downloadText, Icon, Sheet, Sigil } from '../components/ui.js';
import { Board } from '../features/Board.js';
import { SetupSheet } from '../features/Setup.js';
import { PlayerDetails } from '../features/PlayerDetails.js';
import { CommanderQuick } from '../features/CommanderQuick.js';
import { Utilities } from '../features/Utilities.js';
import { GroupLife } from '../features/GroupLife.js';
import { GameMenu, HistorySheet } from '../features/GameMenu.js';
import { Settings, Enhancements, PwaUpdates } from '../features/Settings.js';
import { JoinSheet, RoomSheet, Lobby } from '../features/Rooms.js';
import { RecentGames } from '../features/RecentGames.js';
import { DiceRoll } from '../dice/DiceRoll.js';
import { TableLayout } from '../features/TableLayout.js';
import { useTableLayout } from '../features/useTableLayout.js';

export function App() {
  const state = useApp(),
    { game, profile, mode } = state;
  const { layout } = useTableLayout();
  const [announcement, setAnnouncement] = useState('');
  const summary = state.pending === 0 ? (game?.history.at(-1)?.summary ?? '') : '';
  useEffect(() => {
    // A held control commits every increment. Speak the accumulated result once
    // the sequence settles, instead of announcing every durable write.
    const timer = setTimeout(() => setAnnouncement(summary), 300);
    return () => clearTimeout(timer);
  }, [summary]);
  const [sheet, setSheet] = useState<string | null>(
    new URLSearchParams(location.search).has('join') ? 'join' : null,
  );
  const [setupMode, setSetupMode] = useState<'local' | 'room'>('local');
  const [presentation, setPresentation] = useState<{ game: Game; roll: Roll; replay?: boolean }>();
  const observedRoll = useRef<{ gameId: string; rollId?: string } | undefined>(undefined);
  const observedEnd = useRef<{ id: string; status: Game['status'] } | undefined>(undefined);
  const sheetKey = useRef(`mtg-sheet-${Date.now()}`);
  const open = useCallback((s: string) => {
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('[role="dialog"]')) {
      document
        .querySelectorAll('[data-sheet-return]')
        .forEach((el) => el.removeAttribute('data-sheet-return'));
      document.activeElement.setAttribute('data-sheet-return', 'true');
    }
    setSheet(s);
  }, []);
  const openPlayer = useCallback((id: string) => open(`player:${id}`), [open]);
  const openCommander = useCallback(
    (playerId: string, commanderId?: string) => {
      open(commanderId ? `tax:${commanderId}` : `damage:${playerId}`);
    },
    [open],
  );
  const close = useCallback(() => {
    if (history.state?.mtgSheet === sheetKey.current) history.back();
    else setSheet(null);
  }, []);
  const showRoll = useCallback((confirmed: Game, roll: Roll, replay = false) => {
    dispatchEvent(new Event('mtg-cancel-input'));
    // Remove the utilities sheet immediately so the board is the dice tray.
    setSheet(null);
    setPresentation({ game: confirmed, roll, replay });
  }, []);
  useEffect(() => {
    const confirmed = state.confirmed;
    if (!confirmed) {
      observedRoll.current = undefined;
      return;
    }
    const latest = confirmed.rolls[0];
    const previous = observedRoll.current;
    observedRoll.current = { gameId: confirmed.id, rollId: latest?.id };
    if (previous?.gameId !== confirmed.id) {
      setPresentation(undefined);
      return;
    }
    if (latest && latest.id !== previous.rollId && state.screen === 'board') showRoll(confirmed, latest);
  }, [state.confirmed, state.screen, showRoll]);
  const hasSheet = sheet !== null || presentation !== undefined;
  useEffect(() => {
    if (hasSheet && history.state?.mtgSheet !== sheetKey.current)
      history.pushState({ ...history.state, mtgSheet: sheetKey.current }, '', location.href);
  }, [hasSheet]);
  useEffect(() => {
    const back = () => {
      if (useApp.getState().mode === 'room' && new URLSearchParams(location.search).has('join'))
        history.replaceState(history.state, '', location.pathname);
      setSheet(null);
      setPresentation(undefined);
    };
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    void hydrate();
  }, []);
  useEffect(() => {
    if (sheet || !state.connected) dispatchEvent(new Event('mtg-cancel-input'));
  }, [sheet, state.connected]);
  const setup = (m: 'local' | 'room') => {
    setSetupMode(m);
    open('setup');
  };
  const home = () => {
    close();
    setPresentation(undefined);
    void openHome().catch(report);
  };
  useEffect(() => {
    const confirmed = state.confirmed;
    if (!state.ready || !confirmed) return;
    const previous = observedEnd.current;
    observedEnd.current = { id: confirmed.id, status: confirmed.status };
    if (confirmed.status !== 'ended' || previous?.id !== confirmed.id || previous.status !== 'active') return;
    setSheet(null);
    setPresentation(undefined);
    void openHome().catch(report);
  }, [state.ready, state.confirmed]);
  const eligible = game?.order.filter((id) => !game.players[id].eliminated) ?? [];
  const canUndo =
    game &&
    game.undo.length > 0 &&
    !state.readOnly &&
    (mode === 'local' ||
      (state.connected &&
        state.room &&
        state.room.me.status === 'approved' &&
        state.room?.undoRoomRevision === state.room?.revision &&
        canUndoRoomAction(game, state.room.me.id, state.room.me.seatId, isHost())));
  if (!state.ready)
    return (
      <main className="loading">
        <Sigil />
        <p>Setting the table…</p>
      </main>
    );
  return (
    <>
      <Enhancements />
      <div
        className={`app ${state.screen === 'board' ? 'playing' : ''} ${layout === 'shared' ? 'shared-table-view' : ''}`}
      >
        <header className="app-header">
          <button className="brand" onClick={home} aria-label="Home & recent games">
            <img src="/icon.svg" alt="" />
            <span>
              Command <b>Table</b>
            </span>
          </button>
          <div className="header-right">
            {state.screen === 'board' ? (
              <>
                <span className="game-preset">{game?.settings.preset}</span>
                {mode === 'room' ? (
                  <button
                    className={`room-indicator ${state.connected ? 'live' : ''}`}
                    onClick={() => open('room')}
                  >
                    <span className="presence-dot online" />
                    {state.connected ? (state.pending ? 'Saving…' : 'Live room') : 'Reconnecting'}
                  </button>
                ) : (
                  <span className="saved-indicator">
                    <span className="presence-dot online" />
                    {state.pending ? 'Saving…' : repository.memory ? 'Memory only' : 'Saved here'}
                  </span>
                )}
              </>
            ) : (
              <span className="eyebrow">A COMPANION FOR YOUR TABLE</span>
            )}
          </div>
        </header>
        {state.storageWarning && (
          <div className="status-banner warning" role="status">
            {state.storageWarning}
          </div>
        )}
        {state.readOnly && state.screen === 'board' && (
          <div className="status-banner">
            Another tab controls this local game.{' '}
            <button onClick={() => void takeOver().catch(report)}>Take over here</button>
          </div>
        )}
        {mode === 'room' && !state.connected && state.screen !== 'home' && (
          <div className="status-banner warning">
            Reconnecting — changes paused{' '}
            <button
              onClick={() => {
                void import('../adapters/room.js').then((m) => m.connectRoom(profile.roomId!));
              }}
            >
              Retry
            </button>
            {game && <button onClick={() => open('menu')}>Play a local copy</button>}
          </div>
        )}
        {state.screen === 'home' && (
          <main className="home">
            <div className="hero-sigil">
              <Sigil />
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
            </div>
            <div className="eyebrow gold">GOOD COMPANY. GREAT GAMES.</div>
            <h1>
              Gather.
              <br />
              <em>Let the magic happen.</em>
            </h1>
            <p className="hero-description">
              Life, legends, and a little luck.
              <br />
              We’ll keep count. You make the memories.
            </p>
            {state.recovery && (
              <div className="notice">
                <h3>Your saved data needs attention</h3>
                <p>{state.error}</p>
                <button
                  onClick={() =>
                    void repository
                      .get('active')
                      .then((value) =>
                        downloadText(JSON.stringify(value, null, 2), 'command-table-recovery.json'),
                      )
                      .catch(report)
                  }
                >
                  Export recovery data
                </button>
                <button onClick={() => void recoverCheckpoint().catch(report)}>Restore checkpoint</button>
                <button
                  onClick={async () => {
                    if (
                      await ask(
                        'Start fresh after recovery?',
                        'Export your unreadable data first. A raw copy is also preserved in browser storage. This starts a new four-player local game.',
                      )
                    )
                      void startFreshAfterRecovery().catch(report);
                  }}
                >
                  Start a fresh local game
                </button>
              </div>
            )}
            {(state.mode === 'room'
              ? state.room && state.room.game?.status !== 'ended'
              : state.localGame?.status === 'active') && (
              <button
                className="resume-button"
                onClick={() => {
                  if (state.mode === 'room')
                    useApp.setState({ screen: state.room?.game ? 'board' : 'lobby' });
                  else void resumeLocal().catch(report);
                }}
              >
                <Icon name="rotate" />
                <span>Return to your {state.mode === 'room' ? 'room' : 'game'}</span>
                <Icon name="arrow" />
              </button>
            )}
            <div className="mode-grid">
              <div className="mode-card">
                <div className="mode-symbol">
                  <Icon name="phone" size={28} />
                </div>
                <h2>One device</h2>
                <p>
                  One screen. The whole table.
                  <br />
                  Works offline, too.
                </p>
                <button className="primary full" disabled={state.recovery} onClick={() => setup('local')}>
                  Set up a game <Icon name="arrow" size={17} />
                </button>
                <div className="quick-start">
                  <button
                    disabled={state.recovery}
                    onClick={() => void startLocal(defaultSetup()).catch(report)}
                  >
                    Quick 4 · 40 life
                  </button>
                  <span>·</span>
                  <button
                    disabled={state.recovery}
                    onClick={() => void startLocal(defaultSetup(2, false)).catch(report)}
                  >
                    Quick 2 · 20 life
                  </button>
                </div>
              </div>
              <div className="mode-card shared">
                <div className="mode-symbol">
                  <Icon name="people" size={28} />
                </div>
                <h2>Shared room</h2>
                <p>
                  Your own screens.
                  <br />
                  One game, together.
                </p>
                <div className="button-row">
                  <button className="secondary" onClick={() => setup('room')}>
                    Create room
                  </button>
                  <button className="secondary" onClick={() => open('join')}>
                    Join room
                  </button>
                </div>
                <div className="mode-note">No accounts. Just your friends.</div>
              </div>
            </div>
            <RecentGames />
            <p className="home-foot">
              <Icon name="shield" size={15} /> Made for the table, remembered in your browser.
            </p>
            <button className="home-settings-button" onClick={() => open('settings')}>
              <Icon name="settings" size={20} />
              <span>Display & browser settings</span>
            </button>
          </main>
        )}
        {state.screen === 'lobby' && <Lobby openRoom={() => open('room')} />}
        {state.screen === 'board' && game && (
          <>
            <div className="board-topline">
              <span>
                {game.order.length === 1 ? 'PRACTICE TABLE' : `${game.order.length} PLAYERS AT THE TABLE`}
              </span>
              <span className="awake-indicator">☀ Screen awake</span>
              <span>
                {mode === 'room' && state.pending > 0
                  ? `${state.pending} CHANGE${state.pending === 1 ? '' : 'S'} AWAITING CONFIRMATION`
                  : game.status === 'ended'
                    ? 'GAME ENDED'
                    : mode === 'room'
                      ? 'EACH PLAYER CONTROLS THEIR OWN SEAT'
                      : 'MAY YOUR DRAWS BE KIND'}
              </span>
            </div>
            <Board openPlayer={openPlayer} openCommander={openCommander} />
            <nav className="table-toolbar" aria-label="Game controls">
              <button onClick={() => open('utilities')}>
                <Icon name="dice" />
                <span>Utilities</span>
              </button>
              <span className="toolbar-divider" />
              <button
                disabled={!canUndo || state.pending > 0}
                title={
                  !canUndo
                    ? 'Undo is unavailable: only the latest safe gameplay action can be reversed.'
                    : 'Undo latest action'
                }
                onClick={() => void act({ type: 'undo' })}
              >
                <Icon name="undo" />
                <span>Undo</span>
              </button>
              {game.settings.turnTracking && (
                <>
                  <button
                    className="next-turn"
                    disabled={
                      !isHost() ||
                      state.readOnly ||
                      state.pending > 0 ||
                      game.status !== 'active' ||
                      !eligible.length ||
                      (mode === 'room' && !state.connected)
                    }
                    onClick={() =>
                      void act({
                        type: 'turn',
                        playerId:
                          eligible[(eligible.indexOf(game.turn.playerId ?? '') + 1) % eligible.length],
                        advance: true,
                      })
                    }
                  >
                    <Icon name="arrow" />
                    <span>Next turn</span>
                  </button>
                </>
              )}
              <span className="toolbar-divider" />
              <button onClick={() => open('menu')}>
                <Icon name="menu" />
                <span>Game menu</span>
              </button>
            </nav>
          </>
        )}
      </div>
      {sheet === 'new-game' && (
        <Sheet
          title="How are you playing?"
          description="Your unfinished game will be saved so you can come back to it."
          onClose={close}
        >
          <div className="new-game-modes">
            <button className="secondary" onClick={() => setup('local')}>
              <Icon name="phone" size={28} />
              <strong>One phone</strong>
              <span>One life counter for the whole table.</span>
            </button>
            <button className="secondary" onClick={() => setup('room')}>
              <Icon name="people" size={28} />
              <strong>Multiple phones</strong>
              <span>Create a shared room for your friends.</span>
            </button>
          </div>
          <button className="text-button full" onClick={() => open('join')}>
            Join an existing room
          </button>
        </Sheet>
      )}
      {sheet === 'setup' && <SetupSheet mode={setupMode} onClose={close} />}
      {sheet === 'join' && <JoinSheet onClose={close} />}
      {sheet === 'room' && state.room && <RoomSheet onClose={close} />}
      {sheet?.startsWith('player:') && game?.players[sheet.slice(7)] && (
        <PlayerDetails key={sheet} playerId={sheet.slice(7)} onClose={close} />
      )}
      {sheet?.startsWith('damage:') && game?.players[sheet.slice(7)] && (
        <CommanderQuick key={`${game.id}:${sheet}`} playerId={sheet.slice(7)} mode="damage" onClose={close} />
      )}
      {sheet?.startsWith('tax:') && game?.commanders[sheet.slice(4)] && (
        <CommanderQuick
          key={`${game.id}:${sheet}`}
          playerId={game.commanders[sheet.slice(4)].ownerId}
          commanderId={sheet.slice(4)}
          mode="tax"
          onClose={close}
        />
      )}
      {sheet === 'utilities' && game && (
        <Utilities
          onClose={close}
          onReplay={(roll) => showRoll(state.confirmed!, roll, true)}
          onGroupLife={() => open('group-life')}
        />
      )}
      {sheet === 'group-life' && game && <GroupLife key={game.id} onClose={close} />}
      {sheet === 'menu' && game && <GameMenu onClose={close} open={open} />}
      {sheet === 'history' && game && <HistorySheet onClose={close} />}
      {sheet === 'settings' && <Settings onClose={close} />}
      {sheet === 'layout' && <TableLayout onClose={close} />}
      {presentation && state.screen === 'board' && (
        <DiceRoll
          key={presentation.roll.id}
          {...presentation}
          onClose={() => {
            setPresentation(undefined);
            close();
          }}
        />
      )}
      <ConfirmationDialog />
      {state.error && !state.recovery && (
        <div className="error-toast" role="alert">
          <span>
            {state.error.length > 350
              ? 'Please check your values. Use whole numbers within the supported limits and names up to 40 characters.'
              : state.error}
          </span>
          <button aria-label="Dismiss error" onClick={() => useApp.setState({ error: '' })}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {state.toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {state.toast}
        </div>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <PwaUpdates />
    </>
  );
}
