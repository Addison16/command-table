import { test, expect, type Page } from '@playwright/test';
import type { Game } from '../../src/shared/schema.js';

async function endGame(page: Page) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'End game', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'End this game?', exact: true })
    .getByRole('button', { name: 'End game', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true })).toBeVisible();
  await expect(page.locator('.board')).toHaveCount(0);
}
async function saved(page: Page): Promise<Game> {
  return page.evaluate(async () => {
    const open = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result);
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
test('ending returns to setup options and can restore the same local game after starting another', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByLabel('Damage amount', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const original = await saved(page);
  await endGame(page);
  await expect(page.getByRole('region', { name: 'Recently ended games' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.board')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Reopen one-phone game:/ })).toBeVisible();
  if (info.project.name === 'chromium-phone')
    await page.screenshot({ path: 'docs/screenshots/recently-ended.png', fullPage: true });
  await page.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
  await expect(page.getByTestId('life-0')).toHaveText('20');
  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await page.getByRole('button', { name: /^Reopen one-phone game:/ }).click();
  await expect(page.getByTestId('life-0')).toHaveText('33');
  await expect(page.getByRole('button', { name: "Decrease Player 1's life", exact: true })).toBeEnabled();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const restored = await saved(page);
  expect(restored.id).toBe(original.id);
  expect(restored.players).toEqual(original.players);
  expect(restored.commanders).toEqual(original.commanders);
  expect(restored.damageReceived).toEqual(original.damageReceived);
  expect(restored.history.slice(0, -2)).toEqual(original.history);
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('33');
});

test('a shared ending returns everyone home and host recovery keeps the same seat and totals', async ({
  page: host,
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByLabel('Your display name').fill('Ivory host');
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await guest.goto(await host.getByLabel('Join link', { exact: true }).inputValue());
    await guest.getByLabel('Your display name').fill('Ivory guest');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await expect(guest.getByTestId('life-1')).toHaveText('40');
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await guest.getByRole('button', { name: "Decrease Ivory guest's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('39');
    await endGame(host);
    await expect(guest.getByRole('button', { name: 'Quick 4 · 40 life', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: /^View shared room:/ })).toBeVisible();
    await expect(guest.getByRole('button', { name: /^Reopen shared room:/ })).toHaveCount(0);
    await guest.getByRole('button', { name: /^View shared room:/ }).click();
    await expect(
      guest.getByRole('button', { name: "Decrease Ivory guest's life", exact: true }),
    ).toBeDisabled();
    await host.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
    await host.getByRole('button', { name: 'Home & recent games', exact: true }).click();
    await host.getByRole('button', { name: /^Reopen shared room:/ }).click();
    await expect(host.getByTestId('life-1')).toHaveText('39');
    await expect(
      guest.getByRole('button', { name: "Decrease Ivory guest's life", exact: true }),
    ).toBeEnabled();
    await expect(
      guest.getByRole('button', { name: "Decrease Ivory host's life", exact: true }),
    ).toBeDisabled();
    await guest.getByRole('button', { name: "Decrease Ivory guest's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('38');
  } finally {
    await context.close();
  }
});

type SoundProbe = { peak: number; starts: number; context?: AudioContext };
test('sound preview and rolls produce audio, recover after suspension, and respect mute', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe: SoundProbe = { peak: 0, starts: 0 };
    (window as unknown as { soundProbe: SoundProbe }).soundProbe = probe;
    const connect = AudioNode.prototype.connect as (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) => AudioNode;
    // Measure real samples on the path to the destination, not a mocked cue.
    AudioNode.prototype.connect = function (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) {
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        probe.context = this.context as AudioContext;
        connect.call(this, analyser);
        connect.call(analyser, destination as AudioNode);
        const samples = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          for (const value of samples) probe.peak = Math.max(probe.peak, Math.abs(value));
        }, 10);
        setTimeout(() => clearInterval(timer), 3000);
        return destination as AudioNode;
      }
      if (destination instanceof AudioParam)
        return connect.call(this, destination, output) as unknown as AudioNode;
      return connect.call(this, destination, output, input);
    } as typeof AudioNode.prototype.connect;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      probe.starts++;
      return start.apply(this, args);
    };
  });
  const probe = () =>
    page.evaluate(() => {
      const p = (window as unknown as { soundProbe: SoundProbe }).soundProbe;
      return { starts: p.starts, peak: p.peak, state: p.context?.state };
    });
  await page.goto('/');
  await page.getByRole('button', { name: 'Display & browser settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sound effects', exact: true }).check();
  await expect.poll(async () => (await probe()).peak).toBeGreaterThan(0.01);
  await expect(page.getByRole('button', { name: 'Test dice sound', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Your table, your way', exact: true }).click();
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  // Simulate an OS/browser interruption before the next explicit roll gesture.
  await page.evaluate(async () => {
    const p = (window as unknown as { soundProbe: SoundProbe }).soundProbe;
    await p.context?.suspend();
    p.peak = 0;
  });
  const before = (await probe()).starts;
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await expect.poll(async () => (await probe()).starts).toBeGreaterThan(before);
  await expect.poll(async () => (await probe()).state).toBe('running');
  await expect.poll(async () => (await probe()).peak).toBeGreaterThan(0.01);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Display & preferences', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sound effects', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close Your table, your way', exact: true }).click();
  const muted = (await probe()).starts;
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  expect((await probe()).starts).toBe(muted);
});
