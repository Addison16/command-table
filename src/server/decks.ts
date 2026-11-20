import { z } from 'zod';
import { CardLookupError } from './cards.js';

const MAX_BYTES = 3_000_000;
const CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE = 64;
const MAX_ACTIVE = 4;

export type DeckSite = 'archidekt' | 'moxfield';
export type DeckCommanders = {
  site: DeckSite;
  name: string;
  /** A Scryfall card id lets the client load the exact printing's artwork. */
  commanders: { name: string; scryfallId?: string }[];
};

const invalidLink = () =>
  new CardLookupError(400, 'Paste a deck link from archidekt.com or moxfield.com to bring in its commander.');
const unavailable = (site: DeckSite) =>
  new CardLookupError(
    503,
    `${site === 'moxfield' ? 'Moxfield' : 'Archidekt'} could not be reached right now. Type the commander name instead.`,
  );

/**
 * Recognize a public deck link and build a fixed API address from its id.
 * The server never fetches an address a user supplies.
 */
export function deckEndpoint(input: string): { site: DeckSite; url: string } {
  let text = input.trim();
  if (!text || text.length > 512) throw invalidLink();
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalidLink();
  }
  if (url.username || url.password || url.port) throw invalidLink();
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'archidekt.com' && parts[0] === 'decks' && /^\d{1,12}$/.test(parts[1] ?? ''))
    return { site: 'archidekt', url: `https://archidekt.com/api/decks/${parts[1]}/` };
  if (host === 'moxfield.com' && parts[0] === 'decks' && /^[A-Za-z0-9_-]{6,40}$/.test(parts[1] ?? ''))
    return { site: 'moxfield', url: `https://api2.moxfield.com/v3/decks/all/${parts[1]}` };
  throw invalidLink();
}

const uuid = z.string().uuid();
const cardName = z.string().trim().min(1).max(100);
const archidekt = z.object({
  name: z.string().max(300).catch('Deck'),
  categories: z
    .array(z.object({ name: z.string(), isPremier: z.boolean().optional() }))
    .max(200)
    .catch([]),
  cards: z
    .array(
      z.object({
        categories: z.array(z.string()).nullable().optional(),
        card: z.object({
          uid: z.string().optional(),
          oracleCard: z.object({ name: cardName }),
        }),
      }),
    )
    .max(2000),
});
const moxfieldCard = z.object({
  card: z.object({ name: cardName, scryfall_id: z.string().optional() }),
});
const moxfield = z.object({
  name: z.string().max(300).catch('Deck'),
  boards: z.object({ commanders: z.object({ cards: z.record(z.string(), moxfieldCard) }) }).optional(),
  commanders: z.record(z.string(), moxfieldCard).optional(),
});

function commander(name: string, id: string | undefined) {
  const parsed = uuid.safeParse(id);
  return { name, ...(parsed.success ? { scryfallId: parsed.data.toLowerCase() } : {}) };
}

export function deckFromResponse(site: DeckSite, value: unknown): DeckCommanders {
  const none = () =>
    new CardLookupError(404, 'No commander is marked in that deck. Type the commander name instead.');
  if (site === 'archidekt') {
    const deck = archidekt.safeParse(value);
    if (!deck.success) throw unavailable(site);
    // Archidekt marks command-zone cards with a "premier" category, named Commander by default.
    const premier = new Set([
      'Commander',
      ...deck.data.categories.filter((c) => c.isPremier).map((c) => c.name),
    ]);
    const commanders = deck.data.cards
      .filter((entry) => entry.categories?.some((category) => premier.has(category)))
      .slice(0, 2)
      .map((entry) => commander(entry.card.oracleCard.name, entry.card.uid));
    if (!commanders.length) throw none();
    return { site, name: deck.data.name.trim().slice(0, 100) || 'Deck', commanders };
  }
  const deck = moxfield.safeParse(value);
  if (!deck.success) throw unavailable(site);
  const commanders = Object.values(deck.data.boards?.commanders.cards ?? deck.data.commanders ?? {})
    .slice(0, 2)
    .map((entry) => commander(entry.card.name, entry.card.scryfall_id));
  if (!commanders.length) throw none();
  return { site, name: deck.data.name.trim().slice(0, 100) || 'Deck', commanders };
}

async function readJson(response: Response, site: DeckSite): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await reader?.cancel();
    throw unavailable(site);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BYTES) {
      await reader.cancel();
      throw unavailable(site);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw unavailable(site);
  }
}

export class DeckLookupService {
  private cache = new Map<string, { value: DeckCommanders; expiresAt: number }>();
  private active = 0;
  private fetcher: typeof fetch;
  private now: () => number;
  constructor(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
  }

  async commanders(link: string): Promise<DeckCommanders> {
    const { site, url } = deckEndpoint(link);
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    this.cache.delete(url);
    if (this.active >= MAX_ACTIVE)
      throw new CardLookupError(503, 'Deck lookup is busy. Wait a moment and try again.');
    this.active++;
    try {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'GET',
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CommandTable (+https://github.com/Addison16/command-table)',
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw unavailable(site);
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          throw new CardLookupError(404, 'That deck was not found. Check that it is public and try again.');
        if (response.status === 401 || response.status === 403)
          throw new CardLookupError(
            502,
            site === 'moxfield'
              ? 'Moxfield does not let this server read decks. Type the commander name, or use an Archidekt link.'
              : 'That deck is private. Make it public or unlisted, or type the commander name.',
          );
        throw unavailable(site);
      }
      const value = deckFromResponse(site, await readJson(response, site));
      this.cache.set(url, { value, expiresAt: this.now() + CACHE_MS });
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } finally {
      this.active--;
    }
  }
}

export const deckLookup = new DeckLookupService();
