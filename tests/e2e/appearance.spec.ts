import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Game, RoomView } from '../../src/shared/schema.js';
import type { Profile } from '../../src/client/storage/repository.js';
import type { CommanderCard } from '../../src/shared/cards.js';
import { accentColors, colorThemes, tableFinishes } from '../../src/client/features/appearancePresets.js';

type Theme = 'light' | 'dark';
type Preference = Theme | 'system';

async function savedRecord<T>(page: Page, key: string): Promise<T> {
  return page.evaluate(async (recordKey) => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = db.transaction('records').objectStore('records').get(recordKey);
      return await new Promise<T>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, key);
}

async function savedGame(page: Page) {
  return (await savedRecord<{ game: Game }>(page, 'active')).game;
}

async function openSettings(page: Page) {
  if (await page.locator('.board').count()) {
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Display & preferences', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Display & browser settings', exact: true }).click();
  }
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close Your table, your way', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function chooseTheme(page: Page, preference: Preference) {
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(preference);
  await expect
    .poll(async () => (await savedRecord<Profile & { theme?: Preference }>(page, 'profile')).theme)
    .toBe(preference);
}

async function chooseStyle(page: Page, colorTheme: string, accentColor = 'Gold', finish = 'glow') {
  await page.getByRole('radio', { name: colorTheme, exact: true }).check();
  await page.getByRole('radio', { name: accentColor, exact: true }).check();
  await page.getByRole('combobox', { name: 'Table background', exact: true }).selectOption(finish);
  await expect
    .poll(() => savedRecord<Profile>(page, 'profile'))
    .toMatchObject({
      colorTheme: colorThemes.find((option) => option.name === colorTheme)!.id,
      accentColor: accentColors.find((option) => option.name === accentColor)!.id,
      tableFinish: finish,
    });
}

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#[a-f\d]{6}$/i);
  const color = (await page.locator('meta[name="theme-color"]').getAttribute('content'))!;
  const brightness =
    [1, 3, 5].reduce((sum, start) => sum + parseInt(color.slice(start, start + 2), 16), 0) / 3;
  expect(theme === 'light' ? brightness > 127 : brightness < 127).toBe(true);
  return color;
}

for (const initial of ['light', 'dark'] as const) {
  test(`a fresh ${initial} device uses its system appearance and reacts to live changes`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: initial });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Gather/ })).toBeVisible();
    const initialColor = await expectTheme(page, initial);
    await openSettings(page);
    const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
    await expect(appearance).toHaveValue('system');
    await expect(appearance.locator('option')).toHaveText(['Use device setting', 'Light', 'Dark']);
    const other = initial === 'light' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: other });
    expect(await expectTheme(page, other)).not.toBe(initialColor);
    await expect(appearance).toHaveValue('system');
    await page.emulateMedia({ colorScheme: initial });
    expect(await expectTheme(page, initial)).toBe(initialColor);
    await page.reload();
    await expectTheme(page, initial);
    await openSettings(page);
    await expect(appearance).toHaveValue('system');
  });
}

test('explicit appearance persists through reload, ignores device changes and leaves the local game intact', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: 'Increase poison', exact: true }).click();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const game = await savedGame(page);
  const identity = (await savedRecord<Profile>(page, 'profile')).installationId;
  await openSettings(page);
  await chooseTheme(page, 'light');
  await expectTheme(page, 'light');
  for (const device of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: device });
    await expectTheme(page, 'light');
  }
  await page.reload();
  await expectTheme(page, 'light');
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await openSettings(page);
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('light');
  await chooseTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  await page.reload();
  await expectTheme(page, 'dark');
  await openSettings(page);
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('dark');
  await chooseTheme(page, 'system');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await closeSettings(page);
  expect(await savedGame(page)).toEqual(game);
  expect((await savedRecord<Profile>(page, 'profile')).installationId).toBe(identity);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.player-tile').first().locator('[data-status="poison"]')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('39');
});

