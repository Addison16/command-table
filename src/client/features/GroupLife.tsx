import { useEffect, useRef, useState } from 'react';
import { LIMIT } from '../../shared/schema.js';
import { notify, saveGroupLife, useApp } from '../app/store.js';
import { Field, Icon, Sheet, Toggle } from '../components/ui.js';
import '../styles/group-life.css';

function wholeNumber(value: string, minimum: number) {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= LIMIT ? number : null;
}

export function GroupLife({ onClose }: { onClose: () => void }) {
  const state = useApp();
  const game = state.confirmed!;
  const [casterId, setCasterId] = useState('');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [lossText, setLossText] = useState('1');
  const [gainEnabled, setGainEnabled] = useState(false);
  const [gainText, setGainText] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const caster = game.players[casterId];
  const loss = wholeNumber(lossText, 1);
  const gain = gainEnabled ? wholeNumber(gainText, 0) : 0;
  const targets = targetIds.map((id) => game.players[id]);
  const participantsValid =
    !!caster &&
    !caster.eliminated &&
    targets.length > 0 &&
    targets.every((player) => player && !player.eliminated && player.id !== casterId);
  const amountsValid = loss !== null && gain !== null;
  const withinBounds =
    amountsValid &&
    (!caster || caster.life + gain <= LIMIT) &&
    targets.every((player) => player && player.life - loss >= -LIMIT);
  const available =
    state.mode === 'local' &&
    !state.readOnly &&
    !state.recovery &&
    !state.pending &&
    game.status === 'active';
  const valid = available && participantsValid && amountsValid && withinBounds && !needsReview;
  const changeCaster = (id: string) => {
    setCasterId(id);
    setTargetIds(game.order.filter((playerId) => playerId !== id && !game.players[playerId].eliminated));
    // A gain entered for the previous caster must never transfer by accident.
    setGainEnabled(false);
    setGainText('0');
    setSaveStatus('');
  };
  return (
    <Sheet
      title="Group life change"
      description="Choose the caster, then the opponents affected."
      onClose={onClose}
    >
      <form
        className="group-life"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          setSaveStatus('');
          const saved = await saveGroupLife(
            { type: 'groupLife', casterId, targetIds, loss, gain },
            {
              gameId: game.id,
              revision: game.revision,
              mode: state.mode,
              roomId: state.room?.id,
              roomRevision: state.room?.revision,
            },
          );
          if (!mounted.current) return;
          setSaving(false);
          if (saved) {
            notify('Life change saved. Undo reverses the whole effect.');
            onClose();
          } else {
            setNeedsReview(true);
            setSaveStatus(
              'This effect was not confirmed. It may already have applied. Check the totals and history after reconnecting before starting another effect.',
            );
          }
        }}
      >
        <Field label="Caster">
          <select
            value={casterId}
            onChange={(event) => changeCaster(event.target.value)}
            disabled={saving}
            required
          >
            <option value="" disabled>
              Choose the player casting the effect
            </option>
            {game.order.map((id) => (
              <option key={id} value={id} disabled={game.players[id].eliminated}>
                {game.players[id].name}
                {game.players[id].eliminated ? ' · eliminated' : ''}
              </option>
            ))}
          </select>
        </Field>
        <p className="group-life-protection">
          <Icon name="shield" size={18} />
          {caster
            ? `${caster.name} is excluded from life loss.`
            : 'The caster never loses life from this tool.'}
        </p>
        {caster && (
          <fieldset className="group-life-targets" disabled={saving}>
            <legend>Opponents affected</legend>
            {game.order
              .filter((id) => id !== casterId)
              .map((id) => {
                const player = game.players[id];
                return (
                  <label className={`group-life-target ${player.color}`} key={id}>
                    <input
                      type="checkbox"
                      checked={targetIds.includes(id)}
                      disabled={player.eliminated && !targetIds.includes(id)}
                      onChange={(event) =>
                        setTargetIds((current) =>
                          event.target.checked ? [...current, id] : current.filter((target) => target !== id),
                        )
                      }
                    />
                    <span>
                      {player.name}
                      <small>
                        {player.eliminated ? 'Eliminated · remove from this effect' : `${player.life} life`}
                      </small>
                    </span>
                  </label>
                );
              })}
            {game.order.length < 2 && <p className="hint">This game has no opponents.</p>}
          </fieldset>
        )}
        <Field label="Life lost per selected opponent">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMIT}
            step={1}
            required
            value={lossText}
            disabled={saving}
            onChange={(event) => setLossText(event.target.value)}
          />
        </Field>
        <Toggle checked={gainEnabled} onChange={setGainEnabled} disabled={saving || !caster}>
          Caster gains life
        </Toggle>
        {gainEnabled && (
          <Field
            label="Total life gained by caster"
            hint="Enter the total from your card. This is not multiplied by the number of opponents."
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMIT}
              step={1}
              required
              value={gainText}
              disabled={saving}
              onChange={(event) => setGainText(event.target.value)}
            />
          </Field>
        )}
        <p className="hint">
          Follow the card’s wording for prevention, replacements and life gain. This changes life totals only.
        </p>
        {caster && amountsValid && (
          <section className="group-life-preview" aria-label="Life change preview">
            <h3>Before you apply</h3>
            <ul>
              <li className="group-life-caster">
                <span>
                  {caster.name}
                  <small>Caster · {gain ? `gains ${gain}` : 'unchanged'}</small>
                </span>
                <strong>
                  {caster.life} → {caster.life + gain}
                </strong>
              </li>
              {targets.filter(Boolean).map((player) => (
                <li key={player.id}>
                  <span>
                    {player.name}
                    <small>Loses {loss}</small>
                  </span>
                  <strong>
                    {player.life} → {player.life - loss}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="hint">Other players stay unchanged. One Undo reverses this entire effect.</p>
          </section>
        )}
        {!amountsValid && (
          <p className="hint">
            Use whole numbers: loss 1–{LIMIT.toLocaleString()}, gain 0–{LIMIT.toLocaleString()}.
          </p>
        )}
        {amountsValid && !withinBounds && (
          <p role="alert">A resulting life total would exceed the supported range.</p>
        )}
        {caster && !participantsValid && (
          <p className="hint">
            Choose at least one opponent still in the game. The caster must also be in the game.
          </p>
        )}
        {state.mode === 'room' && (
          <p className="hint">In shared rooms, each player records life changes on their own seat.</p>
        )}
        {state.readOnly && (
          <p className="hint">Another tab controls this game. Take over there before editing.</p>
        )}
        {saveStatus && <p role="status">{saveStatus}</p>}
        {needsReview && (
          <button
            type="button"
            className="secondary full"
            disabled={!available || saving}
            onClick={() => {
              setCasterId('');
              setTargetIds([]);
              setLossText('1');
              setGainEnabled(false);
              setGainText('0');
              setNeedsReview(false);
              setSaveStatus('');
            }}
          >
            Clear and review a new effect
          </button>
        )}
        <button className="primary full" type="submit" disabled={!valid || saving}>
          {saving ? 'Saving…' : `Apply to ${targetIds.length} opponent${targetIds.length === 1 ? '' : 's'}`}
        </button>
      </form>
    </Sheet>
  );
}
