import { describe, expect, it } from 'vitest';
import { playerStatuses } from '../src/client/features/playerStatuses.js';
import { createGame, defaultSetup } from '../src/shared/game.js';
import { newId } from '../src/shared/random.js';
import { LIMIT } from '../src/shared/schema.js';

function fixture(partners = false) {
  const setup = defaultSetup(3);
  setup.seats[0] = {
    name: 'Rowan',
    color: 'ivory',
    commanders: partners ? ['Tymna', 'Kraum'] : ['Tymna'],
  };
  setup.seats[1].name = 'Mira';
  setup.seats[1].commanders = ['Atraxa'];
  setup.seats[2].name = 'Sam';
  setup.seats[2].commanders = ['Korvold'];
  const game = createGame(setup, newId, 1000);
  const playerId = game.order[0];
  const owned = Object.values(game.commanders).filter((commander) => commander.ownerId === playerId);
  const opponents = Object.values(game.commanders).filter((commander) => commander.ownerId !== playerId);
  return { game, playerId, owned, opponents };
}

describe('player card status summaries', () => {
  it('keeps commander shortcuts visible at zero and safely handles an unavailable seat', () => {
    const { game, playerId, opponents } = fixture(true);
    const initial = playerStatuses(game, playerId);
    expect(initial.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: 'commander-damage', value: '0' },
      { kind: 'tax', value: '+0' },
      { kind: 'tax', value: '+0' },
    ]);
    game.damageReceived[playerId] = { [opponents[0].id]: 0 };
    expect(playerStatuses(game, playerId)).toEqual(initial);
    expect(playerStatuses(game, newId())).toEqual([]);
  });

  it('reports the highest individual damage rather than a combined total and names every positive source', () => {
    const { game, playerId, owned, opponents } = fixture();
    game.damageReceived[playerId] = {
      [owned[0].id]: 0,
      [opponents[0].id]: 13,
      [opponents[1].id]: 8,
    };
    const [damage] = playerStatuses(game, playerId);
    expect(damage).toMatchObject({ kind: 'commander-damage', label: 'DAMAGE', value: '13', warning: false });
    expect(damage.description).toContain('from one commander: 13');
    expect(damage.description).toContain("Mira's Atraxa: 13");
    expect(damage.description).toContain("Sam's Korvold: 8");
    expect(damage.description).not.toContain('Tymna');
    game.damageReceived[playerId][opponents[1].id] = 13;
    const [tied] = playerStatuses(game, playerId);
    expect(tied.value).toBe('13');
    expect(tied.warning).toBe(false);
    expect(tied.description).toContain("Sam's Korvold: 13");
  });

  it('ignores legacy self-damage, includes eliminated opponents, and preserves final statuses', () => {
    const { game, playerId, owned, opponents } = fixture();
    game.damageReceived[playerId] = { [owned[0].id]: 22, [opponents[0].id]: 7 };
    game.players[opponents[0].ownerId].eliminated = true;
    game.players[playerId].poison = 3;
    owned[0].casts = 2;
    const active = playerStatuses(game, playerId);
    expect(active[0]).toMatchObject({ value: '7', warning: false });
    expect(active[0].description).not.toContain("Rowan's Tymna");
    expect(active[0].description).toContain("Mira's Atraxa: 7");
    game.players[playerId].eliminated = true;
    game.status = 'ended';
    game.endedAt = 2000;
    const original = structuredClone(game);
    expect(playerStatuses(game, playerId)).toEqual(active);
    expect(game).toEqual(original);
  });

  it('keeps partner taxes separate and preserves their labels when only the second partner has been cast', () => {
    const { game, playerId, owned, opponents } = fixture(true);
    owned[1].casts = 3;
    opponents[0].casts = 9;
    const secondOnly = playerStatuses(game, playerId).filter((status) => status.kind === 'tax');
    expect(secondOnly).toHaveLength(2);
    expect(secondOnly[0]).toMatchObject({ label: 'TAX I', value: '+0' });
    expect(secondOnly[1]).toMatchObject({ kind: 'tax', label: 'TAX II', value: '+6', warning: false });
    expect(secondOnly[1].description).toContain('Kraum');
    owned[0].casts = 1;
    const both = playerStatuses(game, playerId).filter((status) => status.kind === 'tax');
    expect(both.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'TAX I', value: '+2' },
      { label: 'TAX II', value: '+6' },
    ]);
    expect(both[0].description).toContain('Tymna');
    expect(both[0].description).toContain('next command-zone cast costs +2 additional generic mana');
    expect(both[0].key).not.toBe(both[1].key);
    expect(both[1].key).toBe(secondOnly[1].key);
  });

  it('retains exact maximum values, including tax beyond the ordinary counter limit', () => {
    const { game, playerId, owned, opponents } = fixture();
    owned[0].casts = LIMIT;
    game.players[playerId].poison = LIMIT;
    game.damageReceived[playerId] = { [opponents[0].id]: LIMIT };
    const statuses = playerStatuses(game, playerId);
    expect(statuses.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'DAMAGE', value: '999999' },
      { label: 'POISON', value: '999999' },
      { label: 'TAX', value: '+1999998' },
    ]);
    expect(statuses[2].description).toContain('+1999998 additional generic mana');
    expect(statuses[2].warning).toBe(false);
  });

  it('hides disabled trackers without changing their saved values', () => {
    const { game, playerId, owned, opponents } = fixture();
    owned[0].casts = 2;
    game.players[playerId].poison = 3;
    game.damageReceived[playerId] = { [opponents[0].id]: 5 };
    game.settings.commander = false;
    expect(playerStatuses(game, playerId).map((status) => status.kind)).toEqual(['poison']);
    game.settings.poison = false;
    expect(playerStatuses(game, playerId)).toEqual([]);
    game.settings.commander = true;
    expect(playerStatuses(game, playerId).map((status) => status.kind)).toEqual(['commander-damage', 'tax']);
    game.settings.poison = true;
    expect(playerStatuses(game, playerId).map((status) => status.value)).toEqual(['5', '3', '+4']);
  });

  it('uses each configured warning threshold at its exact boundary', () => {
    const { game, playerId, opponents } = fixture();
    game.settings.commanderThreshold = 5;
    game.settings.poisonThreshold = 4;
    game.damageReceived[playerId] = { [opponents[0].id]: 4 };
    game.players[playerId].poison = 3;
    const below = playerStatuses(game, playerId);
    expect(below.map((status) => status.warning)).toEqual([false, false, false]);
    expect(below[0].description).toContain('Warning at 5 from one commander');
    expect(below[1].description).toContain('Warning at 4');
    game.damageReceived[playerId][opponents[0].id] = 5;
    game.players[playerId].poison = 4;
    expect(playerStatuses(game, playerId).map((status) => status.warning)).toEqual([true, true, false]);
  });
});