test('an older saved profile defaults to system without replacing identity, preferences or games', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await page.getByRole('button', { name: 'Quick 2 · 20 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const game = await savedGame(page);
  const archive = await savedRecord<Game[]>(page, 'archive');
  expect(archive).toHaveLength(1);
  await page.evaluate(async () => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction('records', 'readwrite');
      const records = transaction.objectStore('records');
      const read = records.get('profile');
      read.onsuccess = () => {
        const profile = read.result as Record<string, unknown>;
        delete profile.theme;
        delete profile.colorTheme;
        delete profile.accentColor;
        delete profile.tableFinish;
        profile.displayName = 'Mira remembered';
        profile.effects = 'reduced';
        records.put(profile, 'profile');
      };
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
  const previous = await savedRecord<Profile>(page, 'profile');
  await page.reload();
  await expectTheme(page, 'light');
  await expect(page.getByTestId('life-0')).toHaveText('19');
  await openSettings(page);
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('system');
  await expect(page.getByRole('combobox', { name: 'Effects', exact: true })).toHaveValue('reduced');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await chooseTheme(page, 'light');
  expect(await savedRecord<Profile>(page, 'profile')).toEqual({
    ...previous,
    theme: 'light',
    colorTheme: 'classic',
    accentColor: 'theme',
    tableFinish: 'glow',
  });
  expect(await savedGame(page)).toEqual(game);
  expect(await savedRecord<Game[]>(page, 'archive')).toEqual(archive);
  await closeSettings(page);
  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Your display name/ })).toHaveValue('Mira remembered');
});

test('host and guest appearance stays independent across their shared room and saved local game', async ({
  page: host,
  browser,
}) => {
  await host.emulateMedia({ colorScheme: 'light' });
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
  });
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await openSettings(host);
    await chooseTheme(host, 'dark');
    await chooseStyle(host, 'Forest', 'Copper', 'tabletop');
    await closeSettings(host);
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = host.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await created).json()) as RoomView;
    await expect(host.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
    await guest.goto(new URL('/', room.joinUrl!).href);
    await expectTheme(guest, 'light');
    await openSettings(guest);
    await expect(guest.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('system');
    await chooseTheme(guest, 'light');
    await chooseStyle(guest, 'Ocean', 'Rose', 'plain');
    await closeSettings(guest);
    await guest.getByRole('button', { name: 'Quick 2 · 20 life', exact: true }).click();
    await guest.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
    await expect(guest.getByText('Saved here', { exact: true })).toBeVisible();
    const localGame = await savedGame(guest);
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    const before = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    await expectTheme(host, 'dark');
    await expectTheme(guest, 'light');
    await openSettings(guest);
    await chooseTheme(guest, 'dark');
    await expectTheme(guest, 'dark');
    await expect(guest.locator('html')).toHaveAttribute('data-color-theme', 'ocean');
    await expect(guest.locator('html')).toHaveAttribute('data-accent-color', 'rose');
    await expect(host.locator('html')).toHaveAttribute('data-color-theme', 'forest');
    await expect(host.locator('html')).toHaveAttribute('data-accent-color', 'copper');
    await closeSettings(guest);
    await openSettings(host);
    await chooseTheme(host, 'light');
    await expectTheme(host, 'light');
    await expectTheme(guest, 'dark');
    await closeSettings(host);
    await guest.reload();
    await expectTheme(guest, 'dark');
    await expect(guest.getByTestId('life-0')).toHaveText('40');
    const after = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(after.game).toEqual(before.game);
    expect(await savedGame(guest)).toEqual(localGame);
    await guest.getByRole('button', { name: 'Home & recent games', exact: true }).click();
    await guest.getByRole('button', { name: /^Resume one-phone game:/ }).click();
    await expect(guest.getByTestId('life-0')).toHaveText('19');
    await expectTheme(guest, 'dark');
    await expectTheme(host, 'light');
  } finally {
    await guestContext.close();
  }
});

