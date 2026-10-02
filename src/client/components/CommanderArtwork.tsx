import { useEffect, useState } from 'react';
import type { CommanderCard } from '../../shared/cards.js';
import '../styles/commander-art.css';

export function ArtworkImage({ card }: { card: CommanderCard }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const retry = () => setFailed(false);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  if (failed) return null;
  return (
    <img
      src={card.imageUrl}
      alt=""
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function CommanderBackdrop({ cards }: { cards: CommanderCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="commander-backdrop" aria-hidden="true">
      {cards.map((card, index) => (
        <div className="commander-art-pane" key={`${index}:${card.imageUrl}`}>
          <ArtworkImage card={card} />
        </div>
      ))}
    </div>
  );
}

export function CommanderCredits({ cards }: { cards: CommanderCard[] }) {
  if (!cards.length) return null;
  return (
    <section className="commander-credits" aria-label="Commander artwork credits">
      {cards.map((card, index) => (
        <a key={`${index}:${card.id}`} href={card.scryfallUrl} target="_blank" rel="noreferrer">
          <span className="commander-credit-image">
            <ArtworkImage key={card.imageUrl} card={card} />
          </span>
          <span>
            <strong>{card.name}</strong>
            <small>Art by {card.artist} · View on Scryfall ↗</small>
          </span>
        </a>
      ))}
      <p>Card artwork © Wizards of the Coast. Unofficial fan content; not approved or endorsed by Wizards.</p>
    </section>
  );
}
