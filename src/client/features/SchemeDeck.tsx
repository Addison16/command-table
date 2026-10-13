import { useState } from 'react';
import { act, canEdit, isHost, useApp } from '../app/store.js';
import { Field, Icon, Sheet, Toggle } from '../components/ui.js';
import {
  schemeCard,
  schemeCards,
  schemeImage,
  schemeSetIds,
  schemeSets,
  schemesRemaining,
  type SchemeCard,
  type SchemeSet,
} from '../../shared/schemes.js';
import '../styles/archenemy.css';

const setName = (id: SchemeSet) => schemeSets.find((set) => set.id === id)?.name ?? id;

/** The full card when it can load, with the rules text always readable beneath it. */
function SchemeFace({ card, fresh = false }: { card: SchemeCard; fresh?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article
      className={`scheme-face ${card.ongoing ? 'ongoing' : ''} ${fresh ? 'fresh' : ''}`}
      aria-label={`${card.name}. ${card.ongoing ? 'Ongoing scheme' : 'Scheme'}`}
      data-testid="revealed-scheme"
    >
      {!imageFailed && (
        <img
          className="scheme-image"
          src={schemeImage(card)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="scheme-face-text">
        <span className="scheme-type">
          {card.ongoing ? 'Ongoing scheme' : 'Scheme'} · {setName(card.set)}
        </span>
        <h3>{card.name}</h3>
        <p>{card.text}</p>
      </div>
    </article>
  );
}

function DeckBuilder({
  initial,
  editable,
  onShuffle,
  label,
}: {
  initial: readonly SchemeSet[];
  editable: boolean;
  onShuffle: (sets: SchemeSet[]) => void;
  label: string;
}) {
  const [sets, setSets] = useState<SchemeSet[]>([...initial]);
  const total = schemeCards.filter((card) => sets.includes(card.set)).length;
  return (
    <div className="scheme-builder">
      <fieldset className="scheme-sets">
        <legend>Schemes to include</legend>
        {schemeSets.map((set) => {
          const count = schemeCards.filter((card) => card.set === set.id).length;
          return (
            <label key={set.id} className="scheme-set">
              <input
                type="checkbox"
                checked={sets.includes(set.id)}
                disabled={!editable}
                onChange={(event) =>
                  setSets((current) =>
                    event.target.checked
                      ? schemeSetIds.filter((id) => id === set.id || current.includes(id))
                      : current.filter((id) => id !== set.id),
                  )
                }
              />
              <span>
                <strong>{set.name}</strong>
                <small>
                  {set.year} · {count} schemes
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <button
        className="primary full"
        disabled={!editable || !sets.length}
        onClick={() => onShuffle(sets)}
        data-testid="shuffle-schemes"
      >
        <Icon name="dice" />
        {label} · {total} cards
      </button>
    </div>
  );
}

export function SchemeDeck({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    pending = useApp((s) => s.pending),
    mode = useApp((s) => s.mode);
  const [name, setName] = useState('');
  const [ongoing, setOngoing] = useState(false);
  const [revealedHere, setRevealedHere] = useState(false);
  const archenemy = game.archenemy!;
  const villain = game.players[archenemy.playerId];
  // In rooms the archenemy's own phone runs the scheme deck; the host can help.
  const editable =
    (canEdit(villain.id) || (mode === 'room' && isHost())) && game.status === 'active' && !villain.eliminated;
  const hasDeck = !!archenemy.deck?.length;
  const revealed = schemeCard(archenemy.revealed);
  const remaining = schemesRemaining(archenemy);
  const shuffle = (sets: SchemeSet[]) => void act({ type: 'shuffleSchemes', sets });
  return (
    <Sheet title="Scheme deck" description={`${villain.name} · the archenemy`} onClose={onClose}>
      <div className={`scheme-summary ${hasDeck ? 'three' : ''}`} role="group" aria-label="Schemes">
        <div>
          <strong data-testid="schemes-in-motion">{archenemy.schemes}</strong>
          <span>{archenemy.schemes === 1 ? 'Scheme set in motion' : 'Schemes set in motion'}</span>
        </div>
        <div>
          <strong>{archenemy.ongoing.length}</strong>
          <span>Ongoing</span>
        </div>
        {hasDeck && (
          <div>
            <strong data-testid="schemes-in-deck">{remaining}</strong>
            <span>In the deck</span>
          </div>
        )}
      </div>
      {hasDeck ? (
        <>
          <button
            className="primary full scheme-reveal"
            disabled={!editable || pending > 0 || !remaining}
            onClick={() => {
              setRevealedHere(true);
              void act({ type: 'revealScheme' });
            }}
          >
            <Icon name="scheme" />
            Set the top scheme in motion
          </button>
          <p className="hint">
            At the start of your first main phase, reveal the top scheme. It goes to the bottom of the deck,
            so the deck cycles through every card. Ongoing schemes stay face up until they are abandoned.
          </p>
          {revealed ? (
            <SchemeFace key={`${revealed.id}:${archenemy.schemes}`} card={revealed} fresh={revealedHere} />
          ) : (
            <div className="scheme-back" aria-hidden="true">
              <Icon name="scheme" size={34} />
              <span>{archenemy.deck!.length} schemes shuffled</span>
            </div>
          )}
        </>
      ) : (
        <section className="detail-section">
          <h3>Build the scheme deck</h3>
          <p className="hint">
            Shuffle every official scheme card, then reveal one each turn. Card images load from Scryfall when
            you are online; the rules text is always available.
          </p>
          <DeckBuilder
            initial={archenemy.sets ?? schemeSetIds}
            editable={editable && pending === 0}
            onShuffle={shuffle}
            label="Shuffle the scheme deck"
          />
        </section>
      )}
      <section className="detail-section">
        <h3>Ongoing schemes</h3>
        {archenemy.ongoing.length ? (
          <ul className="ongoing-schemes">
            {archenemy.ongoing.map((scheme, index) => {
              const card = schemeCards.find((c) => c.name === scheme);
              return (
                <li key={`${index}:${scheme}`}>
                  <span>
                    <strong>{scheme}</strong>
                    {card && <small>{card.text}</small>}
                  </span>
                  <button
                    className="secondary"
                    disabled={!editable || pending > 0}
                    onClick={() => void act({ type: 'abandonScheme', index })}
                    aria-label={`Abandon ${scheme}`}
                  >
                    Abandon
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">No ongoing schemes. Ongoing schemes stay here until their condition is met.</p>
        )}
      </section>
      {hasDeck && (
        <details className="scheme-more">
          <summary>Reshuffle or change sets</summary>
          <DeckBuilder
            initial={archenemy.sets ?? schemeSetIds}
            editable={editable && pending === 0}
            onShuffle={(sets) => {
              setRevealedHere(false);
              shuffle(sets);
            }}
            label="Reshuffle"
          />
        </details>
      )}
      <details className="scheme-more">
        <summary>Playing with a physical deck?</summary>
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
              list="scheme-names"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <datalist id="scheme-names">
            {schemeCards.map((card) => (
              <option key={card.id} value={card.name} />
            ))}
          </datalist>
          <Toggle checked={ongoing} onChange={setOngoing} disabled={!editable}>
            Ongoing scheme
          </Toggle>
          <button className="secondary full" type="submit" disabled={!editable || pending > 0}>
            <Icon name="scheme" />
            Record a scheme set in motion
          </button>
        </form>
      </details>
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
