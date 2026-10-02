import { useApp, updateProfile } from '../app/store.js';
import { Sheet, Toggle } from '../components/ui.js';
import { useTableLayout } from './useTableLayout.js';
import '../styles/table-layout.css';

export function facesAcross(layout: 'upright' | 'shared', index: number, count: number) {
  return layout === 'shared' && count > 1 && index < Math.ceil(count / 2);
}

export function TableLayoutOptions() {
  const { layout } = useTableLayout();
  const followRotation = useApp((s) => s.profile.autoTableLayout);
  return (
    <>
      <Toggle
        checked={followRotation}
        onChange={(autoTableLayout) => {
          dispatchEvent(new Event('mtg-cancel-input'));
          void updateProfile({ autoTableLayout, tableLayout: layout, rotations: {} });
        }}
      >
        Follow device rotation
      </Toggle>
      <p className="hint">
        On by default. On phones and tablets, landscape uses Shared table and portrait uses All facing me.
        Choose a layout below to keep it fixed.
      </p>
      <div className="layout-options" role="group" aria-label="Counter layout">
        {(['upright', 'shared'] as const).map((option) => (
          <button
            key={option}
            className={`layout-option ${layout === option ? 'selected' : ''}`}
            aria-pressed={layout === option}
            onClick={() => {
              dispatchEvent(new Event('mtg-cancel-input'));
              void updateProfile({
                tableLayout: option,
                autoTableLayout: false,
                rotations: {},
                view: 'table',
              });
            }}
          >
            <span className={`layout-preview ${option}`} aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <span key={n}>
                  <span>− 40 +</span>
                </span>
              ))}
            </span>
            <strong>{option === 'upright' ? 'All facing me' : 'Shared table'}</strong>
            <span>
              {option === 'upright'
                ? 'Hold the phone and manage every player.'
                : 'Lay it sideways. Two players on each side.'}
            </span>
          </button>
        ))}
      </div>
      <p className="hint">
        Shared table faces the far row toward your friends and makes the + / − areas larger. Each player’s
        name opens their details.
      </p>
      <p className="hint">
        You can still flip an individual seat in player details. Choosing a layout resets those flips on this
        phone.
      </p>
    </>
  );
}

export function TableLayout({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="Table layout"
      description="Set the phone in the middle and give everyone a side."
      onClose={onClose}
    >
      <TableLayoutOptions />
      <button className="primary full" onClick={onClose}>
        Back to game
      </button>
    </Sheet>
  );
}
