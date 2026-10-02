import { readFileSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CommanderCard } from '../../src/shared/cards.js';
import type { Game, RoomView } from '../../src/shared/schema.js';

const cards: CommanderCard[] = [
  {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Tymna the Weaver',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
    scryfallUrl: 'https://scryfall.com/card/test/1/tymna-the-weaver',
    artist: 'Fixture Artist One',
  },
  {
    id: '23456789-2345-4345-8345-23456789abcd',
    name: 'Nissa, Vastwood Seer // Nissa, Sage Animist',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/2/3/23456789-2345-4345-8345-23456789abcd.jpg',
    scryfallUrl: 'https://scryfall.com/card/test/2/nissa-vastwood-seer',
    artist: 'Fixture Artist Two',
  },
];
const details = [
  {
    id: cards[0].id,
    name: cards[0].name,
    scryfallUrl: cards[0].scryfallUrl,
    faces: [
      {
        name: cards[0].name,
        manaCost: '{1}{W}{B}',
        typeLine: 'Legendary Creature — Human Cleric',
        oracleText:
          'Lifelink\nAt the beginning of your postcombat main phase, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.\nPartner',
        imageUrl: cards[0].imageUrl.replace('/art_crop/', '/normal/'),
        artist: cards[0].artist,
        power: '2',
        toughness: '2',
      },
    ],
  },
  {
    id: cards[1].id,
    name: cards[1].name,
    scryfallUrl: cards[1].scryfallUrl,
    faces: [
      {
        name: 'Nissa, Vastwood Seer',
        manaCost: '{2}{G}',
        typeLine: 'Legendary Creature — Elf Scout',
        oracleText:
          'When Nissa, Vastwood Seer enters, you may search your library for a basic Forest card, reveal it, put it into your hand, then shuffle.',
        imageUrl: cards[1].imageUrl.replace('/art_crop/', '/normal/'),
        artist: cards[1].artist,
        power: '2',
        toughness: '2',
      },
      {
        name: 'Nissa, Sage Animist',
        manaCost: '',
        typeLine: 'Legendary Planeswalker — Nissa',
        oracleText:
          '+1: Reveal the top card of your library. If it’s a land card, put it onto the battlefield. Otherwise, put it into your hand.',
        imageUrl: cards[1].imageUrl.replace('/art_crop/front/', '/normal/back/'),
        artist: cards[1].artist,
        loyalty: '3',
      },
    ],
  },
];
const rulings = [
  {
    cardId: cards[0].id,
    rulings: [
      {
        source: 'wotc',
        publishedAt: '2016-11-08',
        comment: 'You choose whether to pay life as the ability resolves.',
      },
      {
        source: 'scryfall',
        publishedAt: '2024-02-29',
        comment: 'A note supplied by Scryfall, distinct from a Wizards ruling.',
      },
    ],
    hasMore: false,
  },
  { cardId: cards[1].id, rulings: [], hasMore: false },
];
// The existing app icon supplies deterministic decoded pixels without fetching
// copyrighted artwork or depending on the external card service during tests.
const fixtureImage = readFileSync(new URL('../../public/icon-192.png', import.meta.url));

async function mockCards(
  context: BrowserContext,
  options: {
    failFirstDetails?: boolean;
    failFullImages?: boolean;
    failFirstRulings?: boolean;
    wrongFirstRulings?: boolean;
    rulingQueries?: string[];
  } = {},
) {
  const queries: string[] = [];
  const rulingQueries = options.rulingQueries ?? [];
  await context.route('https://cards.scryfall.io/**', (route) =>
    options.failFullImages && !route.request().url().includes('/art_crop/')
      ? route.abort('failed')
      : route.fulfill({
          contentType: 'image/png',
          body: fixtureImage,
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
  );
  await context.route('**/api/cards/**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    if (url.pathname.endsWith('/suggest')) {
      await route.fulfill({ json: { names: [] } });
      return;
    }
    if (url.pathname.endsWith('/rulings')) {
      const id = url.searchParams.get('id') ?? '';
      rulingQueries.push(id);
      const index = cards.findIndex((card) => card.id === id);
      if (options.failFirstRulings && rulingQueries.length === 1) {
        await route.fulfill({ status: 503, json: { error: 'Upstream unavailable.' } });
      } else if (options.wrongFirstRulings && rulingQueries.length === 1) {
        await route.fulfill({ json: { ...rulings[0], cardId: cards[1].id } });
      } else {
        await route.fulfill(
          index >= 0 ? { json: rulings[index] } : { status: 404, json: { error: 'No rulings found.' } },
        );
      }
      return;
    }
    const index = cards.findIndex(
      (card) =>
        card.name === query ||
        card.scryfallUrl === query ||
        `https://scryfall.com/cards/${card.id}` === query,
    );
    if (url.pathname.endsWith('/details')) {
      queries.push(query);
      if (options.failFirstDetails && queries.length === 1) {
        await route.fulfill({ status: 503, json: { error: 'Card details are temporarily unavailable.' } });
      } else {
        await route.fulfill(
          index >= 0
            ? { json: { details: details[index] } }
            : { status: 404, json: { error: 'No card was found for this name.' } },
        );
      }
      return;
    }
    await route.fulfill(
      index >= 0
        ? { json: { card: cards[index] } }
        : { status: 404, json: { error: 'No artwork was found for this name.' } },
    );
  });
  return queries;
}

