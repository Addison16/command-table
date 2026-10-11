import { useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { elapsed } from '../../shared/game.js';
import type { Game } from '../../shared/schema.js';
import { act, isHost, useApp } from '../app/store.js';
import { Icon } from '../components/ui.js';
import { standing } from './gameMoments.js';
import '../styles/game-moments.css';

// Matches the fallen-veil and fallen-card animations. The timer, not the
// animation, removes the notice so it also leaves when motion is switched off.
const FALLEN_MS = 2600;

const duration = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** A brief notice over the table. It never takes focus or blocks a tap. */
export function PlayerFallen({
  game,
  playerId,
  onDone,
}: {
  game: Game;
  playerId: string;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), FALLEN_MS);
    return () => clearTimeout(timer);
  }, []);
  const player = game.players[playerId];
  if (!player) return null;
  const remaining = standing(game).length;
  return (
    // The history summary already announces the elimination to screen readers.
    <div className={`fallen-moment ${player.color}`} data-testid="player-fallen" aria-hidden="true">
      <div className="fallen-card">
        <span className="fallen-mark">
          <Icon name="skull" size={34} />
        </span>
        <span className="eyebrow">ELIMINATED</span>
        <strong>{player.name}</strong>
        <span>{remaining > 1 ? `has fallen · ${remaining} players remain` : 'has fallen'}</span>
      </div>
    </div>
  );
}

export function WinnerScreen({
  game,
  playerId,
  onClose,
}: {
  game: Game;
  playerId: string;
  onClose: () => void;
}) {
  const live = useApp((s) => s.mode === 'local' || s.connected);
  const readOnly = useApp((s) => s.readOnly);
  const pending = useApp((s) => s.pending);
  const offset = useApp((s) => s.clockOffset);
  const room = useApp((s) => s.mode === 'room');
  const player = game.players[playerId];
  if (!player) return null;
  const available = live && !readOnly && !pending;
  // Generated labels identify unnamed commanders in saves, not on a victory screen.
  const commanders = game.settings.commander
    ? Object.values(game.commanders)
        .filter((c) => c.ownerId === playerId && (c.card || !/^Commander [12]$/.test(c.label)))
        .map((c) => c.label)
    : [];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="victory-backdrop" />
        <Dialog.Content
          className={`victory-screen ${player.color}`}
          data-testid="winner-screen"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('winner-dismiss')?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[aria-label="Game controls"] button')?.focus();
          }}
        >
          <div className="victory-card">
            <span className="victory-crest">
              <Icon name="crown" size={44} />
            </span>
            <p className="eyebrow gold">LAST PLAYER STANDING</p>
            <Dialog.Title className="victory-title">
              {player.name} <em>wins</em>
            </Dialog.Title>
            <Dialog.Description className="victory-detail">
              {commanders.length ? `Led by ${commanders.join(' & ')}.` : 'The table is theirs.'}
            </Dialog.Description>
            <ul className="victory-facts">
              <li>{player.life} life</li>
              {game.settings.turnTracking && game.turn.number > 0 && <li>Turn {game.turn.number}</li>}
              <li>{duration(elapsed(game, Date.now() + offset))}</li>
            </ul>
            {isHost() ? (
              <div className="button-row">
                <button className="secondary" disabled={!available} onClick={() => void act({ type: 'end' })}>
                  End game
                </button>
                <button
                  className="primary"
                  disabled={!available}
                  onClick={() => void act({ type: 'rematch' })}
                >
                  <Icon name="rotate" />
                  Rematch
                </button>
              </div>
            ) : (
              room && <p className="hint">The host can start a rematch or end the game.</p>
            )}
            <button id="winner-dismiss" className="text-button full" onClick={onClose}>
              Back to the table
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
