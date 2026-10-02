import { useEffect, useState } from 'react';
import { elapsed } from '../../shared/game.js';
import { type Command, type Roll } from '../../shared/schema.js';
import { act, isHost, useApp, takeOver, report } from '../app/store.js';
import { Field, Icon, Sheet, Toggle } from '../components/ui.js';
import { rollTitle } from '../dice/DiceRoll.js';
import { preferredDicePlayer, rememberDicePlayer } from '../dice/preference.js';
const formatTime = (ms: number) => {
  const sec = Math.floor(ms / 1000);
  return [Math.floor(sec / 3600), Math.floor((sec / 60) % 60), sec % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};
export function Utilities({
  onClose,
  onReplay,
  onGroupLife,
}: {
  onClose: () => void;
  onReplay: (roll: Roll) => void;
  onGroupLife: () => void;
}) {
  const game = useApp((s) => s.game)!,
    connected = useApp((s) => s.connected),
    mode = useApp((s) => s.mode),
    room = useApp((s) => s.room),
    profile = useApp((s) => s.profile),
    readOnly = useApp((s) => s.readOnly),
    pending = useApp((s) => s.pending),
    offset = useApp((s) => s.clockOffset);
  const [sides, setSides] = useState<4 | 6 | 8 | 10 | 12 | 20 | 100>(20),
    [count, setCount] = useState(1);
  const [playerId, setPlayerId] = useState(() =>
    preferredDicePlayer(game, { mode, ownedSeat: room?.me.seatId, localSeat: profile.mySeat }),
  );
  // A newly committed result opens on the board, never in this sheet first.
  const [previousRolls] = useState(() => game.rolls.slice(0, 8));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const enabled = !readOnly && (mode === 'local' || connected),
    host = enabled && isHost() && game.status === 'active';
  const eligible = game.order.filter((id) => !game.players[id].eliminated);
  const roll = (kind: Extract<Command, { type: 'roll' }>['kind']) =>
    void act({
      type: 'roll',
      kind,
      sides,
      count,
      ...((kind === 'dice' || kind === 'coin') && game.players[playerId] ? { playerId } : {}),
    });
  return (
    <Sheet
      title="A little luck & magic"
      description="Roll right onto the table. Everyone sees the same result."
      onClose={onClose}
    >
      {readOnly && (
        <div className="notice">
          <p>Another tab is controlling this game. Take over here to roll or edit.</p>
          <button className="primary" onClick={() => void takeOver().catch(report)}>
            Use this tab
          </button>
        </div>
      )}
      {mode === 'room' && !connected && (
        <div className="notice">
          <p>Reconnecting — dice will be available when your room is live.</p>
          <button
            onClick={() =>
              void import('../adapters/room.js').then(({ connectRoom }) =>
                connectRoom(useApp.getState().profile.roomId!),
              )
            }
          >
            Reconnect now
          </button>
        </div>
      )}
      <section className="detail-section first">
        <h3>
          <Icon name="dice" />
          Roll the dice
        </h3>
        <Field label="Roll for">
          <select
            value={game.players[playerId] ? playerId : ''}
            onChange={(e) => {
              setPlayerId(e.target.value);
              rememberDicePlayer(game.id, e.target.value);
            }}
          >
            <option value="">The table · ivory dice</option>
            {game.order.map((id) => (
              <option key={id} value={id}>
                {game.players[id].name} · {game.players[id].color}
              </option>
            ))}
          </select>
        </Field>
        <p className="hint">Dice match this player’s current color. Choose the table for ivory dice.</p>
        <div className="dice-picker">
          {([4, 6, 8, 10, 12, 20, 100] as const).map((n) => (
            <button
              key={n}
              className={sides === n ? 'selected' : ''}
              aria-pressed={sides === n}
              onClick={() => setSides(n)}
            >
              d{n}
            </button>
          ))}
        </div>
        <div className="roll-form">
          <Field label="Number of dice">
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </Field>
          <button className="primary" disabled={!enabled} onClick={() => roll('dice')}>
            <Icon name="dice" />
            Roll {count}d{sides}
          </button>
        </div>
        {sides === 100 && <p className="hint">Percentile dice · 1–100. Double zero is 100.</p>}
        <button className="secondary full" disabled={!enabled} onClick={() => roll('coin')}>
          Flip a coin
        </button>
        {game.status === 'ended' && <p className="hint">This game has ended. You can still roll dice.</p>}
      </section>
      <section className="detail-section">
        <h3>
          <Icon name="people" />
          Group life change
        </h3>
        <p className="hint">Apply life loss to selected opponents, with optional life gain for the caster.</p>
        <button
          className="secondary full"
          disabled={mode === 'room' || !host || pending > 0}
          onClick={onGroupLife}
        >
          Group life change
        </button>
        {mode === 'room' && (
          <p className="hint">In shared rooms, each player records life changes on their own seat.</p>
        )}
      </section>
      <section className="detail-section">
        <h3>
          <Icon name="spark" />
          Who goes first?
        </h3>
        <p className="hint">
          Roll a d20 for each player. Tied leaders roll again, then the winner is revealed.
        </p>
        <button
          className="primary full"
          disabled={!enabled || !eligible.length}
          onClick={() => roll('d20-each')}
        >
          <Icon name="dice" />
          d20 for everyone
        </button>
        <button
          className="text-button full"
          disabled={!enabled || !eligible.length}
          onClick={() => roll('first')}
        >
          Just choose a player
        </button>
        {!eligible.length && <p className="hint">Restore a player to choose who starts.</p>}
      </section>
      {previousRolls.length > 0 && (
        <section className="detail-section">
          <h3>Recent rolls</h3>
          {previousRolls.map((r) => (
            <button className="roll-history roll-history-button" key={r.id} onClick={() => onReplay(r)}>
              <span>
                {rollTitle(r)}
                <small>{r.actor}</small>
              </span>
              <strong>
                {r.winner
                  ? game.players[r.winner]?.name
                  : r.kind === 'coin'
                    ? r.values[0] === 1
                      ? 'Heads'
                      : 'Tails'
                    : r.values.reduce((a, b) => a + b, 0)}
              </strong>
              <Icon name="arrow" />
            </button>
          ))}
        </section>
      )}
      <section className="detail-section turn-preferences">
        <Toggle
          disabled={!host || pending > 0}
          checked={game.settings.turnTracking}
          onChange={(enabled) => void act({ type: 'turnTracking', enabled })}
        >
          Turn tracking
        </Toggle>
        <p className="hint">Optional. Adds a small Next turn button beside Undo.</p>
        {mode === 'room' && !isHost() && (
          <p className="hint">The host controls turn tracking for the room.</p>
        )}
        {game.settings.turnTracking && (
          <Field label="Current player">
            <select
              disabled={!host || pending > 0}
              value={game.turn.playerId ?? ''}
              onChange={(e) => void act({ type: 'turn', playerId: e.target.value || null, advance: false })}
            >
              <option value="">Choose a player</option>
              {eligible.map((id) => (
                <option key={id} value={id}>
                  {game.players[id].name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </section>
      <details>
        <summary>
          Game timer <span>{formatTime(elapsed(game, now + offset))}</span>
        </summary>
        <div className="timer-row">
          <strong className="timer">{formatTime(elapsed(game, now + offset))}</strong>
          <button
            disabled={!host}
            onClick={() =>
              void act({ type: 'timer', action: game.timer.pausedAt === null ? 'pause' : 'resume' })
            }
          >
            {game.timer.pausedAt === null ? 'Pause' : 'Resume'}
          </button>
        </div>
      </details>
    </Sheet>
  );
}
