import { z } from 'zod';
import { elapsed, isArchenemy, standingWinners } from '../../shared/game.js';
import type { Game } from '../../shared/schema.js';

/** One finished game as this browser saw it. Stats never leave the device. */
export const statRecordSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.number(),
  endedAt: z.number(),
  durationMs: z.number().nonnegative(),
  preset: z.string().max(40),
  mode: z.enum(['local', 'room']),
  turns: z.number().int().nonnegative(),
  draw: z.boolean().optional(),
  players: z
    .array(
      z.object({
        name: z.string().max(40),
        color: z.string().max(20),
        commanders: z.array(z.string().max(100)).max(2),
        life: z.number(),
        eliminated: z.boolean(),
        winner: z.boolean(),
      }),
    )
    .min(1)
    .max(8),
});
export type StatRecord = z.infer<typeof statRecordSchema>;
export const MAX_STAT_RECORDS = 300;

const placeholder = /^Commander [12]$/;
/** A table that was only set up, with nothing recorded, is not a game worth counting. */
export function wasPlayed(game: Game) {
  if (game.order.length < 2) return false;
  if (game.result) return true;
  return game.order.some((id) => {
    const player = game.players[id];
    const start = isArchenemy(game, id)
      ? (game.settings.archenemyLife ?? game.settings.startingLife)
      : game.settings.startingLife;
    return player.life !== start || player.eliminated || player.poison > 0;
  });
}
export function statRecord(game: Game, mode: 'local' | 'room', at: number): StatRecord {
  const endedAt = game.endedAt ?? at;
  const winners = game.result ? (game.result.draw ? [] : game.result.winners) : standingWinners(game);
  return {
    id: game.id,
    startedAt: game.timer.startedAt,
    endedAt,
    durationMs: elapsed(game, endedAt),
    preset: game.settings.preset,
    mode,
    turns: game.turn.number,
    ...(game.result?.draw ? { draw: true } : {}),
    players: game.order.map((id) => ({
      name: game.players[id].name,
      color: game.players[id].color,
      commanders: game.settings.commander
        ? Object.values(game.commanders)
            .filter((c) => c.ownerId === id && (c.card || !placeholder.test(c.label)))
            .map((c) => c.card?.name ?? c.label)
        : [],
      life: game.players[id].life,
      eliminated: game.players[id].eliminated,
      winner: winners.includes(id),
    })),
  };
}
/** What changed between two confirmed snapshots that the stats should know about. */
export function statChange(
  previous: Game | undefined,
  current: Game | undefined,
): { record?: Game; remove?: string } {
  if (!previous || !current || previous === current) return {};
  if (previous.id === current.id) {
    if (current.status === 'ended') {
      const resultChanged = JSON.stringify(previous.result) !== JSON.stringify(current.result);
      if ((previous.status === 'active' || resultChanged) && wasPlayed(current)) return { record: current };
      return {};
    }
    // A reopened game is in play again; it is counted when it ends.
    return previous.status === 'ended' ? { remove: current.id } : {};
  }
  // A rematch keeps every seat and starts a new match: the previous one is over.
  const rematch =
    previous.status === 'active' &&
    current.history.length === 1 &&
    current.history[0].summary === 'A new game began' &&
    previous.order.length === current.order.length &&
    previous.order.every((id, index) => current.order[index] === id);
  return rematch && wasPlayed(previous) ? { record: previous } : {};
}

/** Fold records exported from another device into this one. Games already here are kept as they are. */
export function mergeStats(existing: StatRecord[], incoming: unknown) {
  const known = new Set(existing.map((record) => record.id));
  const added: StatRecord[] = [];
  for (const entry of Array.isArray(incoming) ? incoming.slice(0, 2000) : []) {
    const parsed = statRecordSchema.safeParse(entry);
    if (!parsed.success || known.has(parsed.data.id)) continue;
    known.add(parsed.data.id);
    added.push(parsed.data);
  }
  const records = [...existing, ...added].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_STAT_RECORDS);
  return { records, added: records.filter((record) => added.includes(record)).length };
}

export type Tally = { name: string; games: number; wins: number };
const tally = (rows: Map<string, Tally>, name: string, won: boolean) => {
  const key = name.trim().toLowerCase();
  const row = rows.get(key) ?? { name: name.trim(), games: 0, wins: 0 };
  row.games++;
  if (won) row.wins++;
  rows.set(key, row);
};
const ranked = (rows: Map<string, Tally>) =>
  [...rows.values()].sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name));
export function summarize(records: StatRecord[]) {
  const players = new Map<string, Tally>(),
    commanders = new Map<string, Tally>();
  let decided = 0,
    duration = 0;
  for (const record of records) {
    if (record.draw || record.players.some((player) => player.winner)) decided++;
    duration += record.durationMs;
    for (const player of record.players) {
      tally(players, player.name, player.winner);
      if (player.commanders.length) tally(commanders, player.commanders.join(' + '), player.winner);
    }
  }
  return {
    games: records.length,
    decided,
    averageMs: records.length ? duration / records.length : 0,
    players: ranked(players),
    commanders: ranked(commanders),
  };
}
export const winRate = (row: Tally) => (row.games ? `${Math.round((row.wins / row.games) * 100)}%` : '—');
