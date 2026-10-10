import { useState } from 'react';
import { act, canEdit, isHost, useApp } from '../app/store.js';
import { Field, Icon, Sheet, Toggle } from '../components/ui.js';
import '../styles/archenemy.css';

export function SchemeDeck({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    pending = useApp((s) => s.pending),
    mode = useApp((s) => s.mode);
  const [name, setName] = useState('');
  const [ongoing, setOngoing] = useState(false);
  const archenemy = game.archenemy!;
  const villain = game.players[archenemy.playerId];
  // In rooms the archenemy's own phone runs the scheme deck; the host can help.
  const editable =
    (canEdit(villain.id) || (mode === 'room' && isHost())) && game.status === 'active' && !villain.eliminated;
  return (
    <Sheet title="Scheme deck" description={`${villain.name} · the archenemy`} onClose={onClose}>
      <div className="scheme-summary" role="group" aria-label="Schemes">
        <div>
          <strong data-testid="schemes-in-motion">{archenemy.schemes}</strong>
          <span>{archenemy.schemes === 1 ? 'Scheme set in motion' : 'Schemes set in motion'}</span>
        </div>
        <div>
          <strong>{archenemy.ongoing.length}</strong>
          <span>Ongoing</span>
        </div>
      </div>
      <p className="hint">
        At the start of the archenemy’s first main phase, reveal the top scheme and set it in motion. Most
        schemes then go to the bottom of the deck. Ongoing schemes stay out until they are abandoned.
      </p>
      <form
        className="scheme-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editable) return;
          const trimmed = name.trim();
          void act({ type: 'scheme', ongoing, ...(trimmed ? { name: trimmed } : {}) }).then(() => {
            setName('');
            setOngoing(false);
          });
        }}
      >
        <Field label="Scheme name" hint="Optional. Leave blank to just count it.">
          <input
            value={name}
            maxLength={60}
            placeholder="e.g. Behold the Power of Destruction"
            disabled={!editable}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Toggle checked={ongoing} onChange={setOngoing} disabled={!editable}>
          Ongoing scheme
        </Toggle>
        <button className="primary full" type="submit" disabled={!editable || pending > 0}>
          <Icon name="scheme" />
          Set a scheme in motion
        </button>
      </form>
      <section className="detail-section">
        <h3>Ongoing schemes</h3>
        {archenemy.ongoing.length ? (
          <ul className="ongoing-schemes">
            {archenemy.ongoing.map((scheme, index) => (
              <li key={`${index}:${scheme}`}>
                <span>{scheme}</span>
                <button
                  className="secondary"
                  disabled={!editable || pending > 0}
                  onClick={() => void act({ type: 'abandonScheme', index })}
                  aria-label={`Abandon ${scheme}`}
                >
                  Abandon
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No ongoing schemes. Ongoing schemes stay here until their condition is met.</p>
        )}
      </section>
      {!editable && game.status === 'active' && (
        <p className="hint">
          {villain.eliminated
            ? 'The archenemy has been defeated. Restore them in player details to keep scheming.'
            : 'Only the archenemy’s seat or the host can set schemes in motion.'}
        </p>
      )}
      <button className="secondary full" onClick={onClose}>
        Back to game
      </button>
    </Sheet>
  );
}
