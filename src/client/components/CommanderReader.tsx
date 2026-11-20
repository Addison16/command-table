import { useEffect, useId, useState } from 'react';
import {
  cardDetailsSchema,
  cardRulingsSchema,
  type CardDetails,
  type CardRulings,
} from '../../shared/cards.js';
import type { Game } from '../../shared/schema.js';
import { Icon } from './ui.js';
import '../styles/commander-reader.css';

// Public card text stays available when a reader is reopened during an outage.
// Keep it separate from game data and never persist private API responses.
const readings = new Map<string, { details: CardDetails; expires: number }>();
const rulingReadings = new Map<string, { rulings: CardRulings; expires: number }>();
function cachedReading(query: string) {
  const cached = readings.get(query);
  if (cached && cached.expires > Date.now()) return cached.details;
  readings.delete(query);
}

function cachedRulings(cardId: string) {
  const cached = rulingReadings.get(cardId);
  if (cached && cached.expires > Date.now()) return cached.rulings;
  rulingReadings.delete(cardId);
}

function CardRulingsReading({ cardId, scryfallUrl }: { cardId: string; scryfallUrl: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ rulings?: CardRulings; error?: string }>(() => ({
    rulings: cachedRulings(cardId),
  }));
  useEffect(() => {
    const cached = cachedRulings(cardId);
    if (cached) {
      setResult({ rulings: cached });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    setResult({});
    void (async () => {
      try {
        const response = await fetch(`/api/cards/rulings?${new URLSearchParams({ id: cardId })}`, {
          signal: controller.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok)
          throw new Error(
            response.status === 429
              ? 'Rulings lookup is busy. Wait a moment and retry.'
              : 'Rulings are temporarily unavailable. Try again shortly.',
          );
        const parsed = cardRulingsSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.cardId !== cardId)
          throw new Error('Rulings could not be loaded. Try again shortly.');
        if (!active) return;
        rulingReadings.delete(cardId);
        rulingReadings.set(cardId, { rulings: parsed.data, expires: Date.now() + 60 * 60_000 });
        while (rulingReadings.size > 32) rulingReadings.delete(rulingReadings.keys().next().value!);
        setResult({ rulings: parsed.data });
      } catch (error) {
        if (active)
          setResult({
            error: controller.signal.aborted
              ? 'Rulings took too long to load. Reconnect and retry.'
              : error instanceof TypeError
                ? 'Rulings need a connection the first time. Reconnect and retry.'
                : error instanceof Error
                  ? error.message
                  : 'Rulings could not be loaded. Try again shortly.',
          });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [cardId, attempt]);

  if (result.error)
    return (
      <div className="commander-read-error">
        <p role="status">{result.error}</p>
        <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
          Retry rulings
        </button>
      </div>
    );
  if (!result.rulings) return <p role="status">Loading rulings…</p>;
  const rulings = result.rulings;
  return (
    <>
      {rulings.rulings.length ? (
        <ol className="commander-rulings-list" aria-label="Card rulings">
          {rulings.rulings.map((ruling, index) => (
            <li key={index}>
              <p className="commander-ruling-source">
                <time dateTime={ruling.publishedAt}>
                  {new Date(`${ruling.publishedAt}T12:00:00Z`).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </time>
                <span>{ruling.source === 'wotc' ? 'Wizards of the Coast' : 'Scryfall note'}</span>
              </p>
              <p className="commander-ruling-text">{ruling.comment}</p>
            </li>
          ))}
        </ol>
      ) : !rulings.hasMore ? (
        <p role="status">No card-specific rulings are listed on Scryfall.</p>
      ) : null}
      {rulings.hasMore && (
        <p className="hint">
          More rulings are available.{' '}
          <a href={scryfallUrl} target="_blank" rel="noopener noreferrer">
            Read the full list on Scryfall ↗
          </a>
        </p>
      )}
      <p className="hint">Rulings provided by Scryfall. Sources are shown with each ruling.</p>
    </>
  );
}

function CardRulingsSection({ details }: { details: CardDetails }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section className="commander-rulings" aria-label="Commander rulings">
      <button
        className="commander-rulings-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Rulings & notes</span>
        <small>{expanded ? 'Hide' : 'Read rulings'}</small>
      </button>
      <div id={id} hidden={!expanded}>
        {expanded && <CardRulingsReading cardId={details.id} scryfallUrl={details.scryfallUrl} />}
      </div>
    </section>
  );
}

function FullCardImage({ face }: { face: CardDetails['faces'][number] }) {
  const [failed, setFailed] = useState(false);
  if (!face.imageUrl || failed)
    return <p className="hint">Card image unavailable. Read the card text below.</p>;
  return (
    <img
      className="commander-full-card"
      src={face.imageUrl}
      alt={`${face.name} full card`}
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function CardReading({ query }: { query: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ details?: CardDetails; error?: string }>(() => ({
    details: cachedReading(query),
  }));
  const [faceIndex, setFaceIndex] = useState(0);
  useEffect(() => {
    const cached = cachedReading(query);
    if (cached) {
      setResult({ details: cached });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    setResult({});
    void (async () => {
      try {
        const response = await fetch(`/api/cards/details?${new URLSearchParams({ q: query })}`, {
          signal: controller.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            typeof body?.error === 'string' ? body.error : 'This card could not be loaded. Try again.',
          );
        const parsed = cardDetailsSchema.safeParse(body?.details);
        if (!parsed.success) throw new Error('This card could not be loaded. Try again.');
        if (!active) return;
        readings.delete(query);
        readings.set(query, { details: parsed.data, expires: Date.now() + 60 * 60_000 });
        while (readings.size > 32) readings.delete(readings.keys().next().value!);
        setResult({ details: parsed.data });
      } catch (error) {
        if (active)
          setResult({
            error: controller.signal.aborted
              ? 'The card lookup took too long. Try again when your connection is ready.'
              : error instanceof TypeError
                ? 'Card details need a connection the first time. Reconnect and retry.'
                : error instanceof Error
                  ? error.message
                  : 'This card could not be loaded. Try again.',
          });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  if (result.error)
    return (
      <div className="commander-read-error">
        <p role="status">{result.error}</p>
        <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  if (!result.details) return <p role="status">Loading commander card…</p>;
  const details = result.details;
  const face = details.faces[faceIndex] ?? details.faces[0];
  return (
    <>
      {details.faces.length > 1 && (
        <div className="commander-face-options" role="group" aria-label="Card faces">
          {details.faces.map((entry, index) => (
            <button
              key={index}
              aria-label={`Show card face: ${entry.name}`}
              aria-pressed={faceIndex === index}
              onClick={() => setFaceIndex(index)}
            >
              <small>Face {index + 1}</small>
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
      <FullCardImage key={`${faceIndex}:${face.imageUrl ?? ''}`} face={face} />
      <div className="commander-card-text">
        <h3>{face.name}</h3>
        {face.manaCost && <p className="commander-mana">Mana cost: {face.manaCost}</p>}
        <p className="commander-type">{face.typeLine}</p>
        <p className="commander-rules">{face.oracleText || 'This card face has no rules text.'}</p>
        {(face.power !== undefined || face.toughness !== undefined) && (
          <p className="commander-stats">
            Power / toughness:{' '}
            <strong>
              {face.power ?? '—'} / {face.toughness ?? '—'}
            </strong>
          </p>
        )}
        {face.loyalty !== undefined && <p className="commander-stats">Loyalty: {face.loyalty}</p>}
        {face.artist && <p className="hint">Art by {face.artist}</p>}
        <a href={details.scryfallUrl} target="_blank" rel="noopener noreferrer">
          View on Scryfall ↗
        </a>
        <p className="hint">Card images © Wizards of the Coast. Card data provided by Scryfall.</p>
      </div>
      <CardRulingsSection key={details.id} details={details} />
    </>
  );
}

export function CommanderReader({ commanders }: { commanders: Game['commanders'][string][] }) {
  const id = useId();
  const [selected, setSelected] = useState<string>();
  if (!commanders.length) return null;
  const placeholder = (commander: (typeof commanders)[number]) =>
    !commander.card && /^Commander\s*\d*$/i.test(commander.label.trim());
  const current = commanders.find((commander) => commander.id === selected && !placeholder(commander));
  const query = current?.card ? `https://scryfall.com/cards/${current.card.id}` : current?.label.trim();
  return (
    <section className="commander-reader" aria-label="Commander cards">
      <h3>Commander cards</h3>
      <div className="commander-read-options">
        {commanders.map((commander) => {
          const name = commander.card?.name ?? commander.label;
          const expanded = current?.id === commander.id;
          return (
            <button
              key={commander.id}
              id={`${id}-${commander.id}`}
              className="commander-read-button"
              aria-label={`View commander: ${name}`}
              aria-expanded={expanded}
              aria-controls={`${id}-reading`}
              disabled={placeholder(commander)}
              onClick={() => setSelected(expanded ? undefined : commander.id)}
            >
              <Icon name="card" />
              <span>
                <strong>{name}</strong>
                <small>{expanded ? 'Hide card' : 'View commander'}</small>
              </span>
              <Icon name="arrow" size={16} />
            </button>
          );
        })}
      </div>
      {commanders.some(placeholder) && (
        <p className="hint">Choose a commander name or artwork in player settings to read its card.</p>
      )}
      <div
        id={`${id}-reading`}
        className="commander-reading"
        role="region"
        aria-label="Commander card details"
        hidden={!current || !query}
      >
        {current && query && <CardReading key={`${current.id}:${query}`} query={query} />}
      </div>
    </section>
  );
}
