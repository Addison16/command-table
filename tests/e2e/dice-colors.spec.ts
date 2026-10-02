import { expect, test, type Page } from '@playwright/test';
import type { Game } from '../../src/shared/schema.js';

async function saved(page: Page): Promise<Game> {
  return page.evaluate(
    () =>
      new Promise<Game>((resolve, reject) => {
        const open = indexedDB.open('mtg-util', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('records').objectStore('records').get('active');
          read.onsuccess = () => {
            db.close();
            resolve(read.result.game);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
}

async function coloredPixels(page: Page, color: 'blue' | 'rose') {
  return page.locator('.dice-canvas').evaluate((canvas: HTMLCanvasElement, color) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, a] = pixels.slice(i, i + 4);
      if (a > 200 && (color === 'blue' ? b > r + 15 && b > g + 5 : r > b + 15 && r > g + 25)) count++;
    }
    return count;
  }, color);
}

type Engraving = { text: string; a: number; b: number; c: number; d: number; x: number; y: number };
type DiceProbe = Window & { diceEngravings: Engraving[] };

async function installEngravingProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as DiceProbe;
    probe.diceEngravings = [];
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (x, y, width, height) {
      if (this.canvas.classList.contains('dice-canvas')) probe.diceEngravings = [];
      clear.call(this, x, y, width, height);
    };
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (this.canvas.classList.contains('dice-canvas')) {
        const matrix = this.getTransform();
        const ratio = this.canvas.width / this.canvas.getBoundingClientRect().width;
        probe.diceEngravings.push({
          text,
          a: matrix.a,
          b: matrix.b,
          c: matrix.c,
          d: matrix.d,
          x: matrix.e / ratio,
          y: matrix.f / ratio,
        });
      }
      if (maxWidth === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, maxWidth);
    };
  });
}

async function expectUprightEngravings(page: Page, values: number[]) {
  // Side-face lettering may be visible; every recorded front value must have
  // its own exact head-on engraving, even when multiple dice share a value.
  for (const value of new Set(values)) {
    const count = values.filter((recorded) => recorded === value).length;
    await expect
      .poll(async () => {
        const drawings = await page.evaluate(
          (value) =>
            (window as unknown as DiceProbe).diceEngravings.filter((draw) => draw.text === String(value)),
          value,
        );
        return new Set(
          drawings
            .filter(
              (draw) =>
                draw.a > 0 &&
                draw.d > 0 &&
                Math.abs(draw.a - draw.d) < 0.00001 &&
                Math.abs(draw.b) < 0.00001 &&
                Math.abs(draw.c) < 0.00001,
            )
            .map((draw) => `${draw.x.toFixed(5)}:${draw.y.toFixed(5)}`),
        ).size;
      })
      .toBe(count);
  }
}

test('player dice use colored pearl bodies and preserve the seat through rerolls, percentile dice and replay', async ({
  page,
}, info) => {
  await installEngravingProbe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('blue');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  const playerId = (await saved(page)).order[0];
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Roll for', exact: true })).toHaveValue(playerId);
  await page.getByRole('button', { name: 'd6', exact: true }).click();
  await page.getByRole('combobox', { name: 'Number of dice', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Roll 2d6', exact: true }).click();
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('.dice-screen-heading')).toContainText('rolled for Player 1');
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(500);
  const first = (await saved(page)).rolls[0];
  expect(first.playerId).toBe(playerId);
  await expectUprightEngravings(page, first.values);
  await page.getByRole('button', { name: 'Roll again', exact: true }).click();
  await expect.poll(async () => (await saved(page)).rolls[0].id).not.toBe(first.id);
  expect((await saved(page)).rolls[0].playerId).toBe(playerId);
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(500);
  const replayed = (await saved(page)).rolls[0];
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Roll for', exact: true })).toHaveValue(playerId);
  await page.locator('.roll-history-button').first().click();
  await expect(page.locator('.dice-screen-heading')).toContainText('rolled for Player 1');
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(500);
  await expectUprightEngravings(page, replayed.values);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'd100', exact: true }).click();
  await page.getByRole('button', { name: 'Roll 1d100', exact: true }).click();
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(500);
  expect((await saved(page)).rolls[0].playerId).toBe(playerId);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.getByRole('button', { name: 'Player 2 details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('rose');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Player 2', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.evaluate(() => {
    const random = crypto.getRandomValues.bind(crypto);
    const values = [0, 5, 10, 15];
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
  await page.getByRole('button', { name: 'd20 for everyone', exact: true }).click();
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  expect((await saved(page)).rolls[0].rounds).toHaveLength(1);
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(300);
  await expect.poll(() => coloredPixels(page, 'rose')).toBeGreaterThan(300);
  const finalRound = (await saved(page)).rolls[0].rounds[0];
  expect(finalRound.map((score) => score.value)).toEqual([1, 6, 11, 16]);
  await expectUprightEngravings(
    page,
    finalRound.map((score) => score.value),
  );
  const settled = await page.evaluate(() => (window as unknown as DiceProbe).diceEngravings);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as unknown as DiceProbe).diceEngravings)).toEqual(settled);
  if (info.project.name === 'chromium-phone') {
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/player-colored-dice.png' });
  }
});

test('saving a player color makes their ordinary d20 match without another player selection', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  const playerId = (await saved(page)).order[2];

  // Use the third seat so a default to the first player cannot hide the bug.
  await page.getByRole('button', { name: 'Player 3 details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Player name', exact: true }).fill('Mira');
  await page.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('blue');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).players[playerId].name).toBe('Mira');
  await page.getByRole('button', { name: 'Close Mira', exact: true }).click();

  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Roll for', exact: true })).toHaveValue(playerId);
  await page.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('.dice-screen-heading')).toContainText('rolled for Mira');
  await expect.poll(() => coloredPixels(page, 'blue')).toBeGreaterThan(500);
  const first = (await saved(page)).rolls[0];
  expect(first.playerId).toBe(playerId);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();

  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('rose');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).players[playerId].color).toBe('rose');
  await page.getByRole('button', { name: 'Close Mira', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Roll for', exact: true })).toHaveValue(playerId);
  await page.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await expect.poll(async () => (await saved(page)).rolls[0].id).not.toBe(first.id);
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('.dice-screen-heading')).toContainText('rolled for Mira');
  await expect.poll(() => coloredPixels(page, 'rose')).toBeGreaterThan(500);
  expect((await saved(page)).rolls[0].playerId).toBe(playerId);
});
