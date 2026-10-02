import type { Game } from './schema.js';

/** Undo must obey current ownership, including frames saved by older room versions. */
export function canUndoRoomAction(game: Game, memberId: string, seatId: string | null, host: boolean) {
  const frame = game.undo.at(-1);
  if (!frame || frame.actorId !== memberId) return false;
  return frame.changes.every(({ path }) => {
    const [root, id] = path;
    if (root === 'players' || root === 'damageReceived') return !!seatId && id === seatId;
    if (root === 'commanders') return !!seatId && game.commanders[id]?.ownerId === seatId;
    return host && ['markers', 'turn', 'timer', 'settings', 'status', 'endedAt'].includes(root);
  });
}
