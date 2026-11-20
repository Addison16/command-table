import { useState } from 'react';
import { LIMIT, palettes, type Game } from '../../shared/schema.js';
import {
  act,
  canEdit,
  report,
  saveExact,
  savePlayer,
  setPlaymatPhoto,
  useApp,
  updateProfile,
} from '../app/store.js';
import { DeckImport } from './DeckImport.js';
import { savedFromGame, saveRegular } from './SavedPlayers.js';
import { seatPhoto } from './seatPhoto.js';
import { teammates } from '../../shared/game.js';
import '../styles/extras.css';
import { ask, Field, Icon, Sheet, Toggle } from '../components/ui.js';
import { HoldButton } from '../components/HoldButton.js';
import { facesAcross } from './TableLayout.js';
import { useTableLayout } from './useTableLayout.js';
import { CommanderInput } from '../components/CommanderInput.js';
import { PlayerNameInput } from '../components/PlayerNameInput.js';
import { ArtworkImage, CommanderCredits } from '../components/CommanderArtwork.js';
import { CommanderReader } from '../components/CommanderReader.js';
import type { CommanderCard } from '../../shared/cards.js';
import { rememberDicePlayer } from '../dice/preference.js';

// Untouched fields follow the live game. Once edited, a field keeps its draft
// through local steps and remote updates until that draft is submitted.
function useLiveDraft<T extends string>(value: T) {
  const [draft, setDraft] = useState<T>();
  const reset = () => setDraft((current) => (current === draft ? undefined : current));
  return [draft ?? value, setDraft, reset] as const;
}

