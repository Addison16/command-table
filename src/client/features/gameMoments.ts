import type { Game } from '../../shared/schema.js';

export type GameMoments = { fallen: string[]; winner: string | null };

export const standing = (game: Game) => game.order.filter((id) => !game.players[id].eliminated);

/**
 * Compare two confirmed snapshots of one match. Elimination stays a manual
 * decision; this only notices it, and the last player left standing by it.
 */
export function gameMoments(previous: Game | undefined, current: Game): GameMoments {
  if (!previous || previous.id !== current.id) return { fallen: [], winner: null };
  const remaining = standing(current);
  return {
    fallen: current.order.filter(
      (id) => current.players[id].eliminated && previous.players[id]?.eliminated === false,
    ),
    winner:
      current.order.length > 1 &&
      current.status === 'active' &&
      remaining.length === 1 &&
      // Archenemy teammates win together; their outcome is shown on the board.
      (!current.archenemy || remaining[0] === current.archenemy.playerId) &&
      standing(previous).length > 1
        ? remaining[0]
        : null,
  };
}

/** The winner stays on screen only while that same player is the one still standing. */
export function stillWinner(
  game: Game | undefined,
  winner: { gameId: string; playerId: string } | undefined,
) {
  if (!game || !winner || game.id !== winner.gameId || game.status !== 'active') return false;
  const remaining = standing(game);
  return (
    remaining.length === 1 &&
    remaining[0] === winner.playerId &&
    (!game.archenemy || winner.playerId === game.archenemy.playerId)
  );
}
