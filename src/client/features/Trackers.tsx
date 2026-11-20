import { useState } from 'react';
import { counterKey, counterPresets, type Game } from '../../shared/schema.js';
import { Field, Toggle } from '../components/ui.js';
import '../styles/extras.css';

type Trackers = Pick<Game['settings'], 'counters' | 'markerTrackers'>;
const markerNames = {
  monarch: 'Monarch',
  initiative: 'Initiative',
  dayNight: 'Day and night',
} as const;
export const MAX_COUNTERS = 12;

/** Off by default. Each tracker the table switches on appears on the seats that use it. */
export function TrackerOptions({
  value,
  onChange,
  disabled = false,
}: {
  value: Trackers;
  onChange: (next: Trackers) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const name = custom.trim();
  const has = (counter: string) => value.counters.some((c) => c.toLowerCase() === counter.toLowerCase());
  const valid =
    counterKey.safeParse(name).success &&
    !has(name) &&
    !['life', 'poison'].includes(name.toLowerCase()) &&
    value.counters.length < MAX_COUNTERS;
  const toggleCounter = (counter: string, on: boolean) =>
    onChange({
      ...value,
      counters: on
        ? [...value.counters, counter].slice(0, MAX_COUNTERS)
        : value.counters.filter((c) => c !== counter),
    });
  return (
    <div className="tracker-options">
      <p className="hint">
        Extra trackers are off until you want them. A counter shows on a seat once it is above zero.
      </p>
      <div className="tracker-chips" role="group" aria-label="Player counters">
        {[...counterPresets, ...value.counters.filter((c) => !counterPresets.some((p) => p === c))].map(
          (counter) => (
            <button
              key={counter}
              type="button"
              className={has(counter) ? 'selected' : ''}
              aria-pressed={has(counter)}
              disabled={disabled || (!has(counter) && value.counters.length >= MAX_COUNTERS)}
              onClick={() => toggleCounter(counter, !has(counter))}
            >
              {counter}
            </button>
          ),
        )}
      </div>
      <div className="tracker-custom">
        <Field label="Another counter">
          <input
            value={custom}
            maxLength={30}
            placeholder="e.g. Treasure"
            disabled={disabled}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter adds the counter; it must not submit a surrounding setup form.
              event.preventDefault();
              if (!valid || disabled) return;
              toggleCounter(name, true);
              setCustom('');
            }}
          />
        </Field>
        <button
          type="button"
          className="secondary"
          disabled={disabled || !valid}
          onClick={() => {
            toggleCounter(name, true);
            setCustom('');
          }}
        >
          Add counter
        </button>
      </div>
      {(Object.keys(markerNames) as (keyof typeof markerNames)[]).map((marker) => (
        <Toggle
          key={marker}
          disabled={disabled}
          checked={value.markerTrackers.includes(marker)}
          onChange={(on) =>
            onChange({
              ...value,
              markerTrackers: on
                ? [...value.markerTrackers.filter((m) => m !== marker), marker]
                : value.markerTrackers.filter((m) => m !== marker),
            })
          }
        >
          {markerNames[marker]}
        </Toggle>
      ))}
    </div>
  );
}