async function savedGame(page: Page): Promise<Game> {
  return page.evaluate(async () => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = db.transaction('records').objectStore('records').get('active');
      return await new Promise<Game>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result.game);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  });
}

async function setCommander(page: Page, player: string, card = cards[0], artwork = false) {
  await page.getByRole('button', { name: `${player} details`, exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  const editor = page.locator('.edit-player');
  await editor.getByRole('textbox', { name: 'Commander 1 name', exact: true }).fill(card.name);
  if (artwork) {
    await editor.getByRole('button', { name: 'Find artwork', exact: true }).click();
    await expect(editor.getByRole('img', { name: `${card.name} artwork`, exact: true })).toBeVisible();
  }
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('Changes saved.');
  await page.getByRole('button', { name: `Close ${player}`, exact: true }).click();
}

async function audit(page: Page) {
  await page.bringToFront();
  await expect(page.locator('html')).toHaveAttribute('data-hidden', 'false');
  for (const dialog of await page.getByRole('dialog').all()) await expect(dialog).toHaveCSS('opacity', '1');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await page.bringToFront();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      elements: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test('an approved guest can read another player’s commander without editing their seat or changing the room', async ({
  page: host,
  context,
  browser,
}) => {
  await mockCards(context);
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const rulingQueries: string[] = [];
  const queries = await mockCards(guestContext, { rulingQueries });
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = host.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await created).json()) as RoomView;
    await setCommander(host, 'Host', cards[0], true);
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('39');
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Pick your place.', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await expect(guest.getByRole('button', { name: "Decrease Host's life", exact: true })).toBeDisabled();
    const before = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    await guest.getByRole('button', { name: 'Host details', exact: true }).click();
    const view = guest.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true });
    await expect(view).toBeEnabled();
    await expect(view).toHaveAttribute('aria-expanded', 'false');
    await view.click();
    await expect(view).toHaveAttribute('aria-expanded', 'true');
    await expect(guest.getByRole('img', { name: `${cards[0].name} full card`, exact: true })).toBeVisible();
    await expect(guest.getByText(details[0].faces[0].oracleText, { exact: true })).toBeVisible();
    await expect(guest.getByText(details[0].faces[0].typeLine, { exact: true })).toBeVisible();
    expect(queries).toEqual([`https://scryfall.com/cards/${cards[0].id}`]);
    expect(rulingQueries).toEqual([]);
    const rulingToggle = guest.getByRole('button', { name: 'Rulings & notes', exact: false });
    await expect(rulingToggle).toHaveAttribute('aria-expanded', 'false');
    await rulingToggle.click();
    const rulingList = guest.getByRole('list', { name: 'Card rulings', exact: true });
    await expect(rulingList.getByText(rulings[0].rulings[0].comment, { exact: true })).toBeVisible();
    await expect(rulingList.getByText('Wizards of the Coast', { exact: true })).toBeVisible();
    await expect(rulingList.getByText('Scryfall note', { exact: true })).toBeVisible();
    await expect(rulingList.locator('time').first()).toHaveAttribute('datetime', '2016-11-08');
    expect(rulingQueries).toEqual([cards[0].id]);
    await guest.getByText('Edit player & commanders', { exact: true }).click();
    await expect(guest.getByRole('textbox', { name: 'Player name', exact: true })).toBeDisabled();
    await expect(guest.getByRole('textbox', { name: 'Commander 1 name', exact: true })).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Close Host', exact: true }).click();
    await expect(guest.getByTestId('life-0')).toHaveText('39');
    const after = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(after.game).toEqual(before.game);
  } finally {
    await guestContext.close();
  }
});

