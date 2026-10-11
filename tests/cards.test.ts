import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cardDetailsSchema,
  cardImageUrlSchema,
  cardRulingsSchema,
  commanderCardSchema,
} from '../src/shared/cards.js';
import { cardEndpoint, CardLookupService } from '../src/server/cards.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

const id = '12345678-1234-4234-8234-123456789abc';
const imageUrl = `https://cards.scryfall.io/art_crop/front/1/2/${id}.jpg?1712345678`;
const fullImageUrl = imageUrl.replace('/art_crop/', '/large/');
const upstream = {
  id,
  name: 'Example Commander',
  image_uris: { art_crop: imageUrl, large: fullImageUrl },
  scryfall_uri: 'https://scryfall.com/card/test/1/example-commander?utm_source=api',
  artist: 'Example Artist',
  mana_cost: '{2}{G}{U}',
  type_line: 'Legendary Creature — Elf Wizard',
  oracle_text: 'Flying\nWhenever you draw a card, you gain 1 life.',
  power: '2',
  toughness: '4',
};
const card = {
  id,
  name: upstream.name,
  imageUrl,
  scryfallUrl: 'https://scryfall.com/card/test/1/example-commander',
  artist: upstream.artist,
};
const details = {
  id,
  name: upstream.name,
  scryfallUrl: card.scryfallUrl,
  faces: [
    {
      name: upstream.name,
      manaCost: upstream.mana_cost,
      typeLine: upstream.type_line,
      oracleText: upstream.oracle_text,
      imageUrl: fullImageUrl,
      artist: upstream.artist,
      power: upstream.power,
      toughness: upstream.toughness,
    },
  ],
};
const rulingsUpstream = {
  object: 'list',
  has_more: false,
  data: [
    {
      object: 'ruling',
      oracle_id: id,
      source: 'wotc',
      published_at: '2024-02-29',
      comment: 'Choose the targets as you put this ability on the stack.',
    },
    {
      object: 'ruling',
      oracle_id: id,
      source: 'scryfall',
      published_at: '2024-03-01',
      comment: 'This note applies to both faces of the card.',
    },
  ],
};
const rulings = {
  cardId: id,
  rulings: rulingsUpstream.data.map((ruling) => ({
    source: ruling.source,
    publishedAt: ruling.published_at,
    comment: ruling.comment,
  })),
  hasMore: false,
};

