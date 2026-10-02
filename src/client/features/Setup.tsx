import { useState } from 'react';
import { defaultSetup } from '../../shared/game.js';
import { palettes, setupSchema, type Setup } from '../../shared/schema.js';
import { useApp, report, startLocal, updateProfile } from '../app/store.js';
import { Field, Icon, Sheet, Toggle } from '../components/ui.js';
import { CommanderInput } from '../components/CommanderInput.js';
import { PlayerNameInput } from '../components/PlayerNameInput.js';
export function SetupSheet({ mode, onClose }: { mode: 'local' | 'room'; onClose: () => void }) {
  const [setup, setSetup] = useState<Setup>(() => {
    const initial = defaultSetup();
    if (mode === 'room') initial.seats[0].commanders = [''];
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(() => {
    const saved = useApp.getState().profile.displayName;
    return /^(?:Host|Player(?: [1-8])?)$/.test(saved) ? '' : saved;
  });
  const settings = setup.settings;
  const change = (patch: Partial<Setup['settings']>) =>
    setSetup((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const count = (n: number) =>
    setSetup((s) => ({
      ...s,
      seats: Array.from({ length: n }, (_, i) => s.seats[i] ?? defaultSetup(8).seats[i]),
    }));
  const preset = (value: Setup['settings']['preset']) =>
    change({
      preset: value,
      ...(value === 'Custom'
        ? {}
        : { startingLife: value === 'Commander' ? 40 : 20, commander: value === 'Commander' }),
    });
  const submit = async () => {
    setBusy(true);
    try {
      const hostName = displayName.trim() || 'Host';
      const data = setupSchema.parse({
        ...setup,
        seats: setup.seats.map((seat, index) => ({
          ...seat,
          name: mode === 'room' && index === 0 ? hostName : seat.name.trim() || `Player ${index + 1}`,
          commanders: seat.commanders.map((name, index) => name.trim() || `Commander ${index + 1}`),
        })),
      });
      if (mode === 'local') await startLocal(data);
      else {
        const { createRoom } = await import('../adapters/room.js');
        await createRoom(data, hostName);
      }
      await updateProfile({ setup: data, ...(mode === 'room' ? { displayName: hostName } : {}) });
      onClose();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={mode === 'local' ? 'Set your table' : 'Create a shared room'}
      description={
        mode === 'local'
          ? 'One device. Everyone around the table.'
          : 'Choose the table size and set up your player. Friends choose their own names and commanders when they join.'
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="section-label">
          PLAYERS <span>1 is practice mode</span>
        </div>
        <div className="seat-count">
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              type="button"
              className={setup.seats.length === i + 1 ? 'selected' : ''}
              aria-pressed={setup.seats.length === i + 1}
              onClick={() => count(i + 1)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <Field label="Game preset">
          <select
            value={settings.preset}
            onChange={(e) => preset(e.target.value as Setup['settings']['preset'])}
          >
            <option>Commander</option>
            <option>20-life game</option>
            <option>Custom</option>
          </select>
        </Field>
        <Field label="Starting life">
          <input
            type="number"
            inputMode="numeric"
            min={-999999}
            max={999999}
            required
            value={settings.startingLife}
            onChange={(e) => change({ startingLife: e.target.valueAsNumber })}
          />
        </Field>
        {mode === 'room' && (
          <fieldset className="lobby-profile" disabled={busy}>
            <legend>Your player</legend>
            <PlayerNameInput
              label="Your display name"
              hint="This will be your player name at the table. Leave blank to use Host."
              value={displayName}
              defaultName="Host"
              onChange={setDisplayName}
              disabled={busy}
            />
            {settings.commander && (
              <>
                {setup.seats[0].commanders.map((label, index) => (
                  <CommanderInput
                    key={index}
                    label={`Commander ${index + 1} name`}
                    value={label}
                    card={setup.seats[0].commanderCards?.[index]}
                    disabled={busy}
                    onChange={(name, card) =>
                      setSetup((current) => ({
                        ...current,
                        seats: current.seats.map((seat, seatIndex) =>
                          seatIndex === 0
                            ? {
                                ...seat,
                                commanders: seat.commanders.map((value, at) => (at === index ? name : value)),
                                commanderCards: seat.commanders.map((_, at) =>
                                  at === index ? card : (seat.commanderCards?.[at] ?? null),
                                ),
                              }
                            : seat,
                        ),
                      }))
                    }
                  />
                ))}
                <Toggle
                  checked={setup.seats[0].commanders.length === 2}
                  onChange={(partners) =>
                    setSetup((current) => ({
                      ...current,
                      seats: current.seats.map((seat, index) =>
                        index === 0
                          ? {
                              ...seat,
                              commanders: partners ? [seat.commanders[0], ''] : [seat.commanders[0]],
                              commanderCards: partners
                                ? [seat.commanderCards?.[0] ?? null, null]
                                : [seat.commanderCards?.[0] ?? null],
                            }
                          : seat,
                      ),
                    }))
                  }
                >
                  Two commanders / partners
                </Toggle>
              </>
            )}
            <p className="hint">The first seat is yours. You can edit your player during the game.</p>
          </fieldset>
        )}
        {mode === 'local' && (
          <details>
            <summary>
              Names, colors & commanders <span>Optional</span>
            </summary>
            <div className="seat-forms">
              {setup.seats.map((seat, i) => (
                <div className="seat-form" key={i}>
                  <span className={`palette-dot ${seat.color}`} />
                  <PlayerNameInput
                    label={`Seat ${i + 1} name`}
                    value={seat.name}
                    defaultName={`Player ${i + 1}`}
                    disabled={busy}
                    onChange={(name) =>
                      setSetup((s) => ({
                        ...s,
                        seats: s.seats.map((p, j) => (j === i ? { ...p, name } : p)),
                      }))
                    }
                  />
                  <Field label="Color">
                    <select
                      value={seat.color}
                      onChange={(e) =>
                        setSetup((s) => ({
                          ...s,
                          seats: s.seats.map((p, j) =>
                            j === i ? { ...p, color: e.target.value as typeof seat.color } : p,
                          ),
                        }))
                      }
                    >
                      {palettes.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  {settings.commander && (
                    <>
                      <Field label="Commanders">
                        <select
                          value={seat.commanders.length}
                          onChange={(e) =>
                            setSetup((s) => ({
                              ...s,
                              seats: s.seats.map((p, j) =>
                                j === i
                                  ? {
                                      ...p,
                                      commanders:
                                        Number(e.target.value) === 2
                                          ? [p.commanders[0], 'Commander 2']
                                          : [p.commanders[0]],
                                      ...(p.commanderCards
                                        ? {
                                            commanderCards:
                                              Number(e.target.value) === 2
                                                ? [p.commanderCards[0] ?? null, null]
                                                : [p.commanderCards[0] ?? null],
                                          }
                                        : {}),
                                    }
                                  : p,
                              ),
                            }))
                          }
                        >
                          <option value="1">One commander</option>
                          <option value="2">Two commanders / partners</option>
                        </select>
                      </Field>
                      {seat.commanders.map((label, k) => (
                        <CommanderInput
                          key={k}
                          label={`Commander ${k + 1}`}
                          value={label}
                          card={seat.commanderCards?.[k]}
                          disabled={busy}
                          onChange={(name, card) =>
                            setSetup((s) => ({
                              ...s,
                              seats: s.seats.map((p, j) =>
                                j === i
                                  ? {
                                      ...p,
                                      commanders: p.commanders.map((n, nI) => (nI === k ? name : n)),
                                      commanderCards: p.commanders.map((_, nI) =>
                                        nI === k ? card : (p.commanderCards?.[nI] ?? null),
                                      ),
                                    }
                                  : p,
                              ),
                            }))
                          }
                        />
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
        <details>
          <summary>
            Trackers & house rules <span>Advanced</span>
          </summary>
          <Toggle checked={settings.poison} onChange={(poison) => change({ poison })}>
            Poison tracker
          </Toggle>
          <Toggle checked={settings.commander} onChange={(commander) => change({ commander })}>
            Commander tools
          </Toggle>
          <Field label="Poison warning threshold">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="999999"
              value={settings.poisonThreshold}
              onChange={(e) => change({ poisonThreshold: e.target.valueAsNumber })}
            />
          </Field>
          <Field label="Commander damage warning threshold">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="999999"
              value={settings.commanderThreshold}
              onChange={(e) => change({ commanderThreshold: e.target.valueAsNumber })}
            />
          </Field>
          <p className="hint">
            These are manual trackers. Presets do not enforce deck legality or decide game outcomes.
          </p>
        </details>
        <div className="sheet-footer">
          <button className="primary full" disabled={busy}>
            <Icon name="spark" />
            {busy ? 'Preparing your table…' : mode === 'local' ? 'Let’s play' : 'Create room'}
          </button>
          <p className="hint center">Your previous local game is saved in Recent games.</p>
        </div>
      </form>
    </Sheet>
  );
}