test.describe('appearance before the app loads', () => {
  // A controlled module request proves the independent pre-paint bootstrap;
  // service-worker caching must not satisfy that request behind the mock.
  test.use({ serviceWorkers: 'block' });
  test('saved appearance paints before hydration and a bad or denied cache falls back safely', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await openSettings(page);
    await chooseTheme(page, 'dark');
    await chooseStyle(page, 'Arcane', 'Teal', 'gilded');
    await closeSettings(page);
    // Vite adds its own module in development; hold only the app entry so the
    // same pre-hydration assertion also works against the production bundle.
    const appEntry = page.locator('script[type="module"][src]:not([src$="/@vite/client"])');
    await expect(appEntry).toHaveCount(1);
    const entry = await appEntry.getAttribute('src');
    expect(entry).toBeTruthy();
    const entryUrl = new URL(entry!, page.url()).href;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const cache of ['saved', 'malformed', 'invalid', 'denied'] as const) {
      if (cache === 'malformed')
        await page.evaluate(() => localStorage.setItem('command-table-style', '{bad json'));
      if (cache === 'invalid')
        await page.evaluate(() => {
          localStorage.setItem('command-table-appearance', 'invalid-preference');
          localStorage.setItem(
            'command-table-style',
            JSON.stringify({ colorTheme: 'invalid', accentColor: '<style>', tableFinish: 'invalid' }),
          );
        });
      if (cache === 'denied')
        await page.addInitScript(() => {
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('Storage is unavailable', 'SecurityError');
            },
          });
        });
      let release!: () => void;
      const deferred = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested!: () => void;
      const requestStarted = new Promise<void>((resolve) => {
        requested = resolve;
      });
      await page.route(entryUrl, async (route) => {
        requested();
        await deferred;
        await route.continue();
      });
      try {
        await page.reload({ waitUntil: 'commit' });
        await requestStarted;
        await expectTheme(page, cache === 'saved' || cache === 'malformed' ? 'dark' : 'light');
        await expect(page.locator('html')).toHaveAttribute(
          'data-color-theme',
          cache === 'saved' ? 'arcane' : 'classic',
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-accent-color',
          cache === 'saved' ? 'teal' : 'theme',
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-table-finish',
          cache === 'saved' ? 'gilded' : 'glow',
        );
        await expect(page.locator('#root')).toBeEmpty();
        release();
        await expect(page.getByRole('heading', { name: /Gather/ })).toBeVisible();
        // IndexedDB remains authoritative when its optional paint cache fails.
        await expectTheme(page, 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'arcane');
        await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'teal');
        await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'gilded');
        await openSettings(page);
        await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('dark');
        await closeSettings(page);
      } finally {
        release();
        await page.unroute(entryUrl);
      }
    }
    expect(errors).toEqual([]);
  });
});

test('theme controls support keyboard selection, retain game data and reset only appearance', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const game = await savedGame(page);
  await openSettings(page);
  await page.getByRole('combobox', { name: 'Effects', exact: true }).selectOption('reduced');
  await chooseStyle(page, 'Arcane', 'Rose', 'tabletop');
  await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'arcane');
  await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'rose');
  await expect(page.locator('body')).toHaveCSS('background-image', /dragonfire\.svg/);
  await page.getByRole('radio', { name: 'Arcane', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Forest', exact: true })).toBeChecked();
  await expect.poll(async () => (await savedRecord<Profile>(page, 'profile')).colorTheme).toBe('forest');
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'forest');
  await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'rose');
  await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'tabletop');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
  await openSettings(page);
  await expect(page.getByRole('radio', { name: 'Forest', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Rose', exact: true })).toBeChecked();
  await page.getByRole('combobox', { name: 'Table background', exact: true }).selectOption('plain');
  await expect(page.locator('body')).not.toHaveCSS(
    'background-image',
    /repeating-linear-gradient|radial-gradient/,
  );
  await expect
    .poll(() =>
      page
        .locator('.player-tile')
        .first()
        .evaluate((tile) => getComputedStyle(tile).backgroundColor),
    )
    .not.toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Classic', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Gold', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Table background', exact: true })).toHaveValue('glow');
  await expect(page.getByRole('combobox', { name: 'Effects', exact: true })).toHaveValue('reduced');
  await closeSettings(page);
  expect(await savedGame(page)).toEqual(game);
});

for (const mode of ['light', 'dark'] as const) {
  test(`all table finishes in ${mode} paint every player, support keyboard selection and persist`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
    await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
    await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
    const game = await savedGame(page);
    await openSettings(page);
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(mode);
    await page.getByRole('combobox', { name: 'Effects', exact: true }).selectOption('reduced');
    const backgrounds = new Set<string>();
    for (const finish of tableFinishes) {
      await page.getByRole('radio', { name: finish.name, exact: true }).check();
      await expect(page.getByRole('combobox', { name: 'Table background', exact: true })).toHaveValue(
        finish.id,
      );
      await expect
        .poll(async () => (await savedRecord<Profile>(page, 'profile')).tableFinish)
        .toBe(finish.id);
      await expect(page.locator('html')).toHaveAttribute('data-table-finish', finish.id);
      expect(await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
        true,
      );
      await closeSettings(page);
      const paints = await page.locator('.player-tile').evaluateAll((tiles) =>
        tiles.map((tile) => {
          const style = getComputedStyle(tile);
          return `${style.backgroundColor} ${style.backgroundImage}`;
        }),
      );
      expect(paints).toHaveLength(4);
      expect(paints.every((paint) => paint !== 'rgba(0, 0, 0, 0) none')).toBe(true);
      backgrounds.add(paints[0]);
      await expect(page.getByTestId('life-0')).toHaveText('39');
      await audit(page);
      await openSettings(page);
    }
    expect(backgrounds.size).toBe(tableFinishes.length);
    await audit(page);
    await page.getByRole('radio', { name: 'Celestial atlas', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Verdant sanctuary', exact: true })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Table background', exact: true })).toHaveValue(
      'verdant',
    );
    await expect.poll(async () => (await savedRecord<Profile>(page, 'profile')).tableFinish).toBe('verdant');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'verdant');
    await expect(page.getByTestId('life-0')).toHaveText('39');
    await openSettings(page);
    await expect(page.getByRole('radio', { name: 'Verdant sanctuary', exact: true })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Effects', exact: true })).toHaveValue('reduced');
    expect(await savedGame(page)).toEqual(game);
  });

  for (const preset of colorThemes) {
    test(`${preset.name} in ${mode} has readable settings and player tiles`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto('/');
      await openSettings(page);
      await chooseStyle(page, preset.name, 'Gold', 'tabletop');
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', preset.id);
      await audit(page);
      expect(await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
        true,
      );
      await closeSettings(page);
      await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
      await audit(page);
      await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
      await expect(page.getByTestId('life-0')).toHaveText('39');
    });
  }
}

