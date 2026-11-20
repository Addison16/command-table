import { useEffect, useState } from 'react';
import { defaultSetup, standingWinners, teammates, teamOf } from '../../shared/game.js';
import { type Game } from '../../shared/schema.js';
import {
  act,
  isHost,
  useApp,
  repository,
  report,
  startLocal,
  resumeLocal,
  takeOver,
  openHome,
} from '../app/store.js';
import { gameExport, parseImport } from '../storage/repository.js';
import { ask, choose, downloadText, Icon, Sheet } from '../components/ui.js';
import { GameRecapSheet } from './GameRecap.js';
import { canRedoRoomAction } from '../../shared/permissions.js';
import '../styles/extras.css';
export function HistorySheet({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    mode = useApp((s) => s.mode),
    room = useApp((s) => s.room),
    connected = useApp((s) => s.connected),
    pending = useApp((s) => s.pending);
  // In a room, only the player who just undid something may put it back.
  const roomRedo =
    mode === 'room' &&
    !!room?.canRedo &&
    connected &&
    pending === 0 &&
    room.me.status === 'approved' &&
    canRedoRoomAction(game, room.me.id, room.me.seatId, isHost());
  return (
    <Sheet
      title="The story so far"
      description="The latest 200 game actions. Dice live in Utilities."
      onClose={onClose}
    >
      {(mode === 'local' || roomRedo) && (
        <button
          className="secondary full"
          disabled={!game.redo.length || useApp.getState().readOnly}
          onClick={() => void act({ type: 'redo' })}
        >
          Redo last undone action
        </button>
      )}
      {mode === 'room' && !roomRedo && (
        <p className="hint">Right after you undo something, you can redo it here.</p>
      )}
      {game.history.length ? (
        <ol className="history-list">
          {[...game.history].reverse().map((entry) => (
            <li key={entry.id}>
              <span className="history-dot" />
              <div>
                <p>{entry.summary}</p>
                <small>
                  {entry.actor} ·{' '}
                  {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <Icon name="history" size={36} />
          <p>A fresh beginning.</p>
          <span>Your game actions will appear here.</span>
        </div>
      )}
    </Sheet>
  );
}
/** Who won, when life totals alone do not say: alternate wins, concessions, a draw. */
export function RecordWinner({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.confirmed)!,
    pending = useApp((s) => s.pending),
    connected = useApp((s) => s.connected),
    mode = useApp((s) => s.mode),
    readOnly = useApp((s) => s.readOnly);
  const [winners, setWinners] = useState<string[]>(() =>
    game.result ? game.result.winners : standingWinners(game),
  );
  const available = !readOnly && !pending && (mode === 'local' || connected) && isHost();
  // Teammates win together, so choosing one chooses their whole side.
  const side = (id: string) =>
    game.archenemy ? (id === game.archenemy.playerId ? [id] : teamOf(game)) : teammates(game, id);
  const save = async (command: { winners: string[]; draw?: boolean }) => {
    await act({ type: 'declareWinner', ...command });
    onClose();
  };
  return (
    <Sheet
      title="Record the winner"
      description="Saved with this game and counted in your playgroup stats."
      onClose={onClose}
    >
      <div className="winner-choices" role="group" aria-label="Winner">
        {game.order.map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={winners.includes(id)}
              disabled={!available}
              onChange={(event) =>
                setWinners(
                  event.target.checked
                    ? game.teams || game.archenemy
                      ? side(id)
                      : [...winners, id]
                    : winners.filter((winner) => !side(id).includes(winner)),
                )
              }
            />
            {game.players[id].name}
          </label>
        ))}
      </div>
      <p className="hint">
        {game.result?.draw
          ? 'This game is recorded as a draw.'
          : game.result
            ? `Recorded: ${game.result.winners.map((id) => game.players[id].name).join(' & ')}.`
            : 'Nothing is recorded yet. Eliminations alone are counted when only one side is left.'}
      </p>
      <button
        className="primary full"
        disabled={!available || !winners.length}
        onClick={() => void save({ winners })}
      >
        <Icon name="crown" />
        Record {winners.length > 1 ? 'winners' : 'winner'}
      </button>
      <button
        className="secondary full"
        disabled={!available}
        onClick={() => void save({ winners: [], draw: true })}
      >
        Record a draw
      </button>
      {game.result && (
        <button className="text-button full" disabled={!available} onClick={() => void save({ winners: [] })}>
          Clear the recorded result
        </button>
      )}
      {mode === 'room' && !isHost() && <p className="hint">The host records the result for the room.</p>}
    </Sheet>
  );
}
export function GameMenu({ onClose, open }: { onClose: () => void; open: (sheet: string) => void }) {
  const game = useApp((s) => s.confirmed)!,
    state = useApp();
  const [archive, setArchive] = useState<Game[]>([]);
  const [importText, setImportText] = useState('');
  const [recap, setRecap] = useState<{ game: Game; at: number } | null>(null);
  useEffect(() => {
    void repository.archive().then(setArchive).catch(report);
  }, []);
  const load = async (text: string) => {
    try {
      const imported = parseImport(text);
      if (
        await ask(
          'Import a local game?',
          'The current local game is archived. A shared room, if open, stays unchanged. This backup grants no room permissions.',
        )
      ) {
        await startLocal(defaultSetup(), imported);
        onClose();
      }
    } catch (e) {
      report(e);
    }
  };
  const available = !state.readOnly && !state.pending && (state.mode === 'local' || state.connected);
  const stillCurrentGame = () => {
    const current = useApp.getState();
    if (
      current.confirmed?.id !== game.id ||
      current.confirmed.status !== game.status ||
      current.screen !== 'board' ||
      current.mode !== state.mode ||
      current.room?.id !== state.room?.id
    ) {
      report(
        new Error('The game changed while this prompt was open. Review the current game and try again.'),
      );
      return false;
    }
    return true;
  };
  if (recap) return <GameRecapSheet game={recap.game} capturedAt={recap.at} onClose={() => setRecap(null)} />;
  return (
    <Sheet
      title="Around the table"
      description={
        state.mode === 'local' ? 'One device · saved in this browser' : 'Shared room · saved on your server'
      }
      onClose={onClose}
    >
      <div className="menu-list">
        <button onClick={() => open('layout')}>
          <Icon name="phone" />
          <span>Table layout</span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => open('history')}>
          <Icon name="history" />
          <span>Game history</span>
          <Icon name="arrow" />
        </button>
        <button
          disabled={!!state.pending}
          onClick={() => setRecap({ game: structuredClone(game), at: Date.now() + state.clockOffset })}
        >
          <Icon name="download" />
          <span>Share game recap</span>
          <Icon name="arrow" />
        </button>
        <button disabled={!available || !isHost()} onClick={() => open('winner')}>
          <Icon name="crown" />
          <span>{game.result ? 'Change recorded winner' : 'Record winner'}</span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => open('stats')}>
          <Icon name="people" />
          <span>Playgroup stats</span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => open('settings')}>
          <Icon name="settings" />
          <span>Display & preferences</span>
          <Icon name="arrow" />
        </button>
        {state.mode === 'room' && (
          <button onClick={() => open('room')}>
            <Icon name="people" />
            <span>Room & players</span>
            <Icon name="arrow" />
          </button>
        )}
        <button onClick={() => downloadText(gameExport(game), `command-table-${game.id.slice(0, 8)}.json`)}>
          <Icon name="download" />
          <span>Export game backup</span>
          <Icon name="arrow" />
        </button>
        <button
          disabled={!available || !isHost()}
          onClick={async () => {
            if (
              await ask(
                'Start a rematch?',
                'Save the final game and reset life, counters, damage, turns, timer and dice. Names, commander labels and seats stay.',
              )
            ) {
              if (!stillCurrentGame()) return;
              await act({ type: 'rematch' });
              onClose();
            }
          }}
        >
          <Icon name="rotate" />
          <span>Rematch · same seats</span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => open('new-game')}>
          <Icon name="plus" />
          <span>New game · change setup</span>
          <Icon name="arrow" />
        </button>
      </div>
      {state.readOnly && (
        <button className="primary full" onClick={() => void takeOver().catch(report)}>
          Take over editing in this tab
        </button>
      )}
      {state.mode === 'room' && (
        <>
          <button
            className="secondary full"
            onClick={async () => {
              if (
                await ask(
                  'Continue an independent copy?',
                  'Create a new local game from the last confirmed room state. Future changes will never merge back into the room.',
                )
              ) {
                await startLocal(defaultSetup(), game);
                onClose();
              }
            }}
          >
            Continue a copy on this device
          </button>
          <button
            className="text-button full"
            onClick={() => {
              void resumeLocal().catch(report);
              onClose();
            }}
          >
            Open my saved local game
          </button>
        </>
      )}
      <details>
        <summary>Import a game backup</summary>
        <p className="hint">Choose an exported JSON file, or paste its contents below.</p>
        <label className="file-label">
          Choose JSON backup
          <input
            aria-label="Choose JSON backup"
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size <= 2_000_000) void f.text().then(load).catch(report);
              else if (f) report(new Error('Maximum backup size is 2 MB'));
            }}
          />
        </label>
        <textarea
          aria-label="Paste backup JSON"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste game JSON"
        />
        <button className="secondary full" disabled={!importText} onClick={() => void load(importText)}>
          Validate & import
        </button>
      </details>
      <details>
        <summary>
          Recent local games <span>{archive.length} / 10</span>
        </summary>
        {archive.length ? (
          archive.map((g) => (
            <div className="archive-item" key={g.id}>
              <div>
                <strong>
                  {g.settings.preset} · {g.order.length} players
                </strong>
                <small>
                  {new Date(g.timer.startedAt).toLocaleDateString()} ·{' '}
                  {g.order.map((id) => g.players[id].name).join(', ')}
                </small>
              </div>
              <button
                onClick={async () => {
                  try {
                    if (g.status === 'active') await resumeLocal(g.id);
                    else if (await ask('Open a copy?', 'Your current local game is saved first.'))
                      await startLocal(defaultSetup(), g);
                    else return;
                    onClose();
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                {g.status === 'active' ? 'Resume' : 'Open copy'}
              </button>
              <button
                aria-label={`Delete game ${g.id.slice(0, 8)}`}
                onClick={async () => {
                  if (await ask('Delete this archived game?', 'This removes only this saved snapshot.')) {
                    await repository.deleteArchive(g.id);
                    setArchive(await repository.archive());
                  }
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ))
        ) : (
          <p className="hint">Previous games appear here when you start a new game or rematch.</p>
        )}
      </details>
      {game.status === 'active' && (
        <button
          className="danger full"
          disabled={!available || !isHost()}
          onClick={async () => {
            const choice = await choose(
              'End this game?',
              `Play again? Rematch keeps player names, colors and commanders, resets life to ${game.settings.startingLife}, and clears all game stats. End game returns home and keeps the final game for 24 hours.`,
              [
                { value: 'rematch', label: 'Rematch', primary: true },
                { value: 'end', label: 'End game' },
              ],
            );
            if (!choice || !stillCurrentGame()) return;
            await act({ type: choice === 'rematch' ? 'rematch' : 'end' });
            onClose();
          }}
        >
          End game
        </button>
      )}
      <button
        className="text-button full"
        onClick={() => {
          void openHome().catch(report);
          onClose();
        }}
      >
        Back to home
      </button>
    </Sheet>
  );
}
