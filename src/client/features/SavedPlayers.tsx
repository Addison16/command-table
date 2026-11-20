import { newId } from '../../shared/random.js';
import type { Game } from '../../shared/schema.js';
import { notify, updateProfile, useApp } from '../app/store.js';
import { ask, Field, Icon } from '../components/ui.js';
import { MAX_SAVED_PLAYERS, type SavedPlayer } from '../storage/repository.js';
import '../styles/extras.css';

const placeholder = /^Commander [12]$/;
const describe = (player: SavedPlayer) =>
  player.commanders.filter((name) => !placeholder.test(name)).join(' + ') || 'No commander saved';

/** The seat as it is right now, ready to reuse in a later game. */
export function savedFromGame(game: Game, playerId: string): Omit<SavedPlayer, 'id'> {
  const player = game.players[playerId];
  const commanders = Object.values(game.commanders).filter((c) => c.ownerId === playerId);
  return {
    name: player.name,
    color: player.color,
    commanders: commanders.map((c) => c.label),
    ...(commanders.some((c) => c.card) ? { commanderCards: commanders.map((c) => c.card ?? null) } : {}),
    ...(player.playmat ? { playmat: player.playmat } : {}),
  };
}

/** Saving a name again updates that regular rather than adding a twin. */
export async function saveRegular(player: Omit<SavedPlayer, 'id'>) {
  const saved = useApp.getState().profile.savedPlayers;
  const same = (entry: SavedPlayer) => entry.name.trim().toLowerCase() === player.name.trim().toLowerCase();
  const existing = saved.find(same);
  if (!existing && saved.length >= MAX_SAVED_PLAYERS) {
    notify(`You can save up to ${MAX_SAVED_PLAYERS} players. Remove one in settings first.`);
    return;
  }
  await updateProfile({
    savedPlayers: [...saved.filter((entry) => !same(entry)), { ...player, id: existing?.id ?? newId() }],
  });
  notify(`${player.name} ${existing ? 'updated in' : 'saved to'} your regulars`);
}

/** One tap fills a seat with a regular's name, color, commanders and background. */
export function SavedPlayerSelect({
  label = 'Fill from a saved player',
  disabled = false,
  onPick,
}: {
  label?: string;
  disabled?: boolean;
  onPick: (player: SavedPlayer) => void;
}) {
  const saved = useApp((s) => s.profile.savedPlayers);
  if (!saved.length) return null;
  return (
    <Field label={label}>
      <select
        value=""
        disabled={disabled}
        onChange={(event) => {
          const player = saved.find((entry) => entry.id === event.target.value);
          if (player) onPick(player);
        }}
      >
        <option value="">Choose a regular…</option>
        {[...saved]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((player) => (
            <option key={player.id} value={player.id}>
              {player.name} · {describe(player)}
            </option>
          ))}
      </select>
    </Field>
  );
}

export function SavedPlayersList() {
  const saved = useApp((s) => s.profile.savedPlayers);
  return (
    <section className="detail-section">
      <h3>
        <Icon name="people" />
        Saved players
      </h3>
      {saved.length ? (
        [...saved]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((player) => (
            <div className="saved-player-row" key={player.id}>
              <span className={`palette-dot ${player.color}`} />
              <span>
                {player.name}
                <small>{describe(player)}</small>
              </span>
              <button
                aria-label={`Remove saved player ${player.name}`}
                onClick={async () => {
                  if (
                    await ask(
                      `Remove ${player.name}?`,
                      'Only the saved shortcut is removed. Games are not changed.',
                    )
                  )
                    void updateProfile({
                      savedPlayers: useApp
                        .getState()
                        .profile.savedPlayers.filter((entry) => entry.id !== player.id),
                    });
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ))
      ) : (
        <p className="hint">
          Open a player’s details during a game and choose “Save to my regulars”. Next time, one tap fills
          their seat.
        </p>
      )}
    </section>
  );
}
