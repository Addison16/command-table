import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const closeUtilities = (page: Page) =>
  page.getByRole('button', { name: 'Close A little luck & magic', exact: true }).click();

test('Two-Headed Giant teammates share one life total and win together', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Two-Headed Giant · 2 vs 2', exact: true }).click();
  await expect(page.locator('.player-tile')).toHaveCount(4);
  await expect(page.locator('.team-mark')).toHaveText(['TEAM A', 'TEAM A', 'TEAM B', 'TEAM B']);
  for (const index of [0, 1, 2, 3]) await expect(page.getByTestId(`life-${index}`)).toHaveText('30');
  await page.getByRole('button', { name: "Decrease Player 2's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('29');
  await expect(page.getByTestId('life-1')).toHaveText('29');
  await expect(page.getByTestId('life-2')).toHaveText('30');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('30');
  await page.getByRole('button', { name: 'Player 3 details', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminate player', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  const winner = page.getByTestId('winner-screen');
  await expect(winner).toContainText('LAST TEAM STANDING');
  await expect(winner).toContainText('Player 1 & Player 2 win');
});

test('optional trackers, table markers and a random opponent stay off until chosen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Table markers' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Manual counters' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByText('Optional trackers', { exact: false }).click();
  await page.getByRole('group', { name: 'Player counters' }).getByRole('button', { name: 'Energy' }).click();
  await page.getByRole('checkbox', { name: 'Monarch', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Day and night', exact: true }).click();
  await page.getByRole('button', { name: '☾ Night', exact: true }).click();
  await closeUtilities(page);
  await expect(page.locator('.table-chips')).toContainText('NIGHT');
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: '♛ Become the monarch', exact: true }).click();
  await page.getByRole('button', { name: 'Increase Energy', exact: true }).click();
  await page.getByRole('button', { name: 'Increase Energy', exact: true }).click();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  const seat = page.locator('.player-tile').first();
  await expect(seat.getByLabel('Monarch')).toBeVisible();
  await expect(seat.locator('[data-status="counter"]')).toContainText('2');
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('combobox', { name: 'Roll for', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Choose a random opponent', exact: true }).click();
  const result = page.getByTestId('dice-result');
  await expect(result).toHaveAttribute('data-revealed', 'true');
  await expect(result).toContainText('RANDOM OPPONENT');
  await expect(page.locator('.winner-name')).toHaveText(/^Player [234]$/);
  await expect(page.getByRole('button', { name: /Confirm/ })).toHaveCount(0);
});

test('Planechase shares a plane and planar die, and the board shows where the table is', async ({ page }) => {
  await page.route('https://cards.scryfall.io/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Planechase', exact: true }).click();
  await page.getByTestId('shuffle-planes').click();
  const plane = page.getByTestId('current-plane');
  await expect(plane).toBeVisible();
  await expect(plane.locator('p')).not.toHaveText('Loading the card text…');
  const first = await plane.getByRole('heading').innerText();
  await page.getByRole('button', { name: 'Roll the planar die', exact: true }).click();
  await expect(page.getByTestId('planar-die-result')).toHaveText(/^(Blank|Chaos|Planeswalk)$/);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Planeswalk', exact: true }).click();
  await expect(plane.getByRole('heading')).not.toHaveText(first);
  const second = await plane.getByRole('heading').innerText();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(page.getByTestId('plane-chip')).toContainText(second.toUpperCase());
  await page.reload();
  await expect(page.getByTestId('plane-chip')).toContainText(second.toUpperCase());
  await page.getByTestId('plane-chip').click();
  await expect(page.getByTestId('current-plane').getByRole('heading')).toHaveText(second);
});

test('a recorded winner is counted in playgroup stats and can be corrected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Record winner', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Player 3', exact: true }).check();
  await page.getByRole('button', { name: 'Record winner', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'End game', exact: true }).click();
  await page.getByRole('button', { name: 'End game', exact: true }).last().click();
  await page.getByRole('button', { name: 'Playgroup stats', exact: true }).click();
  const stats = page.getByRole('dialog', { name: 'Playgroup stats' });
  await expect(stats.getByTestId('stats-games')).toHaveText('1');
  const row = stats.getByRole('row', { name: /Player 3/ });
  await expect(row).toContainText('100%');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await stats.getByText('Recorded games', { exact: false }).click();
  await stats.getByRole('combobox').selectOption({ label: 'Player 1 won' });
  await expect(stats.getByRole('row', { name: /Player 1/ })).toContainText('100%');
  await expect(stats.getByRole('row', { name: /Player 3/ })).toContainText('0%');
  await page.reload();
  await page.getByRole('button', { name: 'Playgroup stats', exact: true }).click();
  await expect(page.getByTestId('stats-games')).toHaveText('1');
});

test('keyboard shortcuts work on the bare board and never while typing', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-phone', 'One engine is enough for key handling.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await page.keyboard.press('u');
  await expect(page.getByTestId('life-0')).toHaveText('40');
  await page.keyboard.press('d');
  await expect(page.getByRole('dialog', { name: 'A little luck & magic' })).toBeVisible();
  // Keys typed inside a sheet belong to that sheet.
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: 'Around the table' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('2');
  await expect(page.getByRole('dialog', { name: 'Player 2' })).toBeVisible();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Human');
  await expect(page.getByLabel('Player name', { exact: true })).toHaveValue('Human');
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: 'Around the table' })).toBeVisible();
});

