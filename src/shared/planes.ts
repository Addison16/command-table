import { planeIndex, type PlaneSet } from './planeIndex.js';

export { type PlaneSet };
export type PlaneEntry = { id: string; name: string; set: PlaneSet; phenomenon: boolean };

/** Every printed plane and phenomenon, grouped by the product whose printing Scryfall lists first. */
export const planeSets: readonly { id: PlaneSet; name: string; year: number }[] = [
  { id: 'pca', name: 'Planechase classics', year: 2009 },
  { id: 'moc', name: 'March of the Machine Commander', year: 2023 },
  { id: 'who', name: 'Doctor Who', year: 2023 },
];
export const planeSetIds = planeSets.map((set) => set.id) as [PlaneSet, ...PlaneSet[]];
export const planes: readonly PlaneEntry[] = planeIndex.map(([id, name, set, phenomenon]) => ({
  id,
  name,
  set,
  phenomenon,
}));
export const PLANE_COUNT = planes.length;

const byId = new Map(planes.map((plane) => [plane.id, plane]));
export function planeEntry(id: string | null | undefined): PlaneEntry | undefined {
  return id ? byId.get(id) : undefined;
}
export function isPlaneId(id: string) {
  return byId.has(id);
}
/** Scryfall's art crop. It needs a connection; the name and rules text work offline. */
export function planeImage(scryfallId: string) {
  return `https://cards.scryfall.io/art_crop/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

/** Fisher–Yates over the chosen sets, with an unbiased integer source. */
export function shufflePlanarDeck(sets: readonly PlaneSet[], rng: (max: number) => number): string[] {
  const deck = planes.filter((plane) => sets.includes(plane.set)).map((plane) => plane.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const planarFaces = ['blank', 'blank', 'blank', 'blank', 'chaos', 'planeswalk'] as const;
export type PlanarFace = (typeof planarFaces)[number];