async function audit(page: Page) {
  await page.bringToFront();
  await expect(page.locator('html')).toHaveAttribute('data-hidden', 'false');
  for (const dialog of await page.getByRole('dialog').all()) await expect(dialog).toHaveCSS('opacity', '1');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await page.bringToFront();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      elements: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    })),
  ).toEqual([]);
}

test.describe('appearance contrast', () => {
  // The artwork fixture replaces remote images; production cache behavior has
  // separate coverage and must not bypass these deterministic route mocks.
  test.use({ serviceWorkers: 'block' });
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme} home, Settings and a board with artwork pass accessibility checks`, async ({
      page,
      context,
    }) => {
      const card: CommanderCard = {
        id: '12345678-1234-4234-8234-123456789abc',
        name: 'Tymna the Weaver',
        imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
        scryfallUrl: 'https://scryfall.com/card/test/1/tymna-the-weaver',
        artist: 'Fixture Artist',
      };
      const image = readFileSync(new URL('../../public/icon-192.png', import.meta.url));
      await context.route('https://cards.scryfall.io/**', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: image,
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
      );
      await context.route('**/api/cards/resolve?**', (route) => route.fulfill({ json: { card } }));
      await context.route('**/api/cards/suggest?**', (route) => route.fulfill({ json: { names: [] } }));
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Gather/ })).toBeVisible();
      await expectTheme(page, theme);
      await audit(page);
      await openSettings(page);
      await chooseTheme(page, theme);
      await audit(page);
      await closeSettings(page);
      await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
      await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
      await page.getByRole('button', { name: 'Increase poison', exact: true }).click();
      await page.getByText('Edit player & commanders', { exact: true }).click();
      const commander = page
        .locator('.commander-input')
        .filter({ has: page.getByLabel('Commander 1 name', { exact: true }) });
      await commander.getByLabel('Commander 1 name', { exact: true }).fill(card.scryfallUrl);
      await commander.getByRole('button', { name: 'Find artwork', exact: true }).click();
      await expect(commander.getByRole('img')).toHaveAttribute('src', card.imageUrl);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
      const backdrop = page.locator('.player-tile').first().locator('.commander-backdrop img');
      await expect
        .poll(() => backdrop.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await expect(page.locator('.player-tile').first().locator('[data-status="poison"]')).toBeVisible();
      await audit(page);
      await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
      await expect(page.getByTestId('life-0')).toHaveText('39');
    });
  }
});
