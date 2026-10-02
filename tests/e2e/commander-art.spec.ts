import { readFileSync } from 'node:fs';
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CommanderCard } from '../../src/shared/cards.js';
import type { RoomView } from '../../src/shared/schema.js';

// These fixtures intentionally replace Scryfall images. A production service
// worker can bypass browser route mocks after reload and fetch the fake IDs.
// Offline shell/cache behavior has separate production PWA coverage.
test.use({ serviceWorkers: 'block' });

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
    name: 'Thrasios, Triton Hero',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/2/3/23456789-2345-4345-8345-23456789abcd.jpg',
    scryfallUrl: 'https://scryfall.com/card/test/2/thrasios-triton-hero',
    artist: 'Fixture Artist Two',
  },
];
// Reuse the project's original icon as the test image: no external artwork or
// network connection is needed to verify decoding, backgrounds, and contrast.
const fixtureImage = readFileSync(new URL('../../public/icon-192.png', import.meta.url));

async function mockCards(context: BrowserContext, failImage?: () => boolean) {
  await context.route('https://cards.scryfall.io/**', (route) =>
    failImage?.()
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
      await route.fulfill({
        json: {
          names: cards
            .filter((card) => card.name.toLowerCase().includes(query.toLowerCase()))
            .map((card) => card.name),
        },
      });
      return;
    }
    const card = cards.find((entry) => entry.name === query || entry.scryfallUrl === query);
    await route.fulfill(
      card ? { json: { card } } : { status: 503, json: { error: 'Artwork service is unavailable.' } },
    );
  });
}

function commanderInput(page: Page, label: string, scope: Page | Locator = page) {
  return scope
    .locator('.commander-input')
    .filter({ has: page.getByRole('textbox', { name: label, exact: true }) });
}

async function chooseArtwork(
  page: Page,
  label: string,
  card: CommanderCard,
  scope: Page | Locator = page,
  link = false,
) {
  const input = commanderInput(page, label, scope);
  await input.getByLabel(label, { exact: true }).fill(link ? card.scryfallUrl : card.name.split(',')[0]);
  if (link) await input.getByRole('button', { name: 'Find artwork', exact: true }).click();
  else await input.getByRole('button', { name: card.name, exact: true }).click();
  await expect(input.getByLabel(label, { exact: true })).toHaveValue(card.name);
  await expect(input.getByRole('img', { name: `${card.name} artwork`, exact: true })).toHaveAttribute(
    'src',
    card.imageUrl,
  );
}