test('partners and both faces are readable with keyboard access and no overflow on a narrow phone', async ({
  page,
  context,
}) => {
  const rulingQueries: string[] = [];
  const queries = await mockCards(context, { rulingQueries });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await page.getByText('Names, colors & commanders', { exact: false }).click();
  const seat = page.locator('.seat-form').first();
  await seat.getByRole('combobox', { name: 'Commanders', exact: true }).selectOption('2');
  await seat.getByRole('textbox', { name: 'Commander 1', exact: true }).fill(cards[0].name);
  await seat.getByRole('textbox', { name: 'Commander 2', exact: true }).fill(cards[1].name);
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('40');
  const before = await savedGame(page);
  const profile = page.getByRole('button', { name: 'Player 1 details', exact: true });
  await profile.focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(details[0].faces[0].oracleText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rulings & notes', exact: false }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `View commander: ${cards[1].name}`, exact: true }).click();
  await expect(page.getByRole('img', { name: 'Nissa, Vastwood Seer full card', exact: true })).toBeVisible();
  await expect(page.getByText(details[1].faces[0].typeLine, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show card face: Nissa, Sage Animist', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Nissa, Sage Animist full card', exact: true })).toBeVisible();
  await expect(page.getByText(details[1].faces[1].oracleText, { exact: true })).toBeVisible();
  await expect(page.getByText(details[1].faces[1].typeLine, { exact: true })).toBeVisible();
  await expect(page.getByText(/Loyalty.*3/)).toBeVisible();
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rulings & notes', exact: false }).click();
  await expect(
    page.getByText('No card-specific rulings are listed on Scryfall.', { exact: true }),
  ).toBeVisible();
  expect(rulingQueries).toEqual(cards.map((card) => card.id));
  expect(queries).toEqual(cards.map((card) => card.name));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const image = await page
    .getByRole('img', { name: 'Nissa, Sage Animist full card', exact: true })
    .boundingBox();
  expect(image).not.toBeNull();
  expect(image!.x).toBeGreaterThanOrEqual(0);
  expect(image!.x + image!.width).toBeLessThanOrEqual(320);
  await audit(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(profile).toBeFocused();
  expect(await savedGame(page)).toEqual(before);
});

test('a name-only commander can retry a failed lookup and read rules when the full image fails', async ({
  page,
  context,
}) => {
  const queries = await mockCards(context, { failFirstDetails: true, failFullImages: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await setCommander(page, 'Player 1');
  const before = await savedGame(page);
  expect(
    Object.values(before.commanders).find((commander) => commander.ownerId === before.order[0])?.card,
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true }).click();
  await expect(page.getByText('Card details are temporarily unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(details[0].faces[0].oracleText, { exact: true })).toBeVisible();
  await expect(page.getByText(details[0].faces[0].typeLine, { exact: true })).toBeVisible();
  await expect(
    page.getByText('Card image unavailable. Read the card text below.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: `${cards[0].name} full card`, exact: true })).toHaveCount(0);
  expect(queries).toEqual([cards[0].name, cards[0].name]);
  expect(await savedGame(page)).toEqual(before);
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  expect(errors).toEqual([]);
});

test('an unnamed commander gives a setup hint without making a card lookup', async ({ page, context }) => {
  const queries = await mockCards(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commander cards', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View commander: Commander 1', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Choose a commander name or artwork in player settings to read its card.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(queries).toEqual([]);
});

test('rulings retry independently of card text and remain readable when reopened offline', async ({
  page,
  context,
}) => {
  const rulingQueries: string[] = [];
  await mockCards(context, { failFirstRulings: true, rulingQueries });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await setCommander(page, 'Player 1');
  const before = await savedGame(page);
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Rulings & notes', exact: false }).click();
  await expect(
    page.getByText('Rulings are temporarily unavailable. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(details[0].faces[0].oracleText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry rulings', exact: true }).click();
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toBeVisible();
  expect(rulingQueries).toEqual([cards[0].id, cards[0].id]);
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await context.setOffline(true);
  // Fail every new request too: routed fixture requests can bypass browser offline simulation.
  await context.route('**/api/cards/**', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true }).click();
  await expect(page.getByText(details[0].faces[0].oracleText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rulings & notes', exact: false }).click();
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toBeVisible();
  expect(rulingQueries).toEqual([cards[0].id, cards[0].id]);
  expect(await savedGame(page)).toEqual(before);
});

test('a rulings response for a different card is rejected and can be retried', async ({ page, context }) => {
  await mockCards(context, { wrongFirstRulings: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await setCommander(page, 'Player 1');
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: `View commander: ${cards[0].name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Rulings & notes', exact: false }).click();
  await expect(
    page.getByText('Rulings could not be loaded. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry rulings', exact: true }).click();
  await expect(page.getByText(rulings[0].rulings[0].comment, { exact: true })).toBeVisible();
});