function Counter({
  playerId,
  field,
  value,
  disabled,
}: {
  playerId: string;
  field: string;
  value: number;
  disabled: boolean;
}) {
  const [exact, setExact, resetExact] = useLiveDraft(String(value));
  const [saving, setSaving] = useState(false);
  return (
    <div className="counter-block">
      <div className="counter-row">
        <span>{field === 'life' ? 'Life' : field === 'poison' ? 'Poison' : field}</span>
        <div className="stepper">
          <HoldButton
            disabled={disabled || (field !== 'life' && value === 0)}
            label={`Decrease ${field}`}
            accelerate={field === 'life'}
            onStep={(group, size) => void act({ type: 'adjust', playerId, field, delta: -size }, group)}
          >
            <Icon name="minus" />
          </HoldButton>
          <strong>{value}</strong>
          <HoldButton
            disabled={disabled}
            label={`Increase ${field}`}
            accelerate={field === 'life'}
            onStep={(group, size) => void act({ type: 'adjust', playerId, field, delta: size }, group)}
          >
            <Icon name="plus" />
          </HoldButton>
        </div>
      </div>
      <div className="counter-exact">
        {field === 'life' && (
          <>
            <button
              disabled={disabled}
              onClick={() => void act({ type: 'adjust', playerId, field, delta: -5 })}
            >
              −5
            </button>
            <button
              disabled={disabled}
              onClick={() => void act({ type: 'adjust', playerId, field, delta: 5 })}
            >
              +5
            </button>
          </>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (disabled || saving) return;
            setSaving(true);
            try {
              if (await saveExact({ type: 'set', playerId, field, value: Number(exact) })) resetExact();
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            aria-label={`Exact ${field}`}
            type="number"
            inputMode={field === 'life' ? 'text' : 'numeric'}
            min={field === 'life' ? -999999 : 0}
            max="999999"
            required
            disabled={disabled || saving}
            value={exact}
            onChange={(e) => setExact(e.target.value)}
          />
          <button disabled={disabled || saving}>{saving ? 'Saving…' : 'Set'}</button>
        </form>
      </div>
    </div>
  );
}
export function PlayerDetails({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    profile = useApp((s) => s.profile),
    room = useApp((s) => s.room),
    readOnly = useApp((s) => s.readOnly),
    mode = useApp((s) => s.mode);
  const player = game.players[playerId];
  const defaultName =
    mode === 'room' && room?.members.some((member) => member.id === room.hostId && member.seatId === playerId)
      ? 'Host'
      : `Player ${game.order.indexOf(playerId) + 1}`;
  const { layout, automatic } = useTableLayout();
  const opponents = game.order.filter((id) => id !== playerId);
  const damageSources = opponents.flatMap((id) =>
    Object.values(game.commanders).filter((commander) => commander.ownerId === id),
  );
  const [sourceId, setSource] = useState('');
  const source = damageSources.find((commander) => commander.id === sourceId) ?? damageSources[0];
  const [amount, setAmount] = useState('1');
  const [subtractLife, setSubtractLife] = useState(true);
  const [name, setName, resetName] = useLiveDraft(player.name),
    [color, setColor, resetColor] = useLiveDraft(player.color);
  const [commanderDrafts, setCommanderDrafts] = useState<
    Record<string, { label: string; card: CommanderCard | null }>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const commanders = Object.values(game.commanders).filter((c) => c.ownerId === playerId);
  const disabled = !canEdit(playerId) || player.eliminated || game.status === 'ended';
  const damageDisabled = disabled || !source;
  const manage = canEdit(playerId) && game.status === 'active';
  const pending = useApp((s) => s.pending);
  const photo = useApp((s) => s.playmats[player.name.trim().toLowerCase()]);
  const [backdrop, setBackdrop] = useState<{ label: string; card: CommanderCard | null }>();
  const [backdropStatus, setBackdropStatus] = useState('');
  const teammate = game.teams ? teammates(game, playerId).find((id) => id !== playerId) : undefined;
  const saveBackdrop = async (card: CommanderCard | null) => {
    setBackdropStatus('');
    const saved = await savePlayer({
      type: 'editPlayer',
      playerId,
      name: player.name,
      color: player.color,
      commanders: commanders.map((commander) => ({
        id: commander.id,
        label: commander.label,
        card: commander.card ?? null,
      })),
      playmat: card,
    });
    if (saved) setBackdrop(undefined);
    setBackdropStatus(
      saved
        ? card
          ? 'Seat background saved.'
          : 'Seat background removed.'
        : 'Save not confirmed. Try again.',
    );
  };
  return (
    <Sheet
      title={player.name}
      description={
        mode === 'room' && !canEdit(playerId)
          ? 'View this player’s information and commanders. Each player controls their own seat.'
          : game.archenemy?.playerId === playerId
            ? 'The archenemy. You scheme alone against the whole table.'
            : game.archenemy
              ? 'On the team. Your teammates share your turn and your victory.'
              : teammate
                ? `Teamed with ${game.players[teammate].name}. You share life, poison and your turn.`
                : 'Your life, your legends, your next move.'
      }
      onClose={onClose}
    >
      <CommanderReader commanders={commanders} />
      <CommanderCredits
        cards={Object.values(game.commanders)
          .filter((c) => c.ownerId === playerId && c.card)
          .map((c) => c.card!)}
      />
      <details className="edit-player">
        <summary>
          <Icon name="settings" />
          Edit player & commanders
        </summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!manage || saving) return;
            setSaving(true);
            setSaveStatus('');
            try {
              const saved = await savePlayer({
                type: 'editPlayer',
                playerId,
                name: name.trim() || defaultName,
                color,
                commanders: commanders.map((commander, index) => {
                  const selection = commanderDrafts[commander.id] ?? {
                    label: commander.label,
                    card: commander.card ?? null,
                  };
                  return {
                    id: commander.id,
                    ...selection,
                    label: selection.label.trim() || `Commander ${index + 1}`,
                  };
                }),
              });
              if (!saved) {
                setSaveStatus('Save not confirmed. Your edits are still here.');
                return;
              }
              if (mode === 'local') rememberDicePlayer(game.id, playerId);
              resetName();
              resetColor();
              setCommanderDrafts((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(([id, draft]) => draft !== commanderDrafts[id]),
                ),
              );
              setSaveStatus('Changes saved.');
            } finally {
              setSaving(false);
            }
          }}
        >
          <PlayerNameInput
            label="Player name"
            value={name}
            defaultName={defaultName}
            disabled={!manage || saving}
            onChange={(value) => {
              setName(value);
              setSaveStatus('');
            }}
          />
          <Field label="Player color">
            <select
              value={color}
              disabled={!manage || saving}
              onChange={(e) => {
                setColor(e.target.value as typeof color);
                setSaveStatus('');
              }}
            >
              {palettes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {game.settings.commander && (
            <DeckImport
              disabled={!manage || saving}
              onImport={(imported) => {
                setCommanderDrafts((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    commanders
                      .slice(0, imported.length)
                      .map((commander, index) => [
                        commander.id,
                        { label: imported[index].name, card: imported[index].card },
                      ]),
                  ),
                }));
                setSaveStatus('Deck commander filled in. Save changes to keep it.');
              }}
            />
          )}
          {commanders.map((commander, index) => {
            const selection = commanderDrafts[commander.id] ?? {
              label: commander.label,
              card: commander.card ?? null,
            };
            return (
              <CommanderInput
                key={commander.id}
                label={`Commander ${index + 1} name`}
                value={selection.label}
                card={selection.card}
                disabled={!manage || saving}
                onChange={(label, card) => {
                  setCommanderDrafts((current) => ({ ...current, [commander.id]: { label, card } }));
                  setSaveStatus('');
                }}
              />
            );
          })}
          <button className="secondary full" disabled={!manage || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saveStatus && (
            <p className="hint" role="status">
              {saveStatus}
            </p>
          )}
        </form>
        {!manage && (
          <p className="hint">
            {readOnly
              ? 'Take over this tab to edit.'
              : game.status === 'ended'
                ? 'This game has ended.'
                : 'Only the player in this seat can edit their information.'}
          </p>
        )}
      </details>
      {player.eliminated && (
        <div className="notice">
          <strong>This player is eliminated.</strong>
          <p>Restore to resume edits. A turn highlight on this seat stays until you move it in Utilities.</p>
          <button
            className="primary"
            disabled={!manage}
            onClick={() => void act({ type: 'eliminate', playerId, eliminated: false })}
          >
            Restore player
          </button>
        </div>
      )}
      <Counter playerId={playerId} field="life" value={player.life} disabled={disabled} />
      {game.settings.poison && (
        <>
          <Counter playerId={playerId} field="poison" value={player.poison} disabled={disabled} />
          <p className="hint">
            Warning at {game.settings.poisonThreshold} poison. Elimination is always manual.
          </p>
        </>
      )}
      {game.settings.commander && (
        <>
          <section className="detail-section">
            <h3>
              <Icon name="shield" />
              Commander damage received
            </h3>
            <p className="hint">
              Each opposing commander is tracked separately. Warning at {game.settings.commanderThreshold}{' '}
              from one source.
            </p>
            {!source && <p className="hint">No opposing commanders are available.</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (damageDisabled || !source) return;
                void act({
                  type: 'damage',
                  playerId,
                  commanderId: source.id,
                  amount: Number(amount),
                  subtractLife,
                });
              }}
            >
              <Field label="Combat damage source">
                <select
                  disabled={damageDisabled}
                  value={source?.id ?? ''}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {!source && <option value="">No opposing commanders</option>}
                  {opponents.map((owner) => (
                    <optgroup label={game.players[owner].name} key={owner}>
                      {Object.values(game.commanders)
                        .filter((c) => c.ownerId === owner)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} · {game.damageReceived[playerId]?.[c.id] ?? 0} recorded
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="Damage amount">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999999"
                  required
                  disabled={damageDisabled}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Toggle disabled={damageDisabled} checked={subtractLife} onChange={setSubtractLife}>
                Also subtract this much life
              </Toggle>
              <p className="hint">
                For infect or other effects, switch off life loss and adjust poison separately.
              </p>
              <button className="primary full" disabled={damageDisabled}>
                Record combat damage
              </button>
            </form>
            <details>
              <summary>
                Correct recorded totals <span>Damage only</span>
              </summary>
              {opponents.map((owner) => (
                <div className="damage-owner" key={owner}>
                  <h4>{game.players[owner].name}</h4>
                  {Object.values(game.commanders)
                    .filter((c) => c.ownerId === owner)
                    .map((c) => (
                      <DamageCorrection
                        key={c.id}
                        playerId={playerId}
                        commanderId={c.id}
                        label={c.label}
                        value={game.damageReceived[playerId]?.[c.id] ?? 0}
                        disabled={disabled}
                      />
                    ))}
                </div>
              ))}
            </details>
          </section>
          <section className="detail-section">
            <h3>
              <Icon name="crown" />
              Command-zone casts
            </h3>
            {Object.values(game.commanders)
              .filter((c) => c.ownerId === playerId)
              .map((c) => (
                <CommanderCasts key={c.id} commander={c} disabled={disabled} />
              ))}
          </section>
        </>
      )}
      {(game.settings.markerTrackers.includes('monarch') ||
        game.settings.markerTrackers.includes('initiative')) && (
        <section className="detail-section">
          <h3>
            <Icon name="crown" />
            Table markers
          </h3>
          <div className="marker-actions">
            {(['monarch', 'initiative'] as const)
              .filter((marker) => game.settings.markerTrackers.includes(marker))
              .map((marker) => {
                const held = game.markers[marker] === playerId;
                return (
                  <button
                    key={marker}
                    className={held ? 'selected' : 'secondary'}
                    aria-pressed={held}
                    disabled={disabled || pending > 0}
                    onClick={() => void act({ type: 'marker', marker, playerId: held ? null : playerId })}
                  >
                    {marker === 'monarch'
                      ? held
                        ? '♛ The monarch · give it up'
                        : '♛ Become the monarch'
                      : held
                        ? '◆ Has the initiative · give it up'
                        : '◆ Take the initiative'}
                  </button>
                );
              })}
          </div>
          <p className="hint">One player holds each marker. Taking it moves it from whoever had it.</p>
        </section>
      )}
      {game.settings.counters.length > 0 && (
        <section className="detail-section">
          <h3>Manual counters</h3>
          {game.settings.counters.map((field) => (
            <Counter
              key={field}
              playerId={playerId}
              field={field}
              value={player.counters[field] ?? 0}
              disabled={disabled}
            />
          ))}
        </section>
      )}
      <section className="detail-section">
        <h3>Make it yours</h3>
        <Toggle
          checked={
            (!automatic ? profile.rotations[playerId] : undefined) ??
            facesAcross(layout, game.order.indexOf(playerId), game.order.length)
          }
          onChange={(flipped) => {
            dispatchEvent(new Event('mtg-cancel-input'));
            void updateProfile({
              autoTableLayout: false,
              tableLayout: layout,
              rotations: { ...(!automatic ? profile.rotations : {}), [playerId]: flipped },
            });
          }}
        >
          Face this seat across the table
        </Toggle>
        <p className="hint">
          Only changes the view on this device. Flipping a seat turns off automatic layout. Player sheets stay
          upright.
        </p>
        <div className="seat-background">
          <h4>Seat background</h4>
          <p className="hint">
            Any card’s art can sit behind this seat in place of the commander. Everyone at the table sees it.
          </p>
          <CommanderInput
            label="Background card"
            value={backdrop?.label ?? player.playmat?.name ?? ''}
            card={backdrop ? backdrop.card : (player.playmat ?? null)}
            disabled={!manage || pending > 0}
            onChange={(label, card) => {
              setBackdropStatus('');
              if (card) void saveBackdrop(card);
              // “Remove artwork” reports the unchanged name with no card.
              else if (player.playmat && !backdrop && label === player.playmat.name) void saveBackdrop(null);
              else setBackdrop({ label, card: null });
            }}
          />
          {backdropStatus && (
            <p className="hint" role="status">
              {backdropStatus}
            </p>
          )}
          <div className="seat-background-photo">
            {photo && <img src={photo} alt={`${player.name}’s seat photo`} />}
            <label className="file-label">
              {photo ? 'Change photo' : 'Or use your own photo'}
              <input
                aria-label="Seat background photo"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file)
                    void seatPhoto(file)
                      .then((image) => setPlaymatPhoto(player.name, image))
                      .catch(report);
                }}
              />
            </label>
            {photo && (
              <button className="text-button" onClick={() => void setPlaymatPhoto(player.name, null)}>
                Remove photo
              </button>
            )}
          </div>
          <p className="hint">
            A photo stays on this device only and follows this player’s name. It is never uploaded.
          </p>
        </div>
        <button
          className="secondary full"
          onClick={() => void saveRegular(savedFromGame(game, playerId)).catch(report)}
        >
          Save to my regulars
        </button>
        <p className="hint">Saves this name, color, commanders and background for one-tap setup next time.</p>
        {commanders.some((commander) => commander.card) && (
          <div className="artwork-framing">
            <h4>Artwork framing on this device</h4>
            <p className="hint">Bring your commander into view. Slide to find the best crop for your seat.</p>
            {commanders
              .filter((commander) => commander.card)
              .map((commander) => (
                <div key={commander.id} className="artwork-framing-control">
                  <div className="artwork-framing-previews" aria-hidden="true">
                    <div className="artwork-framing-preview portrait">
                      <ArtworkImage key={commander.card!.imageUrl} card={commander.card!} />
                      <span>Portrait</span>
                    </div>
                    <div className="artwork-framing-preview">
                      <ArtworkImage key={commander.card!.imageUrl} card={commander.card!} />
                      <span>Landscape</span>
                    </div>
                  </div>
                  {(['x', 'y'] as const).map((axis) => (
                    <Field
                      key={axis}
                      label={`${commander.label} artwork ${axis === 'x' ? 'horizontal' : 'vertical'} position`}
                    >
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={profile.artPositions[commander.card!.id]?.[axis] ?? (axis === 'x' ? 50 : 35)}
                        onChange={(e) => {
                          const id = commander.card!.id;
                          const current = useApp.getState().profile.artPositions;
                          const positions = Object.fromEntries(
                            Object.entries(current)
                              .filter(([key]) => key !== id)
                              .slice(-63),
                          );
                          const position = {
                            ...(current[id] ?? { x: 50, y: 35 }),
                            [axis]: Number(e.target.value),
                          };
                          void updateProfile({ artPositions: { ...positions, [id]: position } });
                        }}
                      />
                    </Field>
                  ))}
                </div>
              ))}
          </div>
        )}
      </section>
      {!player.eliminated && (
        <button
          className="danger full"
          disabled={!manage}
          onClick={async () => {
            if (
              await ask(
                `Eliminate ${player.name}?`,
                'The seat stays at the table. You can restore this player at any time. If the turn highlight is on this seat, move it in Utilities.',
              )
            )
              void act({ type: 'eliminate', playerId, eliminated: true });
          }}
        >
          Eliminate player
        </button>
      )}
    </Sheet>
  );
}
function DamageCorrection({
  playerId,
  commanderId,
  label,
  value,
  disabled,
}: {
  playerId: string;
  commanderId: string;
  label: string;
  value: number;
  disabled: boolean;
}) {
  const [total, setTotal, resetTotal] = useLiveDraft(String(value));
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="damage-correction"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || saving) return;
        setSaving(true);
        try {
          if (await saveExact({ type: 'damageSet', playerId, commanderId, value: Number(total) }))
            resetTotal();
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        <span>
          {label} <small>· {value} recorded</small>
        </span>
        <input
          aria-label={`${label} recorded damage`}
          type="number"
          inputMode="numeric"
          required
          min="0"
          max="999999"
          disabled={disabled || saving}
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>
      <button disabled={disabled || saving}>{saving ? 'Saving…' : 'Correct'}</button>
    </form>
  );
}

