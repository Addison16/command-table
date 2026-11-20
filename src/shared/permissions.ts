import { teammates } from './game.js';
import type { Game } from './schema.js';

type Frame = Game['undo'][number];
/** A frame may be reversed, or replayed, only by its author and within their current authority. */
function frameAllowed(
  game: Game,
  frame: Frame | undefined,
  memberId: string,
  seatId: string | null,
  host: boolean,
) {
  if (!frame || frame.actorId !== memberId) return false;
  const side = seatId ? teammates(game, seatId) : [];
  return frame.changes.every(({ path }) => {
    const [root, id, field] = path;
    // A host's group life change touches other seats' life and nothing else.
    if (root === 'players' && host && field === 'life') return true;
    if (root === 'players' || root === 'damageReceived') return side.includes(id);
    if (root === 'commanders') return !!seatId && game.commanders[id]?.ownerId === seatId;
    if (root === 'archenemy') return (!!seatId && game.archenemy?.playerId === seatId) || host;
    // Anyone seated runs the shared planar deck and the day/night marker.
    if (root === 'planechase') return !!seatId || host;
    if (root === 'markers')
      return host || (!!seatId && (id === 'dayNight' || frame.changes.every((c) => c.after === seatId)));
    return host && ['turn', 'timer', 'settings', 'status', 'endedAt', 'result'].includes(root);
  });
}
/** Undo must obey current ownership, including frames saved by older room versions. */
export function canUndoRoomAction(game: Game, memberId: string, seatId: string | null, host: boolean) {
  return frameAllowed(game, game.undo.at(-1), memberId, seatId, host);
}
export function canRedoRoomAction(game: Game, memberId: string, seatId: string | null, host: boolean) {
  return frameAllowed(game, game.redo.at(-1), memberId, seatId, host);
}
