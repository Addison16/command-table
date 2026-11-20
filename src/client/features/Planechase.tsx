import { useEffect, useState } from 'react';
import { act, isHost, isSeated, useApp } from '../app/store.js';
import { ask, Icon, Sheet } from '../components/ui.js';
import {
  planeEntry,
  planeImage,
  planes,
  planeSetIds,
  planeSets,
  type PlaneEntry,
  type PlaneSet,
} from '../../shared/planes.js';
import type { PlaneCard } from '../../shared/planeCards.js';
import '../styles/archenemy.css';
import '../styles/extras.css';

// Rules text for 160-odd oversized cards stays out of the first download.
let cards: Promise<Readonly<Record<string, PlaneCard>>> | undefined;
const loadCards = () => (cards ??= import('../../shared/planeCards.js').then((m) => m.planeCards));

const dieFaces = {
  blank: { mark: '·', title: 'Blank', detail: 'Nothing happens.' },
  chaos: { mark: '☄', title: 'Chaos', detail: 'The plane’s chaos ability triggers.' },
  planeswalk: { mark: '⟁', title: 'Planeswalk', detail: 'Planeswalk to the next plane.' },
} as const;

function PlaneFace({ plane }: { plane: PlaneEntry }) {
  const [card, setCard] = useState<PlaneCard>();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setCard(undefined);
    setImageFailed(false);
    void loadCards()
      .then((all) => {
        if (current) setCard(all[plane.id]);
      })
      .catch(() => {
        /* The name is still shown; the text arrives when the app can load it. */
      });
    return () => {
      current = false;
    };
  }, [plane.id]);
  return (
    <article
      className={`plane-face ${plane.phenomenon ? 'phenomenon' : ''}`}
      aria-label={`${plane.name}. ${plane.phenomenon ? 'Phenomenon' : 'Plane'}`}
      data-testid="current-plane"
    >
      {card && !imageFailed && (
        <img
          className="plane-image"
          src={planeImage(card.scryfallId)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="plane-face-text">
        <span className="plane-type">
          {card?.typeLine ?? (plane.phenomenon ? 'Phenomenon' : 'Plane')} ·{' '}
          {planeSets.find((set) => set.id === plane.set)?.name}
        </span>
        <h3>{plane.name}</h3>
        <p>{card ? card.text : 'Loading the card text…'}</p>
      </div>
    </article>
  );
}

function DeckBuilder({
  initial,
  editable,
  label,
  onShuffle,
}: {
  initial: readonly PlaneSet[];
  editable: boolean;
  label: string;
  onShuffle: (sets: PlaneSet[]) => void;
}) {
  const [sets, setSets] = useState<PlaneSet[]>([...initial]);
  const total = planes.filter((plane) => sets.includes(plane.set)).length;
  return (
    <div className="scheme-builder">
      <fieldset className="scheme-sets plane-sets">
        <legend>Planes to include</legend>
        {planeSets.map((set) => (
          <label key={set.id}>
            <input
              type="checkbox"
              checked={sets.includes(set.id)}
              disabled={!editable}
              onChange={(event) =>
                setSets((current) =>
                  event.target.checked
                    ? planeSetIds.filter((id) => id === set.id || current.includes(id))
                    : current.filter((id) => id !== set.id),
                )
              }
            />
            <span>
              <strong>{set.name}</strong>
              <small>
                {set.year} · {planes.filter((plane) => plane.set === set.id).length} cards
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        className="primary full"
        disabled={!editable || !sets.length}
        onClick={() => onShuffle(sets)}
        data-testid="shuffle-planes"
      >
        <Icon name="dice" />
        {label} · {total} cards
      </button>
    </div>
  );
}

/** A shared planar deck and planar die. Any seat can roll; the host sets the deck up. */
export function Planechase({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    pending = useApp((s) => s.pending),
    mode = useApp((s) => s.mode);
  const planechase = game.planechase;
  const active = game.status === 'active' && pending === 0;
  const host = isSeated() && isHost() && active;
  const seated = isSeated() && active;
  const plane = planeEntry(planechase?.current);
  const face = planechase?.die ? dieFaces[planechase.die] : undefined;
  const shuffle = (sets: PlaneSet[]) => void act({ type: 'shufflePlanes', sets });
  return (
    <Sheet
      title="Planechase"
      description="One planar deck for the whole table. Everyone sees the same plane."
      onClose={onClose}
    >
      {planechase && plane ? (
        <>
          <PlaneFace key={plane.id} plane={plane} />
          <div className="planar-die" data-face={planechase.die ?? 'none'} role="status">
            <span className="planar-die-face" aria-hidden="true">
              {face?.mark ?? '?'}
            </span>
            <span>
              <strong data-testid="planar-die-result">{face?.title ?? 'Planar die'}</strong>
              <small>
                {face
                  ? face.detail
                  : 'Roll on your turn. The first roll is free; each extra roll costs one more mana.'}
                {planechase.rolls > 0 &&
                  ` ${planechase.rolls} ${planechase.rolls === 1 ? 'roll' : 'rolls'} this turn; the next costs {${planechase.rolls}}.`}
              </small>
            </span>
          </div>
          <div className="plane-actions">
            <button className="primary" disabled={!seated} onClick={() => void act({ type: 'planarDie' })}>
              <Icon name="dice" />
              Roll the planar die
            </button>
            <button className="secondary" disabled={!seated} onClick={() => void act({ type: 'planeswalk' })}>
              <Icon name="arrow" />
              Planeswalk
            </button>
          </div>
          <p className="hint">
            The plane you leave goes to the bottom of the deck. {planechase.deck.length} cards are in this
            planar deck. Card images load from Scryfall when you are online.
          </p>
          <details className="scheme-more">
            <summary>Reshuffle or change sets</summary>
            <DeckBuilder initial={planechase.sets} editable={host} label="Reshuffle" onShuffle={shuffle} />
            <button
              className="text-button full"
              disabled={!host}
              onClick={async () => {
                if (await ask('Put the planar deck away?', 'The current plane and die leave the table.'))
                  void act({ type: 'endPlanechase' });
              }}
            >
              Stop using Planechase
            </button>
          </details>
        </>
      ) : (
        <section className="detail-section first">
          <h3>Build the planar deck</h3>
          <p className="hint">
            Shuffle every printed plane and phenomenon into one shared deck. The first plane is turned face up
            right away.
          </p>
          <DeckBuilder
            initial={planeSetIds}
            editable={host}
            label="Shuffle the planar deck"
            onShuffle={shuffle}
          />
        </section>
      )}
      {mode === 'room' && !isHost() && (
        <p className="hint">The host sets up the planar deck. Any seated player can roll and planeswalk.</p>
      )}
      <button className="secondary full" onClick={onClose}>
        Back to game
      </button>
    </Sheet>
  );
}
