import { teamName, teamOf } from '../../shared/game.js';
import type { Game } from '../../shared/schema.js';

export type TurnShare = { key: string; name: string; ms: number };
/** Time spent on turns by each player, or by each side when turns are shared. */
export function turnShares(game: Game, now: number): TurnShare[] {
  const spent: Record<string, number> = { ...game.turnTime };
  const { playerId, startedAt } = game.turn;
  if (game.status === 'active' && game.settings.turnTracking && playerId && startedAt !== undefined)
    spent[playerId] = (spent[playerId] ?? 0) + Math.max(0, (game.timer.pausedAt ?? now) - startedAt);
  const total = (ids: string[]) => ids.reduce((sum, id) => sum + (spent[id] ?? 0), 0);
  const sides: { key: string; name: string; ids: string[] }[] = game.teams
    ? game.teams.map((ids, index) => ({
        key: `team:${index}`,
        name: `${teamName(index)} (${ids.map((id) => game.players[id]?.name).join(' & ')})`,
        ids,
      }))
    : game.archenemy
      ? [
          {
            key: game.archenemy.playerId,
            name: game.players[game.archenemy.playerId].name,
            ids: [game.archenemy.playerId],
          },
          { key: 'team', name: 'The team', ids: teamOf(game) },
        ]
      : game.order.map((id) => ({ key: id, name: game.players[id].name, ids: [id] }));
  const shares = sides.map((side) => ({ key: side.key, name: side.name, ms: total(side.ids) }));
  return shares.some((share) => share.ms >= 1000) ? shares : [];
}

export type LifeStep = { at: number; delta: number; life: number };
/** One seat's life changes, newest first, from the game's life log. */
export function lifeHistory(game: Game, playerId: string, limit = 40): LifeStep[] {
  const seat = game.order.indexOf(playerId);
  const log = game.lifeLog ?? [];
  if (seat < 0 || log.length < 2) return [];
  const steps: LifeStep[] = [];
  for (let index = 1; index < log.length; index++) {
    const before = log[index - 1].l[seat],
      after = log[index].l[seat];
    if (before === undefined || after === undefined || before === after) continue;
    steps.push({ at: Math.max(0, log[index].t - log[0].t), delta: after - before, life: after });
  }
  return steps.reverse().slice(0, limit);
}
