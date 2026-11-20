import { useEffect, useState } from 'react';
import { Field, Icon, Sheet } from '../components/ui.js';
import { CardReading } from '../components/CommanderReader.js';
import '../styles/extras.css';

/** Read any card's text and rulings without leaving the table. */
export function CardLookup({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const term = text.trim();
  useEffect(() => {
    setNames([]);
    if (term.length < 2 || term === query || /^https?:|\/\//i.test(term)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/cards/suggest?${new URLSearchParams({ q: term })}`, {
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { names?: unknown } | null) => {
          if (controller.signal.aborted || !Array.isArray(body?.names)) return;
          setNames(
            body.names
              .filter((name): name is string => typeof name === 'string' && name.length <= 100)
              .slice(0, 8),
          );
        })
        .catch(() => {
          /* Suggestions are a convenience; the full name still works. */
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, query]);
  const read = (name: string) => {
    setText(name);
    setQuery(name.trim());
    setNames([]);
  };
  return (
    <Sheet
      title="Look up a card"
      description="Card text and rulings from Scryfall. Needs a connection."
      onClose={onClose}
    >
      <form
        className="card-lookup-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (term) read(term);
        }}
      >
        <Field label="Card name">
          <input
            value={text}
            maxLength={512}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. Rhystic Study"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <button className="primary" disabled={!term}>
          <Icon name="card" />
          Read card
        </button>
      </form>
      <p className="hint">Type a name or paste a Scryfall card link.</p>
      {names.length > 0 && (
        <ul className="card-lookup-names" aria-label="Card name suggestions">
          {names.map((name) => (
            <li key={name}>
              <button type="button" className="secondary" onClick={() => read(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && (
        <div className="commander-reading" role="region" aria-label="Card details">
          <CardReading key={query} query={query} />
        </div>
      )}
    </Sheet>
  );
}
