import { useEffect, useRef, useState } from 'react';
import { commanderCardSchema, type CommanderCard } from '../../shared/cards.js';
import { Field } from '../components/ui.js';
import '../styles/extras.css';

export type ImportedCommander = { name: string; card: CommanderCard | null };

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/cards/${path}`, {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok)
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : response.status === 429
          ? 'Deck lookups are busy. Try again in a moment.'
          : 'That deck could not be read right now.',
    );
  return body;
}

/** Paste an Archidekt or Moxfield link to bring in the deck's commander and artwork. */
export function DeckImport({
  disabled = false,
  onImport,
}: {
  disabled?: boolean;
  onImport: (commanders: ImportedCommander[], deckName: string) => void;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = async () => {
    if (disabled || busy || !link.trim()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setStatus('');
    try {
      const deck = (await getJson(`deck?${new URLSearchParams({ q: link.trim() })}`, controller.signal)) as {
        name?: unknown;
        commanders?: { name?: unknown; scryfallId?: unknown }[];
      } | null;
      const found = (Array.isArray(deck?.commanders) ? deck.commanders : [])
        .filter((entry): entry is { name: string; scryfallId?: string } => typeof entry?.name === 'string')
        .slice(0, 2);
      if (!found.length) throw new Error('No commander is marked in that deck.');
      const commanders: ImportedCommander[] = [];
      for (const entry of found) {
        // Artwork is a bonus: the commander name is kept even when the art lookup fails.
        const card = await getJson(
          `resolve?${new URLSearchParams({
            q:
              typeof entry.scryfallId === 'string'
                ? `https://scryfall.com/cards/${entry.scryfallId}`
                : entry.name,
          })}`,
          controller.signal,
        )
          .then((body) => commanderCardSchema.safeParse((body as { card?: unknown } | null)?.card))
          .catch(() => undefined);
        commanders.push({ name: entry.name.slice(0, 100), card: card?.success ? card.data : null });
      }
      if (controller.signal.aborted) return;
      const deckName = typeof deck?.name === 'string' ? deck.name : 'Deck';
      onImport(commanders, deckName);
      setStatus(`Brought in ${commanders.map((entry) => entry.name).join(' + ')} from “${deckName}”.`);
      setLink('');
    } catch (error) {
      if (!controller.signal.aborted || request.current === controller)
        setStatus(
          controller.signal.aborted
            ? 'The deck took too long to load. Try again, or type the commander name.'
            : error instanceof TypeError
              ? 'Deck links need a connection. Reconnect and try again.'
              : error instanceof Error
                ? error.message
                : 'That deck could not be read right now.',
        );
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setBusy(false);
    }
  };
  return (
    <div className="deck-import">
      <div className="deck-import-row">
        <Field label="Deck link">
          <input
            value={link}
            maxLength={512}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || busy}
            placeholder="archidekt.com/decks/… or moxfield.com/decks/…"
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter reads the deck; it must not submit the surrounding form.
              event.preventDefault();
              void load();
            }}
          />
        </Field>
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy || !link.trim()}
          onClick={() => void load()}
        >
          {busy ? 'Reading deck…' : 'Use deck'}
        </button>
      </div>
      {status ? (
        <p className="hint" role="status">
          {status}
        </p>
      ) : (
        <p className="hint">Optional. A public deck link fills in the commander and its artwork.</p>
      )}
    </div>
  );
}