test('any card can be read from Utilities', async ({ page }) => {
  const id = '12345678-1234-4234-8234-123456789abc';
  await page.route('**/api/cards/suggest?*', (route) =>
    route.fulfill({ json: { names: ['Rhystic Study', 'Rhystic Tutor'] } }),
  );
  await page.route('**/api/cards/details?*', (route) =>
    route.fulfill({
      json: {
        details: {
          id,
          name: 'Rhystic Study',
          scryfallUrl: 'https://scryfall.com/card/test/1/rhystic-study',
          faces: [
            {
              name: 'Rhystic Study',
              manaCost: '{2}{U}',
              typeLine: 'Enchantment',
              oracleText:
                'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
            },
          ],
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Look up any card', exact: true }).click();
  await page.getByLabel('Card name', { exact: true }).fill('rhys');
  await page.getByRole('button', { name: 'Rhystic Study', exact: true }).click();
  const reading = page.getByRole('region', { name: 'Card details' });
  await expect(reading.getByRole('heading', { name: 'Rhystic Study' })).toBeVisible();
  await expect(reading).toContainText('you may draw a card unless that player pays {1}');
});

test('a spectator link shows the live table read-only until the host closes it', async ({
  page: host,
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const watcher = await context.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('checkbox', { name: 'Allow spectators', exact: true }).click();
    const link = host.getByLabel('Spectator link', { exact: true });
    await expect(link).toHaveValue(/watch=1/);
    const url = await link.inputValue();
    expect(url).not.toBe(await host.getByLabel('Join link', { exact: true }).inputValue());
    await expect(host.getByAltText('QR code to watch this room')).toBeVisible();
    await watcher.goto(url);
    await expect(watcher.getByRole('dialog', { name: 'Watch the table' })).toBeVisible();
    await watcher.getByRole('dialog').getByRole('button', { name: 'Watch room', exact: true }).click();
    await expect(watcher.getByTestId('life-0')).toHaveText('40');
    await expect(watcher.getByText('WATCHING · READ ONLY', { exact: true })).toBeVisible();
    for (const control of ["Decrease Host's life", "Increase Player 2's life", 'Undo'])
      await expect(watcher.getByRole('button', { name: control, exact: true })).toBeDisabled();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(watcher.getByTestId('life-0')).toHaveText('39');
    await watcher.getByRole('button', { name: 'Utilities', exact: true }).click();
    await expect(watcher.getByRole('button', { name: /^Roll 1d20/ })).toBeDisabled();
    await watcher.getByRole('button', { name: 'Close A little luck & magic', exact: true }).click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await expect(host.getByText('1 spectator has joined.', { exact: false })).toBeVisible();
    await host.getByRole('checkbox', { name: 'Allow spectators', exact: true }).click();
    await expect(host.getByLabel('Spectator link', { exact: true })).toHaveCount(0);
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('38');
    await expect(watcher.getByTestId('life-0')).not.toHaveText('38');
  } finally {
    await context.close();
  }
});

test('a room player can redo right after their own undo', async ({ page: host }) => {
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
  await expect(host.getByTestId('life-0')).toHaveText('39');
  await host.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(host.getByTestId('life-0')).toHaveText('40');
  await host.getByRole('button', { name: 'Game menu', exact: true }).click();
  await host.getByRole('button', { name: 'Game history', exact: true }).click();
  await host.getByRole('button', { name: 'Redo last undone action', exact: true }).click();
  await host.getByRole('button', { name: 'Close The story so far', exact: true }).click();
  await expect(host.getByTestId('life-0')).toHaveText('39');
});
