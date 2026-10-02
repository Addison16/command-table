import type { Game } from '../../shared/schema.js';

export type PlayerStatus = {
  kind: 'commander-damage' | 'poison' | 'tax';
  key: string;
  label: string;
  value: string;
  description: string;
  warning: boolean;
};

/** Damage and tax shortcuts stay visible at zero; separate commanders never combine. */
export function playerStatuses(game: Game, playerId: string): PlayerStatus[] {
  const player = game.players[playerId];
  if (!player) return [];
  const statuses: PlayerStatus[] = [];
  const commanders = Object.values(game.commanders);
  if (game.settings.commander) {
    const received = commanders
      .filter((commander) => commander.ownerId !== playerId)
      .map((commander) => ({ commander, amount: game.damageReceived[playerId]?.[commander.id] ?? 0 }))
      .filter(({ amount }) => amount > 0);
    const highest = Math.max(0, ...received.map(({ amount }) => amount));
    const sources = received
      .map(
        ({ commander, amount }) => `${game.players[commander.ownerId].name}'s ${commander.label}: ${amount}`,
      )
      .join('; ');
    statuses.push({
      kind: 'commander-damage',
      key: 'commander-damage',
      label: 'DAMAGE',
      value: String(highest),
      description: `Highest commander damage received from one commander: ${highest}. ${sources ? `Recorded damage: ${sources}.` : 'No commander damage recorded.'} Warning at ${game.settings.commanderThreshold} from one commander.`,
      warning: highest >= game.settings.commanderThreshold,
    });
  }
  if (game.settings.poison && player.poison > 0) {
    statuses.push({
      kind: 'poison',
      key: 'poison',
      label: 'POISON',
      value: String(player.poison),
      description: `${player.name}: ${player.poison} poison counters. Warning at ${game.settings.poisonThreshold}.`,
      warning: player.poison >= game.settings.poisonThreshold,
    });
  }
  if (game.settings.commander) {
    const owned = commanders.filter((commander) => commander.ownerId === playerId);
    owned.forEach((commander, index) => {
      const tax = commander.casts * 2;
      statuses.push({
        kind: 'tax',
        key: `tax:${commander.id}`,
        label: owned.length === 1 ? 'TAX' : `TAX ${index === 0 ? 'I' : 'II'}`,
        value: `+${tax}`,
        description: `${commander.label}: next command-zone cast costs +${tax} additional generic mana (${commander.casts} previous command-zone ${commander.casts === 1 ? 'cast' : 'casts'}).`,
        warning: false,
      });
    });
  }
  return statuses;
}
