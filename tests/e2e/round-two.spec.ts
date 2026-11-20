import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const audit = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => ({ id: v.id, elements: v.nodes.map((n) => n.target) }))).toEqual([]);
};
const closeUtilities = (page: Page) =>
  page.getByRole('button', { name: 'Close A little luck & magic', exact: true }).click();

test('a player ventures through a dungeon room by room and completes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Dungeons', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Dungeons' });
  await expect(sheet.getByTestId('dungeons-completed')).toContainText('has not completed');
  await sheet.getByRole('button', { name: /Lost Mine of Phandelver/ }).click();
  const here = sheet.locator('.dungeon li[aria-current="step"]');
  await expect(here).toContainText('Cave Entrance');
  await audit(page);
  await sheet.getByRole('button', { name: 'Mine Tunnels', exact: true }).click();
  await expect(here).toContainText('Create a Treasure token.');
  await page.reload();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Dungeons', exact: true }).click();
  await expect(here).toContainText('Mine Tunnels');
  await sheet.getByRole('button', { name: 'Fungi Cavern', exact: true }).click();
  await sheet.getByRole('button', { name: 'Temple of Dumathoin', exact: true }).click();
  await sheet.getByRole('button', { name: 'Complete Lost Mine of Phandelver', exact: true }).click();
  await expect(sheet.getByTestId('dungeons-completed')).toContainText('completed 1 dungeon this game');
  await expect(sheet.getByRole('button', { name: /Undercity/ })).toBeVisible();
  // Another player's marker is their own.
  await sheet.getByRole('combobox', { name: 'Player' }).selectOption({ label: 'Player 2' });
  await expect(sheet.getByTestId('dungeons-completed')).toContainText('Player 2 has not completed');
});

test('storm count and mana pool last for the turn and clear when it passes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).check();
  await page.getByRole('button', { name: 'Storm count & mana pool', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'This turn' });
  for (let cast = 0; cast < 3; cast++)
    await sheet.getByRole('button', { name: 'Increase Spells cast this turn', exact: true }).click();
  await sheet.getByRole('button', { name: 'Increase Red', exact: true }).click();
  await sheet.getByRole('button', { name: 'Increase Red', exact: true }).click();
  await sheet.getByRole('button', { name: 'Increase Colorless', exact: true }).click();
  await expect(sheet.getByTestId('storm-copies')).toContainText('copied 3 times');
  await expect(sheet.getByTestId('mana-total')).toHaveText('3');
  await audit(page);
  await sheet.getByRole('button', { name: 'Back to game', exact: true }).click();
  // Still there when reopened in the same turn.
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Storm count & mana pool', exact: true }).click();
  await expect(sheet.getByTestId('mana-total')).toHaveText('3');
  await sheet.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Storm count & mana pool', exact: true }).click();
  await expect(sheet.getByTestId('mana-total')).toHaveText('0');
  await expect(sheet.getByRole('button', { name: 'Clear for the next turn', exact: true })).toBeDisabled();
});

test('a seat lists its life history and the recap shows time on turns', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).check();
  await closeUtilities(page);
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: "Increase Player 1's life", exact: true }).click();
  await page.getByRole('button', { name: "Increase Player 1's life", exact: true }).click();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  const details = page.getByRole('dialog');
  await details.getByText('Life history', { exact: false }).click();
  const steps = details.locator('.life-history li');
  await expect(steps).toHaveCount(2);
  await expect(steps.first()).toContainText('+2');
  await expect(steps.first()).toContainText('41 life');
  await expect(steps.last()).toContainText('−1');
  await audit(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Share game recap', exact: true }).click();
  const turns = page.getByTestId('recap-turns');
  await expect(turns.locator('li')).toHaveCount(4);
  await expect(turns.locator('li').first()).toContainText('Player 1');
});

test('setup can shuffle the seating and stats can be imported from another device', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await page.getByText('Names, colors & commanders', { exact: false }).click();
  const names = ['Ada', 'Bo', 'Cy', 'Di'];
  for (const [index, name] of names.entries())
    await page.getByLabel(`Seat ${index + 1} name`, { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Shuffle seating', exact: true }).click();
  const seated = await Promise.all(
    names.map((_, index) => page.getByLabel(`Seat ${index + 1} name`, { exact: true }).inputValue()),
  );
  expect([...seated].sort()).toEqual(names);
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  await expect(page.locator('.player-name').first()).toHaveText(seated[0]);

  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Playgroup stats', exact: true }).click();
  const stats = page.getByRole('dialog', { name: 'Playgroup stats' });
  const player = (name: string, winner: boolean) => ({
    name,
    color: 'ivory',
    commanders: [],
    life: winner ? 12 : 0,
    eliminated: !winner,
    winner,
  });
  const record = {
    id: '3f0d8a52-6f0e-4c1b-9d55-0a2f6c1e7b11',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_003_600_000,
    durationMs: 3_600_000,
    preset: 'Commander',
    mode: 'local',
    turns: 9,
    players: [player('Ada', true), player('Bo', false)],
  };
  const file = (records: unknown) => ({
    name: 'command-table-stats.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(records)),
  });
  const input = stats.getByLabel('Import stats from another device', { exact: true });
  await input.setInputFiles(file([record, { id: 'broken' }]));
  await expect(stats.getByTestId('stats-games')).toHaveText('1');
  await expect(stats.getByRole('row', { name: /Ada/ })).toContainText('100%');
  // The same file again adds nothing.
  await input.setInputFiles(file([record]));
  await expect(page.getByText('No new games in that file', { exact: true })).toBeVisible();
  await expect(stats.getByTestId('stats-games')).toHaveText('1');
  await input.setInputFiles(file({ not: 'stats' }));
  await expect(stats.getByTestId('stats-games')).toHaveText('1');
});