function clock() {
  let now = 1_800_000_000_000;
  return {
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    sleep: vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    }),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('safe commander card metadata', () => {
  it('validates dated, attributed rulings without trusting arbitrary source names or invalid dates', () => {
    expect(cardRulingsSchema.parse(rulings)).toEqual(rulings);
    expect(cardRulingsSchema.parse({ ...rulings, rulings: [] }).rulings).toEqual([]);
    for (const ruling of [
      { ...rulings.rulings[0], source: 'official' },
      { ...rulings.rulings[0], publishedAt: '2023-02-29' },
      { ...rulings.rulings[0], publishedAt: '2024-02-29T00:00:00Z' },
      { ...rulings.rulings[0], comment: ' ' },
      { ...rulings.rulings[0], comment: 'x'.repeat(12001) },
    ])
      expect(cardRulingsSchema.safeParse({ ...rulings, rulings: [ruling] }).success).toBe(false);
    expect(
      cardRulingsSchema.safeParse({ ...rulings, rulings: Array(201).fill(rulings.rulings[0]) }).success,
    ).toBe(false);
  });

  it('validates bounded readable card details and keeps full scans separate from saved artwork', () => {
    expect(cardDetailsSchema.parse(details)).toEqual(details);
    expect(cardImageUrlSchema.parse(fullImageUrl.replace('/large/', '/normal/'))).toContain('/normal/');
    for (const image of [
      imageUrl,
      fullImageUrl.replace('https:', 'http:'),
      fullImageUrl.replace('cards.scryfall.io', 'cards.scryfall.io.evil.example'),
      fullImageUrl.replace('cards.scryfall.io', 'user:password@cards.scryfall.io'),
      fullImageUrl.replace('cards.scryfall.io', 'cards.scryfall.io:8443'),
      fullImageUrl.replace('.jpg', '.svg'),
      fullImageUrl + '#fragment',
      fullImageUrl + '&redirect=https://evil.example',
      'data:image/svg+xml,<svg/>',
    ]) {
      expect(cardImageUrlSchema.safeParse(image).success).toBe(false);
      expect(
        cardDetailsSchema.safeParse({ ...details, faces: [{ ...details.faces[0], imageUrl: image }] })
          .success,
      ).toBe(false);
    }
    expect(commanderCardSchema.safeParse({ ...card, imageUrl: fullImageUrl }).success).toBe(false);
    expect(cardDetailsSchema.safeParse({ ...details, faces: [] }).success).toBe(false);
    expect(cardDetailsSchema.safeParse({ ...details, faces: Array(9).fill(details.faces[0]) }).success).toBe(
      false,
    );
    expect(
      cardDetailsSchema.safeParse({
        ...details,
        faces: [{ ...details.faces[0], oracleText: 'x'.repeat(12001) }],
      }).success,
    ).toBe(false);
  });

  it('accepts trusted artwork and rejects unsafe URLs in imported metadata', () => {
    expect(commanderCardSchema.parse(card)).toEqual(card);
    expect(commanderCardSchema.parse({ ...card, scryfallUrl: `https://scryfall.com/cards/${id}` }).id).toBe(
      id,
    );
    for (const imageUrl of [
      'data:image/svg+xml,<svg/>',
      `http://cards.scryfall.io/art_crop/front/1/2/${id}.jpg`,
      `https://cards.scryfall.io.evil.example/art_crop/front/1/2/${id}.jpg`,
      `https://user:password@cards.scryfall.io/art_crop/front/1/2/${id}.jpg`,
      `https://cards.scryfall.io:8443/art_crop/front/1/2/${id}.jpg`,
      `https://cards.scryfall.io/art_crop/front/1/2/${id}.svg`,
      `https://cards.scryfall.io/normal/front/1/2/${id}.jpg`,
    ])
      expect(commanderCardSchema.safeParse({ ...card, imageUrl }).success).toBe(false);
    for (const scryfallUrl of [
      'javascript:alert(1)',
      'https://evil.example/card/test/1',
      'https://scryfall.com/search?q=commander',
    ])
      expect(commanderCardSchema.safeParse({ ...card, scryfallUrl }).success).toBe(false);
    expect(commanderCardSchema.safeParse({ ...card, name: 'x'.repeat(101) }).success).toBe(false);
    expect(commanderCardSchema.safeParse({ ...card, extra: true }).success).toBe(false);
  });

  it('maps names and known Scryfall links to fixed API endpoints', () => {
    expect(cardEndpoint(' Atraxa, Praetors’ Voice ')).toBe(
      'https://api.scryfall.com/cards/named?fuzzy=atraxa%2C+praetors%E2%80%99+voice',
    );
    expect(cardEndpoint('https://scryfall.com/card/2xm/190/atraxa-praetors-voice?utm_source=api')).toBe(
      'https://api.scryfall.com/cards/2xm/190',
    );
    expect(cardEndpoint('https://scryfall.com/card/mh3/123a/ja/example')).toBe(
      'https://api.scryfall.com/cards/mh3/123a/ja',
    );
    expect(cardEndpoint('https://scryfall.com/card/test/1%E2%98%85/example')).toBe(
      'https://api.scryfall.com/cards/test/1%E2%98%85',
    );
    expect(cardEndpoint(`https://scryfall.com/cards/${id}`)).toBe(`https://api.scryfall.com/cards/${id}`);
    for (const prefix of ['scryfall.com', 'www.scryfall.com', 'https://www.scryfall.com'])
      expect(cardEndpoint(`${prefix}/card/test/1/example-commander`)).toBe(
        'https://api.scryfall.com/cards/test/1',
      );
  });

  it.each([
    'http://127.0.0.1/private',
    'https://scryfall.com.evil.example/card/test/1/example',
    'www.scryfall.com.evil.example/card/test/1/example',
    'https://www.scryfall.com.evil.example/card/test/1/example',
    'https://scryfall.com@evil.example/card/test/1/example',
    'https://user:password@scryfall.com/card/test/1/example',
    'https://scryfall.com:8443/card/test/1/example',
    'https://api.scryfall.com/cards/named?fuzzy=example',
    'file:///etc/passwd',
    '//scryfall.com/card/test/1/example',
    'https://scryfall.com/search?q=example',
    'https://scryfall.com/card/test/%2F..%2Fprivate/example',
    'https://scryfall.com/card/test/1/arbitrary/path',
  ])('rejects an unrecognized lookup URL without fetching it: %s', async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new CardLookupService({ fetcher });
    await expect(service.resolve(url)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.details(url)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('bounded Scryfall lookup', () => {
  it('loads rulings by card ID, shares requests and caches empty results without following upstream URLs', async () => {
    const time = clock();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...rulingsUpstream, has_more: true, next_page: 'http://127.0.0.1/private' }),
      )
      .mockImplementation(async () => Response.json({ object: 'list', has_more: false, data: [] }));
    const service = new CardLookupService({ ...time, fetcher });
    expect(await Promise.all([service.rulings(id), service.rulings(id.toUpperCase())])).toEqual([
      { ...rulings, hasMore: true },
      { ...rulings, hasMore: true },
    ]);
    expect(await service.rulings(id)).toEqual({ ...rulings, hasMore: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.scryfall.com/cards/${id}/rulings`);
    time.advance(24 * 60 * 60 * 1000);
    expect(await service.rulings(id)).toEqual({ cardId: id, rulings: [], hasMore: false });
    expect(await service.rulings(id)).toEqual({ cardId: id, rulings: [], hasMore: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const input of [id + '/rulings', 'http://127.0.0.1/private', 'Example Commander', ''])
      await expect(service.rulings(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed rulings without caching them and recovers on retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...rulingsUpstream,
          data: [{ ...rulingsUpstream.data[0], published_at: 'not a date' }],
        }),
      )
      .mockResolvedValueOnce(Response.json(rulingsUpstream));
    const service = new CardLookupService({ ...clock(), fetcher });
    await expect(service.rulings(id)).rejects.toMatchObject({ statusCode: 503 });
    expect(await service.rulings(id)).toEqual(rulings);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('applies the same upstream backoff to rulings and other card lookups', async () => {
    const time = clock();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429, headers: { 'Retry-After': '60' } }))
      .mockResolvedValueOnce(Response.json(rulingsUpstream));
    const service = new CardLookupService({ ...time, fetcher });
    await expect(service.rulings(id)).rejects.toMatchObject({ statusCode: 429, retryAfter: 60 });
    await expect(service.details('Example Commander')).rejects.toMatchObject({ statusCode: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    time.advance(60000);
    expect(await service.rulings(id)).toEqual(rulings);
  });

  it('returns full readable commander text and reuses upstream data across artwork and details requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(upstream));
    const service = new CardLookupService({ ...clock(), fetcher });
    const [resolved, viewed] = await Promise.all([
      service.resolve('Example Commander'),
      service.details(' example commander '),
    ]);
    expect(resolved).toEqual({ card });
    expect(viewed).toEqual({ details });
    expect(await service.details('Example Commander')).toEqual({ details });
    expect(await service.resolve('Example Commander')).toEqual({ card });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const [viewedFirst, resolvedSecond] = await Promise.all([
      service.details('Another commander'),
      service.resolve('Another commander'),
    ]);
    expect(viewedFirst).toEqual({ details });
    expect(resolvedSecond).toEqual({ card });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns both faces and their own scans, mana costs, rules and loyalty', async () => {
    const frontImage = fullImageUrl.replace('/large/', '/normal/');
    const backImage = fullImageUrl.replace('/front/', '/back/');
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id,
        name: 'Front Commander // Back Planeswalker',
        scryfall_uri: upstream.scryfall_uri,
        card_faces: [
          {
            name: 'Front Commander',
            mana_cost: '{1}{U}',
            type_line: 'Legendary Creature — Human Wizard',
            oracle_text: '{T}: Draw a card, then discard a card.',
            power: '0',
            toughness: '2',
            artist: 'Front Artist',
            image_uris: { normal: frontImage },
          },
          {
            name: 'Back Planeswalker',
            mana_cost: '',
            type_line: 'Legendary Planeswalker — Example',
            oracle_text: '+1: Draw a card.',
            loyalty: '5',
            artist: 'Back Artist',
            image_uris: { large: backImage },
          },
        ],
      }),
    );
    expect((await new CardLookupService({ fetcher }).details('Front Commander')).details.faces).toEqual([
      {
        name: 'Front Commander',
        manaCost: '{1}{U}',
        typeLine: 'Legendary Creature — Human Wizard',
        oracleText: '{T}: Draw a card, then discard a card.',
        power: '0',
        toughness: '2',
        artist: 'Front Artist',
        imageUrl: frontImage,
      },
      {
        name: 'Back Planeswalker',
        manaCost: '',
        typeLine: 'Legendary Planeswalker — Example',
        oracleText: '+1: Draw a card.',
        loyalty: '5',
        artist: 'Back Artist',
        imageUrl: backImage,
      },
    ]);
  });

  it('uses shared scans for adventure cards while retaining separate readable face text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...upstream,
        name: 'Commander // Adventure',
        card_faces: [
          {
            name: 'Commander',
            mana_cost: '{2}{G}',
            type_line: 'Legendary Creature — Beast',
            oracle_text: 'Trample',
            power: '4',
            toughness: '4',
          },
          {
            name: 'Adventure',
            mana_cost: '{G}',
            type_line: 'Sorcery — Adventure',
            oracle_text: 'Draw a card.',
          },
        ],
      }),
    );
    const result = (await new CardLookupService({ fetcher }).details('Commander')).details;
    expect(result.faces.map((face) => face.imageUrl)).toEqual([fullImageUrl, fullImageUrl]);
    expect(result.faces.map((face) => face.oracleText)).toEqual(['Trample', 'Draw a card.']);
    expect(result.faces[1].power).toBeUndefined();
  });

  it('keeps readable text when full images are missing or unsafe without weakening art validation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ ...upstream, image_uris: { large: 'http://127.0.0.1/private' } }),
    );
    const service = new CardLookupService({ ...clock(), fetcher });
    const [viewed, resolved] = await Promise.allSettled([
      service.details('Example Commander'),
      service.resolve('Example Commander'),
    ]);
    expect(viewed).toEqual({
      status: 'fulfilled',
      value: {
        details: {
          ...details,
          faces: [{ ...details.faces[0], imageUrl: undefined }],
        },
      },
    });
    expect(resolved).toEqual({ status: 'rejected', reason: expect.objectContaining({ statusCode: 503 }) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed detail text and does not cache that failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...upstream, oracle_text: 'x'.repeat(12001) }))
      .mockResolvedValueOnce(Response.json(upstream));
    const service = new CardLookupService({ ...clock(), fetcher });
    await expect(service.details('Example Commander')).rejects.toMatchObject({ statusCode: 503 });
    expect(await service.details('Example Commander')).toEqual({ details });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns front-face artwork, name and artist for a double-faced card', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...upstream,
        name: 'Front Commander // Back Face',
        image_uris: undefined,
        artist: undefined,
        card_faces: [
          { name: 'Front Commander', artist: 'Front Artist', image_uris: { art_crop: imageUrl } },
          {
            name: 'Back Face',
            artist: 'Back Artist',
            image_uris: { art_crop: imageUrl.replace('/front/', '/back/') },
          },
        ],
      }),
    );
    const service = new CardLookupService({ fetcher });
    expect(await service.resolve('Front Commander')).toEqual({
      card: { ...card, name: 'Front Commander', artist: 'Front Artist' },
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': expect.stringContaining('CommandTable') },
    });
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('coalesces requests and caches names and metadata for 24 hours', async () => {
    const time = clock();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      Response.json(String(url).includes('/autocomplete') ? { data: ['Example Commander'] } : upstream),
    );
    const service = new CardLookupService({ ...time, fetcher });
    const [first, second] = await Promise.all([
      service.resolve('Example Commander'),
      service.resolve(' example commander '),
    ]);
    expect(first).toEqual({ card });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await service.suggest('Ex')).toEqual({ names: ['Example Commander'] });
    expect(await service.suggest('ex')).toEqual({ names: ['Example Commander'] });
    expect(await service.suggest('x')).toEqual({ names: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    time.advance(24 * 60 * 60 * 1000 - 551);
    await service.resolve('Example Commander');
    expect(fetcher).toHaveBeenCalledTimes(2);
    time.advance(1);
    await service.resolve('Example Commander');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('serializes all three endpoints at least 550ms apart and bounds queued requests', async () => {
    const time = clock(),
      starts: number[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      starts.push(time.now());
      if (starts.length === 1) await first;
      return Response.json(
        String(url).includes('/autocomplete') ? { data: ['Example Commander'] } : upstream,
      );
    });
    const service = new CardLookupService({ ...time, fetcher });
    const queued = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0
        ? service.details(`Name ${i}`)
        : i % 3 === 1
          ? service.suggest(`Name ${i}`)
          : service.resolve(`Name ${i}`),
    );
    await expect(service.resolve('One too many')).rejects.toMatchObject({ statusCode: 503 });
    expect(starts).toHaveLength(1);
    release();
    await Promise.all(queued);
    expect(starts).toHaveLength(12);
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 550)).toBe(true);
  });

  it('evicts old cache entries instead of growing indefinitely', async () => {
    const time = clock();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(upstream));
    const service = new CardLookupService({ ...time, fetcher });
    for (let i = 0; i <= 256; i++) await service.resolve(`Commander ${i}`);
    expect(fetcher).toHaveBeenCalledTimes(257);
    await service.resolve('Commander 256');
    expect(fetcher).toHaveBeenCalledTimes(257);
    await service.resolve('Commander 0');
    expect(fetcher).toHaveBeenCalledTimes(258);
  });

  it('backs off globally after 429 without retrying queued requests or hammering upstream', async () => {
    const time = clock();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429, headers: { 'Retry-After': '45' } }))
      .mockImplementation(async () => Response.json(upstream));
    const service = new CardLookupService({ ...time, fetcher });
    const results = await Promise.allSettled([service.resolve('First'), service.details('Second')]);
    expect(results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ statusCode: 429, retryAfter: 45 }) },
      { status: 'rejected', reason: expect.objectContaining({ statusCode: 429, retryAfter: 45 }) },
    ]);
    time.advance(44_999);
    await expect(service.resolve('Third')).rejects.toMatchObject({ statusCode: 429, retryAfter: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    time.advance(1);
    expect(await service.resolve('Third')).toEqual({ card });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps failure messages harmless and lets later lookups recover', async () => {
    const time = clock();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockRejectedValueOnce(new DOMException('Upstream request timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('not json'))
      .mockResolvedValueOnce(
        Response.json({ ...upstream, image_uris: { art_crop: 'http://127.0.0.1/private' } }),
      )
      .mockResolvedValueOnce(new Response('x'.repeat(200_001)))
      .mockImplementation(async () => Response.json(upstream));
    const service = new CardLookupService({ ...time, fetcher });
    await expect(service.resolve('Ambiguous')).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('suggested full name'),
    });
    for (const name of ['Timeout', 'Bad JSON', 'Unsafe image', 'Oversized'])
      await expect(service.resolve(name)).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining('keep playing'),
      });
    expect(await service.resolve('Recovered')).toEqual({ card });
  });
});

describe('public card API', () => {
  it('serves rulings without a session and rejects unsafe or missing card IDs before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(rulingsUpstream));
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
      cards: new CardLookupService({ ...clock(), fetcher }),
    });
    try {
      for (const invalid of ['', '?id=Example', '?id=https://evil.example', `?id=${id}%2F..`])
        expect((await app.inject(`/api/cards/rulings${invalid}`)).statusCode).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      for (let i = 0; i < 26; i++) {
        const response = await app.inject(`/api/cards/rulings?id=${id}`);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(rulings);
        expect(response.cookies).toHaveLength(0);
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect((await app.inject(`/api/cards/rulings?id=${id}`)).statusCode).toBe(429);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('works without a guest session, limits query sizes and permits only Scryfall images in CSP', async () => {
    const time = clock();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      Response.json(String(url).includes('/autocomplete') ? { data: ['Example Commander'] } : upstream),
    );
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example', NODE_ENV: 'production' }),
      cards: new CardLookupService({ ...time, fetcher }),
    });
    try {
      const suggestions = await app.inject('/api/cards/suggest?q=Ex');
      expect(suggestions.statusCode).toBe(200);
      expect(suggestions.json()).toEqual({ names: ['Example Commander'] });
      expect(suggestions.cookies).toHaveLength(0);
      expect(suggestions.headers['cache-control']).toBe('no-store');
      const resolved = await app.inject('/api/cards/resolve?q=Example%20Commander');
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json()).toEqual({ card });
      const viewed = await app.inject('/api/cards/details?q=Example%20Commander');
      expect(viewed.statusCode).toBe(200);
      expect(viewed.json()).toEqual({ details });
      expect(viewed.cookies).toHaveLength(0);
      expect(viewed.headers['cache-control']).toBe('no-store');
      expect(resolved.headers['content-security-policy']).toContain(
        "img-src 'self' data: blob: https://cards.scryfall.io;",
      );
      expect(resolved.headers['content-security-policy']).toContain(
        "connect-src 'self' https://cards.scryfall.io;",
      );
      expect((await app.inject(`/api/cards/resolve?q=${'a'.repeat(513)}`)).statusCode).toBe(400);
      expect((await app.inject('/api/cards/resolve?q=http://127.0.0.1/private')).statusCode).toBe(400);
      expect((await app.inject(`/api/cards/details?q=${'a'.repeat(513)}`)).statusCode).toBe(400);
      expect((await app.inject('/api/cards/details?q=http://127.0.0.1/private')).statusCode).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it.each(['resolve', 'details'])(
    'returns a clear cooldown and Retry-After header for %s on upstream rate limiting',
    async (endpoint) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Rate limited', { status: 429 }));
      const { app } = await buildApp({
        filename: ':memory:',
        config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
        cards: new CardLookupService({ fetcher }),
      });
      try {
        const response = await app.inject(`/api/cards/${endpoint}?q=Example`);
        expect(response.statusCode).toBe(429);
        expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(30);
        expect(response.json().error).toMatch(/keep the commander name/);
      } finally {
        await app.close();
      }
    },
  );

  it('returns a useful not-found error for an unknown commander without creating a session', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('not found', { status: 404 }));
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
      cards: new CardLookupService({ fetcher }),
    });
    try {
      const response = await app.inject('/api/cards/details?q=Unknown');
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('No unique card matched');
      expect(response.cookies).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('limits card details requests even when all lookups hit the cache', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(upstream));
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
      cards: new CardLookupService({ fetcher }),
    });
    try {
      for (let i = 0; i < 30; i++)
        expect((await app.inject('/api/cards/details?q=Example')).statusCode).toBe(200);
      const limited = await app.inject('/api/cards/details?q=Example');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toContain('Too many requests');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('shares one client budget across every card route', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).includes('/autocomplete')
          ? { data: ['Example Commander'] }
          : String(url).includes('/rulings')
            ? rulingsUpstream
            : upstream,
      ),
    );
    const { app } = await buildApp({
      filename: ':memory:',
      config: readConfig({ PUBLIC_ORIGIN: 'https://table.example' }),
      cards: new CardLookupService({ ...clock(), fetcher }),
    });
    try {
      for (const path of ['details?q=Example', 'resolve?q=Example', `rulings?id=${id}`])
        for (let i = 0; i < 30; i++) expect((await app.inject(`/api/cards/${path}`)).statusCode).toBe(200);
      for (let i = 0; i < 10; i++) expect((await app.inject('/api/cards/suggest?q=Ex')).statusCode).toBe(200);
      // Suggestions have used 10 of their own 90, but the shared 100 is spent.
      const limited = await app.inject('/api/cards/suggest?q=Ex');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toContain('Too many requests');
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
    }
  });
});
