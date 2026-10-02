import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Game } from '../../src/shared/schema.js';

async function saved(page: Page): Promise<Game> {
  return page.evaluate(async () => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const read = db.transaction('records').objectStore('records').get('active');
    return new Promise<Game>((resolve) => {
      read.onsuccess = () => {
        db.close();
        resolve(read.result.game);
      };
    });
  });
}

test('dice bounce over the board and keep the first player hidden through a tie reroll', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto);
    const values = [19, 19, 1, 2, 6, 9];
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: Uint32Array<ArrayBuffer>) => {
        if (array instanceof Uint32Array && array.length === 1 && values.length) {
          array[0] = values.shift()!;
          return array;
        }
        return random(array);
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'd20 for everyone', exact: true }).click();
  const result = page.getByTestId('dice-result');
  await expect(result).toHaveAttribute('data-revealed', 'false');
  await expect(page.getByRole('dialog', { name: 'A little luck & magic' })).toHaveCount(0);
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.winner-name')).toHaveCount(0);
  const canvas = page.locator('.dice-canvas');
  const firstFrame = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(450);
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(firstFrame);
  if (info.project.name === 'chromium-phone')
    await page.screenshot({ path: 'docs/screenshots/dice-rolling.png' });
  await expect(page.getByText('Tied highest — rolling again…', { exact: true })).toBeVisible();
  await expect(result).toHaveAttribute('data-revealed', 'false');
  await expect(page.locator('.winner-name')).toHaveCount(0);
  await expect(result).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('.winner-name')).toHaveText('Player 2');
  await expect(page.locator('.player-roll-scores strong')).toHaveText(['7', '10', '2', '3']);
  if (info.project.name === 'chromium-phone')
    await page.screenshot({ path: 'docs/screenshots/dice-result.png' });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  const rollId = (await saved(page)).rolls[0].id;
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.roll-history-button').first().click();
  await expect(page.locator('.winner-name')).toHaveText('Player 2');
  expect((await saved(page)).rolls[0].id).toBe(rollId);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('40');
});

test('names, commanders, optional turns and original unfinished games survive switching and reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  await expect(page.getByRole('button', { name: 'Next turn', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByLabel('Damage amount', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Mira');
  await page.getByLabel('Commander 1 name', { exact: true }).fill('Atraxa');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close Mira', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('35');
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await expect(page.getByText('Extra trackers', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Close A little luck & magic' }).click();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect(page.locator('.active-turn .player-name')).toHaveText('Mira');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const original = await saved(page);
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'New game · change setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How are you playing?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Multiple phones/ })).toBeVisible();
  await page.getByRole('button', { name: /One phone/ }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  await expect(page.locator('.player-tile')).toHaveCount(2);
  const second = await saved(page);
  expect(second.id).not.toBe(original.id);
  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Unfinished games' }).getByRole('button')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Resume one-phone game: Mira, Player 2, Player 3, Player 4', exact: true })
    .click();
  await expect(page.getByTestId('life-0')).toHaveText('35');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mira details', exact: true })).toBeVisible();
  const resumed = await saved(page);
  expect(resumed).toEqual(original);
  const commanderId = Object.keys(resumed.commanders)[0];
  expect(resumed.commanders[commanderId].label).toBe('Atraxa');
  const source = Object.values(resumed.commanders).find(
    (commander) => commander.ownerId !== resumed.order[0],
  )!;
  expect(resumed.damageReceived[resumed.order[0]][source.id]).toBe(5);
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Close A little luck & magic' }).click();
  await expect(page.getByRole('button', { name: 'Next turn', exact: true })).toHaveCount(0);
});

test('dice stay available after ending a game and an expired editor lease recovers automatically', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('Another tab controls this local game.')).toBeVisible();
  await page.close();
  // Simulate the old tab's lease expiring without waiting eighteen seconds.
  await second.evaluate(async () => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const read = store.get('active');
    read.onsuccess = () => store.put({ ...read.result, until: 0 }, 'active');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await expect(second.getByRole('button', { name: "Decrease Player 1's life" })).toBeEnabled();
  await second.getByRole('button', { name: 'Game menu', exact: true }).click();
  await second.getByRole('button', { name: 'End game', exact: true }).click();
  await second
    .getByRole('dialog', { name: 'End this game?', exact: true })
    .getByRole('button', { name: 'End game', exact: true })
    .click();
  await expect(second.getByRole('button', { name: 'Quick 4 · 40 life', exact: true })).toBeVisible();
  await second.getByRole('button', { name: /^View final one-phone game:/ }).click();
  await second.getByRole('button', { name: 'Utilities', exact: true }).click();
  await second.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await second.getByRole('button', { name: 'Skip animation', exact: true }).click();
  await expect(second.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  const current = await saved(second);
  expect(current.status).toBe('ended');
  expect(current.rolls[0].values[0]).toBeGreaterThan(0);
  await expect(second.locator('.rolled-total')).toHaveText(String(current.rolls[0].values[0]));
});
