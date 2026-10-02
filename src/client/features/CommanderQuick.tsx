import { useEffect, useRef, useState } from 'react';
import { LIMIT } from '../../shared/schema.js';
import { canEdit, notify, saveDamage, useApp } from '../app/store.js';
import { ArtworkImage } from '../components/CommanderArtwork.js';
import { Icon, Sheet, Toggle } from '../components/ui.js';
import { CommanderCasts } from './PlayerDetails.js';
import '../styles/commander-quick.css';

// A convenience for this device, never part of the shared game's rules or data.
const damageSources = new Map<string, string>();
const sourceKey = (gameId: string, playerId: string) => `mtg-util:damage-source:${gameId}:${playerId}`;
function rememberedSource(key: string) {
  try {
    return damageSources.get(key) ?? sessionStorage.getItem(key) ?? '';
  } catch {
    return damageSources.get(key) ?? '';
  }
}
function rememberSource(key: string, commanderId: string) {
  damageSources.set(key, commanderId);
  if (damageSources.size > 64) damageSources.delete(damageSources.keys().next().value!);
  try {
    sessionStorage.setItem(key, commanderId);
  } catch {
    // The in-memory selection still works when browser storage is unavailable.
  }
}

export function CommanderQuick({
  playerId,
  commanderId,
  mode,
  onClose,
}: {
  playerId: string;
  commanderId?: string;
  mode: 'damage' | 'tax';
  onClose: () => void;
}) {
  const state = useApp();
  const game = state.game!;
  const player = game.players[playerId];
  const preferenceKey = sourceKey(game.id, playerId);
  const [selectedId, setSelectedId] = useState(() => commanderId ?? rememberedSource(preferenceKey));
  const [amountText, setAmountText] = useState('1');
  const [subtractLife, setSubtractLife] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const commanders = game.order
    .filter((id) => (mode === 'damage' ? id !== playerId : id === playerId))
    .flatMap((id) => Object.values(game.commanders).filter((commander) => commander.ownerId === id));
  const selected = commanders.find((commander) => commander.id === selectedId);
  const disabled =
    !canEdit(playerId) ||
    state.recovery ||
    player.eliminated ||
    game.status !== 'active' ||
    !game.settings.commander;
  const busy = saving || state.pending > 0;
  const damageDisabled = disabled || busy || commanders.length === 0;
  const amount = /^\d+$/.test(amountText) ? Number(amountText) : NaN;
  const validAmount = Number.isSafeInteger(amount) && amount > 0 && amount <= LIMIT;
  const received = selected ? (game.damageReceived[playerId]?.[selected.id] ?? 0) : 0;
  const withinBounds =
    validAmount && received + amount <= LIMIT && (!subtractLife || player.life - amount >= -LIMIT);
  const canApply = !disabled && !busy && !unconfirmed && !!selected && withinBounds;
  return (
    <Sheet
      compact
      title={mode === 'damage' ? 'Commander damage' : 'Commander tax'}
      description={
        mode === 'damage' ? `${player.name} · damage received` : `${player.name} · command-zone casts`
      }
      onClose={onClose}
    >
      <div className="commander-quick">
        {(mode === 'damage' && commanders.length > 0) || commanders.length > 1 ? (
          <div>
            <p className="quick-source-label">
              {mode === 'damage' ? 'Which commander dealt damage?' : 'Choose your commander'}
            </p>
            <div
              className="commander-source-list"
              role="group"
              aria-label={mode === 'damage' ? 'Combat damage source' : 'Your commanders'}
            >
              {commanders.map((commander) => {
                const owner = game.players[commander.ownerId];
                const total = game.damageReceived[playerId]?.[commander.id] ?? 0;
                return (
                  <button
                    type="button"
                    className={`commander-source ${owner.color}`}
                    key={commander.id}
                    aria-pressed={selected?.id === commander.id}
                    aria-label={`${owner.name}: ${commander.label}, ${mode === 'damage' ? `${total} damage recorded` : `tax +${commander.casts * 2}`}`}
                    disabled={saving}
                    onClick={() => {
                      setSelectedId(commander.id);
                      if (mode === 'damage') rememberSource(preferenceKey, commander.id);
                    }}
                  >
                    <span className="commander-source-art" aria-hidden="true">
                      <Icon name="card" />
                      {commander.card && <ArtworkImage key={commander.card.imageUrl} card={commander.card} />}
                    </span>
                    <span className="commander-source-name">
                      <small>{owner.name}</small>
                      <strong>{commander.label}</strong>
                    </span>
                    <span
                      className={`commander-source-total ${mode === 'damage' && total >= game.settings.commanderThreshold ? 'is-warning' : ''}`}
                    >
                      {mode === 'damage' ? total : `+${commander.casts * 2}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {mode === 'damage' && commanders.length === 0 && (
          <p className="hint">No opposing commanders are available.</p>
        )}
        {mode === 'damage' ? (
          <form
            className="quick-damage-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!canApply || !selected || submitting.current) return;
              submitting.current = true;
              setSaving(true);
              const saved = await saveDamage({
                type: 'damage',
                playerId,
                commanderId: selected.id,
                amount,
                subtractLife,
              });
              if (!mounted.current) return;
              submitting.current = false;
              setSaving(false);
              if (saved) {
                notify(`${amount} commander damage recorded${subtractLife ? ` · ${amount} life lost` : ''}.`);
                onClose();
              } else setUnconfirmed(true);
            }}
          >
            <label className="quick-source-label" htmlFor="quick-damage-amount">
              Damage amount
            </label>
            <div className="quick-damage-stepper">
              <button
                type="button"
                aria-label="Decrease damage amount"
                disabled={damageDisabled || !validAmount || amount <= 1}
                onClick={() => setAmountText(String(amount - 1))}
              >
                <Icon name="minus" />
              </button>
              <input
                id="quick-damage-amount"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMIT}
                step={1}
                required
                value={amountText}
                disabled={damageDisabled}
                onChange={(event) => setAmountText(event.target.value)}
              />
              <button
                type="button"
                aria-label="Increase damage amount"
                disabled={damageDisabled || !validAmount || amount >= LIMIT}
                onClick={() => setAmountText(String(amount + 1))}
              >
                <Icon name="plus" />
              </button>
            </div>
            <Toggle checked={subtractLife} onChange={setSubtractLife} disabled={damageDisabled}>
              Also subtract this much life
            </Toggle>
            {selected && validAmount && (
              <p className="quick-damage-preview" aria-live="polite">
                <span>
                  {selected.label}:{' '}
                  <strong>
                    {received} → {received + amount}
                  </strong>{' '}
                  damage
                </span>
                <span>
                  {player.name}:{' '}
                  <strong>
                    {player.life}
                    {subtractLife ? ` → ${player.life - amount}` : ''}
                  </strong>{' '}
                  life
                </span>
              </p>
            )}
            {validAmount && !withinBounds && (
              <p role="alert">This change would exceed the supported totals.</p>
            )}
            {unconfirmed && (
              <p role="alert">
                Damage was not confirmed. Check the totals and history after reconnecting before recording it
                again.
              </p>
            )}
            <button className="primary full" disabled={!canApply}>
              {saving ? 'Saving…' : 'Apply damage'}
              {!saving && <Icon name="check" size={17} />}
            </button>
            <p className="hint">
              Each opposing commander counts separately. Warning at {game.settings.commanderThreshold}. For
              infect, turn off life loss and adjust poison separately.
            </p>
          </form>
        ) : selected ? (
          <CommanderCasts key={selected.id} commander={selected} disabled={disabled || busy} />
        ) : (
          <p className="hint">Choose a commander to view their tax.</p>
        )}
        {disabled && (
          <p className="hint">
            {game.status !== 'active'
              ? 'This game has ended.'
              : player.eliminated
                ? 'Restore this player in player details to make changes.'
                : !game.settings.commander
                  ? 'Commander tracking is turned off.'
                  : state.mode === 'room'
                    ? 'Each player controls their own seat. Reconnect to edit your seat.'
                    : 'Take over this tab or resolve storage recovery before editing.'}
          </p>
        )}
        {selected?.card && (
          <a className="quick-art-credit" href={selected.card.scryfallUrl} target="_blank" rel="noreferrer">
            Art by {selected.card.artist} · © Wizards of the Coast · Scryfall ↗
          </a>
        )}
      </div>
    </Sheet>
  );
}