export function CommanderCasts({
  commander,
  disabled,
}: {
  commander: Game['commanders'][string];
  disabled: boolean;
}) {
  const [casts, setCasts, resetCasts] = useLiveDraft(String(commander.casts));
  const [saving, setSaving] = useState(false);
  return (
    <div className="commander-casts">
      <h4>{commander.label}</h4>
      <p className="tax">
        Next cast: <strong>+{commander.casts * 2}</strong> additional mana
      </p>
      <p className="hint">
        {commander.casts} previous command-zone {commander.casts === 1 ? 'cast' : 'casts'}. Other zones do not
        count.
      </p>
      <button
        className="secondary full"
        disabled={disabled || commander.casts >= LIMIT}
        onClick={() => void act({ type: 'cast', commanderId: commander.id })}
      >
        Record cast
      </button>
      <details>
        <summary>Correct casts</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (disabled || saving) return;
            setSaving(true);
            try {
              if (await saveExact({ type: 'castSet', commanderId: commander.id, value: Number(casts) }))
                resetCasts();
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Previous command-zone casts">
            <input
              type="number"
              name="casts"
              inputMode="numeric"
              min="0"
              max="999999"
              required
              disabled={disabled || saving}
              value={casts}
              onChange={(e) => setCasts(e.target.value)}
            />
          </Field>
          <button disabled={disabled || saving}>{saving ? 'Saving…' : 'Correct casts'}</button>
        </form>
      </details>
    </div>
  );
}
