import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { archenemyOutcome, defaultSetup, teamOf, turnOrder } from '../../shared/game.js';
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
import { FeatureBoundary } from '../components/FeatureBoundary.js';
import { TableLayout } from '../features/TableLayout.js';
import { gameMoments, stillWinner } from '../features/gameMoments.js';
import { useTableLayout } from '../features/useTableLayout.js';
import { Enhancements, PwaUpdates } from '../features/BrowserEnhancements.js';
import { RecentGames } from '../features/RecentGames.js';

const SetupSheet = lazy(() => import('../features/Setup.js').then((m) => ({ default: m.SetupSheet })));
const PlayerDetails = lazy(() =>
  import('../features/PlayerDetails.js').then((m) => ({ default: m.PlayerDetails })),
);
const CommanderQuick = lazy(() =>
  import('../features/CommanderQuick.js').then((m) => ({ default: m.CommanderQuick })),
);
const Utilities = lazy(() => import('../features/Utilities.js').then((m) => ({ default: m.Utilities })));
const GroupLife = lazy(() => import('../features/GroupLife.js').then((m) => ({ default: m.GroupLife })));
const SchemeDeck = lazy(() => import('../features/SchemeDeck.js').then((m) => ({ default: m.SchemeDeck })));
const GameMenu = lazy(() => import('../features/GameMenu.js').then((m) => ({ default: m.GameMenu })));
const HistorySheet = lazy(() => import('../features/GameMenu.js').then((m) => ({ default: m.HistorySheet })));
const Settings = lazy(() => import('../features/Settings.js').then((m) => ({ default: m.Settings })));
const JoinSheet = lazy(() => import('../features/Rooms.js').then((m) => ({ default: m.JoinSheet })));
const RoomSheet = lazy(() => import('../features/Rooms.js').then((m) => ({ default: m.RoomSheet })));
const Lobby = lazy(() => import('../features/Rooms.js').then((m) => ({ default: m.Lobby })));
const PlayerFallen = lazy(() =>
  import('../features/GameMoments.js').then((m) => ({ default: m.PlayerFallen })),
);
const WinnerScreen = lazy(() =>
  import('../features/GameMoments.js').then((m) => ({ default: m.WinnerScreen })),
);
const DiceRoll = lazy(() => import('../dice/DiceRoll.js').then((m) => ({ default: m.DiceRoll })));

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
  const [fallen, setFallen] = useState<{ key: string; game: Game; playerId: string }[]>([]);
  const [winner, setWinner] = useState<{ gameId: string; playerId: string }>();
  const observedSeats = useRef<Game | undefined>(undefined);
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
  const openSchemes = useCallback(() => open('schemes'), [open]);
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
  useEffect(() => {
    const confirmed = state.confirmed;
    const previous = observedSeats.current;
    observedSeats.current = confirmed;
    if (!confirmed || state.screen !== 'board') {
      setFallen([]);
      setWinner(undefined);
      return;
    }
    const moments = gameMoments(previous, confirmed);
    if (moments.fallen.length)
      setFallen((queue) => [
        ...queue,
        ...moments.fallen.map((playerId) => ({
          key: `${playerId}:${confirmed.revision}`,
          game: confirmed,
          playerId,
        })),
      ]);
    if (moments.winner) {
      // Like a dice result, the winner is shown on the table itself.
      dispatchEvent(new Event('mtg-cancel-input'));
      setSheet(null);
      setPresentation(undefined);
      setWinner({ gameId: confirmed.id, playerId: moments.winner });
    }
  }, [state.confirmed, state.screen]);
  const dismissFallen = useCallback(() => setFallen((queue) => queue.slice(1)), []);
  // The winner follows the elimination notice, and leaves if Undo restores a player.
  const showWinner = state.screen === 'board' && !fallen.length && stillWinner(state.confirmed, winner);
  const hasSheet = sheet !== null || presentation !== undefined || showWinner;
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
      setWinner(undefined);
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
  const eligible = game ? turnOrder(game) : [];
  const outcome = game ? archenemyOutcome(game) : null;
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
            <div className="home-intro">
              <div className="hero-sigil" aria-hidden="true">
                <Sigil />
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
              </div>
              <div>
                <div className="eyebrow gold">GOOD COMPANY. GREAT GAMES.</div>
                <h1>
                  Gather.
                  <br />
                  <em>Let the magic happen.</em>
                </h1>
                <p className="hero-description">Life, legends, and a little luck. We’ll keep count.</p>
              </div>
            </div>
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
            <div className="home-start">
              <div className="home-actions">
                <div className="eyebrow">YOUR NEXT GREAT GAME</div>
                <button
                  className="primary full home-primary"
                  aria-label="Quick 4 · 40 life"
                  disabled={state.recovery}
                  onClick={() => void startLocal(defaultSetup()).catch(report)}
                >
                  <Icon name="phone" size={24} />
                  <span>
                    <strong>Quick 4 · 40 life</strong>
                    <small>One screen. The whole table. Ready in a tap.</small>
                  </span>
                  <Icon name="arrow" size={20} />
                </button>
                <div className="home-room-actions">
                  <button className="secondary" onClick={() => setup('room')}>
                    <Icon name="people" size={18} />
                    Create room
                  </button>
                  <button className="secondary" onClick={() => open('join')}>
                    <Icon name="arrow" size={18} />
                    Join room
                  </button>
                </div>
                <div className="home-secondary-actions">
                  <button className="text-button" disabled={state.recovery} onClick={() => setup('local')}>
                    Set up a game
                  </button>
                  <button
                    className="text-button"
                    disabled={state.recovery}
                    onClick={() => void startLocal(defaultSetup(2, false)).catch(report)}
                  >
                    Quick 2 · 20 life
                  </button>
                </div>
                <p className="home-mode-hint">
                  Play on one device offline, or bring everyone’s screens together in a shared room.
                </p>
              </div>
              <div className="home-table-preview" aria-hidden="true">
                <div className="preview-table-edge">
                  {['blue', 'violet', 'green', 'ember'].map((color, i) => (
                    <div className="preview-seat" key={color} data-player-color={color}>
                      <span className="preview-seat-name">PLAYER {i + 1}</span>
                      <strong>40</strong>
                      <span>
                        − <i /> +
                      </span>
                    </div>
                  ))}
                </div>
                <span className="preview-table-caption">A LITTLE MAGIC. EVERY SEAT.</span>
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
        {state.screen === 'lobby' && (
          <FeatureBoundary onClose={home}>
            <Suspense
              fallback={
                <p className="loading" role="status">
                  Opening your room…
                </p>
              }
            >
              <Lobby openRoom={() => open('room')} />
            </Suspense>
          </FeatureBoundary>
        )}
        {state.screen === 'board' && game && (
          <>
            <div className="board-topline">
              <span
                className={outcome ? 'archenemy-outcome' : undefined}
                role={outcome ? 'status' : undefined}
              >
                {outcome === 'team'
                  ? 'THE TEAM DEFEATED THE ARCHENEMY'
                  : outcome === 'archenemy'
                    ? 'THE ARCHENEMY CONQUERED THE TEAM'
                    : game.archenemy
                      ? `ARCHENEMY · 1 VS ${teamOf(game).length}`
                      : game.order.length === 1
                        ? 'PRACTICE TABLE'
                        : `${game.order.length} PLAYERS AT THE TABLE`}
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
            <Board openPlayer={openPlayer} openCommander={openCommander} openSchemes={openSchemes} />
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
      <FeatureBoundary
        key={`${sheet}:${presentation?.roll.id}:${showWinner}`}
        onClose={() => {
          setSheet(null);
          setPresentation(undefined);
          setWinner(undefined);
          setFallen([]);
          close();
        }}
      >
        <Suspense
          fallback={
            <Sheet title="Opening…" onClose={close}>
              <p role="status">Just a moment while your table gets ready.</p>
            </Sheet>
          }
        >
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
            <CommanderQuick
              key={`${game.id}:${sheet}`}
              playerId={sheet.slice(7)}
              mode="damage"
              onClose={close}
            />
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
          {sheet === 'schemes' && game?.archenemy && <SchemeDeck onClose={close} />}
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
          {showWinner && (
            <WinnerScreen
              game={state.confirmed!}
              playerId={winner!.playerId}
              onClose={() => {
                setWinner(undefined);
                close();
              }}
            />
          )}
        </Suspense>
      </FeatureBoundary>
      {fallen[0] && state.screen === 'board' && (
        <FeatureBoundary key={fallen[0].key} onClose={dismissFallen} dismissOnError>
          <Suspense fallback={null}>
            <PlayerFallen
              key={fallen[0].key}
              game={fallen[0].game}
              playerId={fallen[0].playerId}
              onDone={dismissFallen}
            />
          </Suspense>
        </FeatureBoundary>
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