async function openPlayerEditor(page: Page, name = 'Player 1') {
  await page.getByRole('button', { name: `${name} details`, exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
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

test('tapping a commander suggestion selects it while the text field has focus', async ({
  page,
  context,
}) => {
  await mockCards(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).tap();
  await openPlayerEditor(page);
  const input = commanderInput(page, 'Commander 1 name');
  const field = input.getByLabel('Commander 1 name', { exact: true });
  await field.fill('Tymna');
  await expect(field).toBeFocused();
  // Some phone browsers blur the text input without focusing a tapped button.
  // Model that default focus behavior; preventing mousedown must keep the
  // suggestion mounted until its click is delivered.
  await page.evaluate(() => {
    document.addEventListener('mousedown', (event) => {
      if (
        !event.defaultPrevented &&
        event.target instanceof Element &&
        event.target.closest('.commander-suggestions button')
      )
        (document.activeElement as HTMLElement | null)?.blur();
    });
  });
  await input.getByRole('button', { name: cards[0].name, exact: true }).tap();
  await expect(field).toHaveValue(cards[0].name);
  await expect(input.locator('.commander-art-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
});

test('a suggested commander remains selected when artwork lookup fails', async ({ page, context }) => {
  await mockCards(context);
  await context.route('**/api/cards/resolve?**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Artwork service is unavailable.' } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await openPlayerEditor(page);
  const input = commanderInput(page, 'Commander 1 name');
  await input.getByLabel('Commander 1 name', { exact: true }).fill('Tymna');
  await input.getByRole('button', { name: cards[0].name, exact: true }).tap();
  await expect(input.getByLabel('Commander 1 name', { exact: true })).toHaveValue(cards[0].name);
  await expect(input.getByRole('status')).toContainText('play without artwork');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.reload();
  await openPlayerEditor(page);
  await expect(input.getByLabel('Commander 1 name', { exact: true })).toHaveValue(cards[0].name);
});

test('commander artwork saves and reloads without changing life, and can be removed accessibly', async ({
  page,
  context,
}) => {
  let failNextImage = false;
  await mockCards(context, () => {
    const fail = failNextImage;
    failNextImage = false;
    return fail;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await openPlayerEditor(page);
  await chooseArtwork(page, 'Commander 1 name', cards[0]);
  await page.getByLabel('Player name', { exact: true }).fill('Rowan');
  await page.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('teal');
  await expect(page.locator('.edit-player form')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.commander-credits')).toContainText(cards[0].artist);
  await audit(page);
  await page.getByRole('button', { name: 'Close Rowan', exact: true }).click();
  const image = page.locator('.player-tile').first().locator('.commander-backdrop img');
  await expect(image).toHaveAttribute('src', cards[0].imageUrl);
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await audit(page);
  failNextImage = true;
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.locator('.player-tile').first().locator('.commander-art-pane')).toHaveCount(1);
  await expect(image).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(image).toHaveAttribute('src', cards[0].imageUrl);
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await openPlayerEditor(page, 'Rowan');
  await expect(page.getByRole('combobox', { name: 'Player color', exact: true })).toHaveValue('teal');
  await page.getByLabel('Commander 1 name', { exact: true }).fill('My custom commander');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.commander-credits')).toHaveCount(0);
  await chooseArtwork(page, 'Commander 1 name', cards[0]);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.commander-credits')).toContainText(cards[0].artist);
  await page.getByRole('button', { name: 'Remove artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.commander-credits')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Rowan', exact: true }).click();
  await expect(image).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('39');
});

test('setup accepts card links and partner artwork while shared-table counters remain reachable', async ({
  page,
  context,
}) => {
  await mockCards(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await page.getByText('Names, colors & commanders', { exact: false }).click();
  const seat = page.locator('.seat-form').first();
  await seat.getByRole('combobox', { name: 'Commanders', exact: true }).selectOption('2');
  await chooseArtwork(page, 'Commander 1', cards[0], seat, true);
  await chooseArtwork(page, 'Commander 2', cards[1], seat);
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  const tile = page.locator('.player-tile').first();
  const images = tile.locator('.commander-backdrop img');
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toHaveAttribute('src', cards[0].imageUrl);
  await expect(images.nth(1)).toHaveAttribute('src', cards[1].imageUrl);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Table layout', exact: true }).click();
  await page.getByRole('button', { name: /Shared table Lay it sideways/ }).click();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(tile.locator('.tile-content')).toHaveAttribute('data-facing', 'across');
  await expect(tile.locator('.tile-content')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await expect(images).toHaveCount(2);
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).tap();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByTestId('life-1')).toHaveText('40');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await expect(images).toHaveCount(2);
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  await expect(page.getByTestId('life-0')).toHaveText('39');
});

test('joining players choose artwork before approval and share it with the host after reconnecting', async ({
  page: host,
  context,
  browser,
}) => {
  await mockCards(context);
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  await mockCards(guestContext);
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = host.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await created).json()) as RoomView;
    await expect(host.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('39');
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Pick your place.', exact: true })).toBeVisible();
    await chooseArtwork(guest, 'Commander 1 name', cards[0]);
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await expect(guest.getByRole('button', { name: 'Requested', exact: true })).toBeDisabled();
    await expect(guest.locator('.board')).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole('img', { name: `${cards[0].name} artwork`, exact: true })).toHaveAttribute(
      'src',
      cards[0].imageUrl,
    );
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    for (const page of [host, guest]) {
      await expect(page.locator('.player-tile').nth(1).locator('.commander-backdrop img')).toHaveAttribute(
        'src',
        cards[0].imageUrl,
      );
      await expect(page.getByTestId('life-0')).toHaveText('39');
    }
    const current = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    const original = Object.values(room.game!.commanders).find(
      (commander) => commander.ownerId === room.seats[1].id,
    )!;
    expect(current.game!.commanders[original.id].card).toEqual(cards[0]);
    await guest.reload();
    await expect(guest.locator('.player-tile').nth(1).locator('.commander-backdrop img')).toHaveAttribute(
      'src',
      cards[0].imageUrl,
    );
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: "Decrease Rowan's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('39');
    await expect(host.getByTestId('life-0')).toHaveText('39');
    await openPlayerEditor(guest, 'Host');
    await expect(
      commanderInput(guest, 'Commander 1 name').getByRole('button', { name: 'Find artwork', exact: true }),
    ).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  } finally {
    await guestContext.close();
  }
});

test('failed and stale artwork lookups keep manual commander names and playable counters', async ({
  page,
  context,
}) => {
  await mockCards(context);
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const responseFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await context.route('**/api/cards/resolve?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'Slow commander') {
      await route.fallback();
      return;
    }
    requested();
    await released;
    try {
      await route.fulfill({ json: { card: cards[0] } });
    } catch {
      // Editing is expected to cancel the request before this late response.
    } finally {
      finished();
    }
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
    await openPlayerEditor(page);
    const input = commanderInput(page, 'Commander 1 name');
    await input.getByLabel('Commander 1 name', { exact: true }).fill('Unavailable commander');
    await input.getByRole('button', { name: 'Find artwork', exact: true }).click();
    await expect(input.getByRole('status')).toContainText('play without artwork');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unavailable commander', exact: true })).toBeVisible();
    await input.getByLabel('Commander 1 name', { exact: true }).fill('Slow commander');
    await input.getByRole('button', { name: 'Find artwork', exact: true }).click();
    await requestStarted;
    await input.getByLabel('Commander 1 name', { exact: true }).fill('My custom commander');
    release();
    await responseFinished;
    await expect(input.getByLabel('Commander 1 name', { exact: true })).toHaveValue('My custom commander');
    await expect(input.locator('.commander-art-preview')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
    await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
    await expect(page.getByTestId('life-0')).toHaveText('39');
    await page.reload();
    await openPlayerEditor(page);
    await expect(input.getByLabel('Commander 1 name', { exact: true })).toHaveValue('My custom commander');
    await expect(page.locator('.commander-credits')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
