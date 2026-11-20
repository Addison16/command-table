import { teammates } from '../../shared/game.js';
import type { Game } from '../../shared/schema.js';

export type GameMoments = { fallen: string[]; winner: string | null };

export const standing = (game: Game) => game.order.filter((id) => !game.players[id].eliminated);

/**
 * The seat whose side is the only one left: the last player, the first head of
 * the last Two-Headed Giant team, or an archenemy who outlasted the whole team.
 */
export function lastStanding(game: Game): string | null {
  const remaining = standing(game);
  if (game.order.length < 2 || !remaining.length) return null;
  if (game.teams) {
    const side = teammates(game, remaining[0]);
    return remaining.every((id) => side.includes(id)) ? side[0] : null;
  }
  if (remaining.length !== 1) return null;
  // Archenemy teammates win together; their outcome is shown on the board.
  return !game.archenemy || remaining[0] === game.archenemy.playerId ? remaining[0] : null;
}

/**
 * Compare two confirmed snapshots of one match. Elimination stays a manual
 * decision; this only notices it, and the last player left standing by it.
 */
export function gameMoments(previous: Game | undefined, current: Game): GameMoments {
  if (!previous || previous.id !== current.id) return { fallen: [], winner: null };
  const winner = current.status === 'active' ? lastStanding(current) : null;
  return {
    fallen: current.order.filter(
      (id) => current.players[id].eliminated && previous.players[id]?.eliminated === false,
    ),
    winner:
      winner && (current.teams ? lastStanding(previous) === null : standing(previous).length > 1)
        ? winner
        : null,
  };
}

/** The winner stays on screen only while that same player is the one still standing. */
export function stillWinner(
  game: Game | undefined,
  winner: { gameId: string; playerId: string } | undefined,
) {
  if (!game || !winner || game.id !== winner.gameId || game.status !== 'active') return false;
  return lastStanding(game) === winner.playerId;
}
