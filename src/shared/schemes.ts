import { schemeCards, type SchemeCard, type SchemeSet } from './schemeCards.js';

export { schemeCards, type SchemeCard, type SchemeSet };

/** Every printed scheme, grouped by the product that introduced it. */
export const schemeSets: readonly { id: SchemeSet; name: string; year: number }[] = [
  { id: 'arc', name: 'Archenemy', year: 2010 },
  { id: 'e01', name: 'Archenemy: Nicol Bolas', year: 2017 },
  { id: 'dsc', name: 'Duskmourn Commander', year: 2024 },
];
export const schemeSetIds = schemeSets.map((set) => set.id) as [SchemeSet, ...SchemeSet[]];

const byId = new Map(schemeCards.map((card) => [card.id, card]));
export function schemeCard(id: string | null | undefined): SchemeCard | undefined {
  return id ? byId.get(id) : undefined;
}
export function isSchemeId(id: string) {
  return byId.has(id);
}
/** Scryfall's art crop. It needs a connection; the name and rules text work offline. */
export function schemeImage(card: SchemeCard) {
  const id = card.scryfallId;
  return `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`;
}

/** Fisher–Yates over the chosen sets, with an unbiased integer source. */
export function shuffleSchemeDeck(sets: readonly SchemeSet[], rng: (max: number) => number): string[] {
  const deck = schemeCards.filter((card) => sets.includes(card.set)).map((card) => card.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

type SchemeState = { deck?: string[]; position?: number; ongoing: string[] };
/**
 * The deck cycles: a revealed scheme goes to the bottom, so the next reveal is the card after it.
 * Ongoing schemes stay face up and are skipped until they are abandoned.
 */
export function nextSchemeIndex(state: SchemeState): number | null {
  const deck = state.deck ?? [];
  for (let step = 0; step < deck.length; step++) {
    const index = ((state.position ?? 0) + step) % deck.length;
    const card = schemeCard(deck[index]);
    if (card && !state.ongoing.includes(card.name)) return index;
  }
  return null;
}
export function schemesRemaining(state: SchemeState) {
  return (state.deck ?? []).filter((id) => !state.ongoing.includes(schemeCard(id)?.name ?? '')).length;
}
