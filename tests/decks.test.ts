import { describe, expect, it, vi } from 'vitest';
import { CardLookupError } from '../src/server/cards.js';
import { deckEndpoint, deckFromResponse, DeckLookupService } from '../src/server/decks.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

const id = '92b0be6d-9183-4938-b7a1-ae7f04ba78a0';
const archidekt = {
  name: 'Fun With Fungus',
  categories: [{ name: 'Commander', isPremier: true }],
  cards: [
    { categories: ['Commander'], card: { uid: id, oracleCard: { name: 'Thelon of Havenwood' } } },
    { categories: ['Land'], card: { uid: 'x', oracleCard: { name: 'Forest' } } },
  ],
};

describe('deck links', () => {
  it('turns recognized deck links into fixed API addresses and refuses everything else', () => {
    expect(deckEndpoint('https://archidekt.com/decks/123456/fun-with-fungus')).toEqual({
      site: 'archidekt',
      url: 'https://archidekt.com/api/decks/123456/',
    });
    expect(deckEndpoint('www.moxfield.com/decks/AbC_dEf-123').url).toBe(
      'https://api2.moxfield.com/v3/decks/all/AbC_dEf-123',
    );
    for (const link of [
      '',
      'Atraxa',
      'https://example.com/decks/123',
      'https://archidekt.com.evil.example/decks/123',
      'https://user:pass@archidekt.com/decks/123',
      'https://archidekt.com:8443/decks/123',
      'https://archidekt.com/decks/../../admin',
      'https://moxfield.com/decks/a%2F..%2Fb',
      'https://archidekt.com/decks/12ab',
    ])
      expect(() => deckEndpoint(link), link).toThrow(CardLookupError);
  });
  it('reads commanders from both sites and reports a deck without one', () => {
    expect(deckFromResponse('archidekt', archidekt)).toEqual({
      site: 'archidekt',
      name: 'Fun With Fungus',
      commanders: [{ name: 'Thelon of Havenwood', scryfallId: id }],
    });
    expect(
      deckFromResponse('moxfield', {
        name: 'Partners',
        boards: {
          commanders: {
            cards: {
              a: { card: { name: 'Thrasios, Triton Hero', scryfall_id: id } },
              b: { card: { name: 'Tymna the Weaver' } },
            },
          },
        },
      }).commanders,
    ).toEqual([{ name: 'Thrasios, Triton Hero', scryfallId: id }, { name: 'Tymna the Weaver' }]);
    expect(() => deckFromResponse('archidekt', { ...archidekt, cards: [archidekt.cards[1]] })).toThrow(
      /no commander/i,
    );
    expect(() => deckFromResponse('moxfield', 'nonsense')).toThrow(CardLookupError);
  });
  it('fetches only the fixed address, caches the answer and explains a refusal', async () => {
    const fetcher = vi.fn(async () => Response.json(archidekt));
    const service = new DeckLookupService({ fetcher: fetcher as unknown as typeof fetch });
    const first = await service.commanders('https://archidekt.com/decks/1/anything');
    expect(first.commanders[0].name).toBe('Thelon of Havenwood');
    await service.commanders('archidekt.com/decks/1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0 as never]).toBe('https://archidekt.com/api/decks/1/');
    expect((fetcher.mock.calls[0][1 as never] as RequestInit).redirect).toBe('error');
    const blocked = new DeckLookupService({
      fetcher: (async () => new Response('no', { status: 403 })) as unknown as typeof fetch,
    });
    await expect(blocked.commanders('https://moxfield.com/decks/abcdef123')).rejects.toThrow(/Moxfield/);
    const offline = new DeckLookupService({
      fetcher: (async () => {
        throw new TypeError('network');
      }) as unknown as typeof fetch,
    });
    await expect(offline.commanders('https://archidekt.com/decks/2')).rejects.toThrow(/could not be reached/);
  });
});

describe('deck route', () => {
  it('serves commanders for a deck link and a clear error for anything else', async () => {
    const decks = new DeckLookupService({
      fetcher: (async () => Response.json(archidekt)) as unknown as typeof fetch,
    });
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
      decks,
    });
    try {
      const ok = await app.inject('/api/cards/deck?q=https%3A%2F%2Farchidekt.com%2Fdecks%2F1');
      expect(ok.statusCode).toBe(200);
      expect(ok.json().commanders).toEqual([{ name: 'Thelon of Havenwood', scryfallId: id }]);
      expect(ok.cookies).toHaveLength(0);
      const bad = await app.inject('/api/cards/deck?q=https%3A%2F%2Fexample.com%2Fdecks%2F1');
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toMatch(/archidekt/i);
    } finally {
      await app.close();
    }
  });
});
