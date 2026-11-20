import { useEffect, useState } from 'react';
import { useApp } from '../app/store.js';
import { Icon, Sheet } from '../components/ui.js';
import '../styles/extras.css';

const mana = [
  ['W', 'White'],
  ['U', 'Blue'],
  ['B', 'Black'],
  ['R', 'Red'],
  ['G', 'Green'],
  ['C', 'Colorless'],
] as const;
type Pool = { turn: string; storm: number; mana: Record<string, number> };
const empty = (turn: string): Pool => ({ turn, storm: 0, mana: {} });
const key = 'command-table-turn-tools';
/** The scratchpad belongs to one turn of one game. Anything older starts clean. */
export function loadPool(turn: string, stored: string | null): Pool {
  try {
    const value = JSON.parse(stored ?? 'null') as Partial<Pool> | null;
    if (!value || value.turn !== turn) return empty(turn);
    const count = (n: unknown) => (Number.isSafeInteger(n) ? Math.min(999, Math.max(0, n as number)) : 0);
    return {
      turn,
      storm: count(value.storm),
      mana: Object.fromEntries(mana.map(([symbol]) => [symbol, count(value.mana?.[symbol])])),
    };
  } catch {
    return empty(turn);
  }
}
const read = (turn: string) => {
  try {
    return loadPool(turn, sessionStorage.getItem(key));
  } catch {
    return empty(turn);
  }
};

function Stepper({
  label,
  mark,
  value,
  onChange,
}: {
  label: string;
  mark?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="turn-tool-row" data-mana={mark}>
      <span>
        {mark && (
          <i className="mana-mark" aria-hidden="true">
            {mark}
          </i>
        )}
        {label}
      </span>
      <div className="stepper">
        <button aria-label={`Decrease ${label}`} disabled={value === 0} onClick={() => onChange(value - 1)}>
          <Icon name="minus" />
        </button>
        <strong aria-live="polite" aria-label={`${label}: ${value}`}>
          {value}
        </strong>
        <button aria-label={`Increase ${label}`} disabled={value >= 999} onClick={() => onChange(value + 1)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

/** A scratchpad for one busy turn: spells cast and mana floating. It stays on this device. */
export function TurnTools({ onClose }: { onClose: () => void }) {
  const turn = useApp((s) => `${s.game?.id}:${s.game?.turn.number}:${s.game?.turn.playerId ?? ''}`);
  const tracked = useApp((s) => !!s.game?.settings.turnTracking);
  const [pool, setPool] = useState(() => read(turn));
  // A new turn empties the pool, the same as the game does.
  const live = pool.turn === turn ? pool : empty(turn);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(live));
    } catch {
      /* The scratchpad still works for as long as this sheet is open. */
    }
  }, [live]);
  const total = mana.reduce((sum, [symbol]) => sum + (live.mana[symbol] ?? 0), 0);
  const used = live.storm > 0 || total > 0;
  return (
    <Sheet
      title="This turn"
      description="Count spells for storm and keep track of floating mana. Only this device sees it."
      onClose={onClose}
    >
      <section className="detail-section first">
        <h3>
          <Icon name="spark" />
          Storm count
        </h3>
        <Stepper
          label="Spells cast this turn"
          value={live.storm}
          onChange={(storm) => setPool({ ...live, storm })}
        />
        <p className="hint" data-testid="storm-copies">
          {live.storm > 1
            ? `A storm spell cast now would be copied ${live.storm} times.`
            : live.storm === 1
              ? 'A storm spell cast now would be copied once.'
              : 'Add one for each spell cast this turn, by any player.'}
        </p>
      </section>
      <section className="detail-section">
        <h3>
          <Icon name="tax" />
          Mana pool <span data-testid="mana-total">{total}</span>
        </h3>
        {mana.map(([symbol, name]) => (
          <Stepper
            key={symbol}
            label={name}
            mark={symbol}
            value={live.mana[symbol] ?? 0}
            onChange={(value) => setPool({ ...live, mana: { ...live.mana, [symbol]: value } })}
          />
        ))}
      </section>
      <button className="secondary full" disabled={!used} onClick={() => setPool(empty(turn))}>
        Clear for the next turn
      </button>
      <p className="hint">
        {tracked
          ? 'This clears by itself when the turn passes.'
          : 'Turn tracking is off, so clear it yourself when the turn ends.'}
      </p>
      <button className="secondary full" onClick={onClose}>
        Back to game
      </button>
    </Sheet>
  );
}
