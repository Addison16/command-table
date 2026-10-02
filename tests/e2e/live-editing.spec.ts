import { expect, test } from '@playwright/test';
import type { RoomView } from '../../src/shared/schema.js';

test('exact counters follow saved changes without replacing an unfinished edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  const exact = page.getByLabel('Exact life', { exact: true });
  await expect(exact).toHaveValue('20');
  await page.getByRole('button', { name: 'Decrease life', exact: true }).click();
  await expect(exact).toHaveValue('19');
  await exact.fill('31');
  await page.getByRole('button', { name: 'Increase life', exact: true }).click();
  await expect(exact).toHaveValue('31');
  await exact.locator('..').getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('31');
  await page.getByRole('button', { name: '−5', exact: true }).click();
  await expect(exact).toHaveValue('26');
});

test('a player’s own tabs follow remote updates and keep only the fields being edited', async ({
  page: host,
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  const second = await context.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = host.waitForResponse(
      (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room: RoomView = await (await created).json();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await guest.goto(room.joinUrl!);
    await guest.getByLabel('Your display name').fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Rowan details', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await second.goto('/');
    for (const page of [second, guest]) {
      await page.getByRole('button', { name: 'Rowan details', exact: true }).click();
      await page.getByText('Edit player & commanders', { exact: true }).click();
    }
    await second.getByLabel('Player name', { exact: true }).fill('Aria');
    await guest.getByRole('combobox', { name: 'Player color', exact: true }).selectOption('teal');
    await guest.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(second.getByRole('combobox', { name: 'Player color', exact: true })).toHaveValue('teal');
    await expect(second.getByLabel('Player name', { exact: true })).toHaveValue('Aria');
    await second.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(guest.getByLabel('Player name', { exact: true })).toHaveValue('Aria');
    await expect(guest.getByRole('combobox', { name: 'Player color', exact: true })).toHaveValue('teal');

    await guest.getByLabel('Commander 1 name', { exact: true }).fill('Atraxa');
    await guest.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(second.getByLabel('Commander 1 name', { exact: true })).toHaveValue('Atraxa');
    await guest.getByRole('button', { name: 'Decrease life', exact: true }).click();
    await expect(second.getByLabel('Exact life', { exact: true })).toHaveValue('39');
    for (const page of [second, guest]) {
      await page.getByRole('button', { name: 'Close Aria', exact: true }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await guest.getByRole('button', { name: 'Utilities', exact: true }).click();
    await expect(guest.getByRole('combobox', { name: 'Roll for', exact: true })).toHaveValue(
      room.seats[1].id,
    );
    await guest.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
    for (const page of [host, guest]) {
      await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
      await expect(page.locator('.dice-screen-heading')).toContainText('rolled for Aria');
    }
    await expect(host.locator('.rolled-total')).toHaveText(await guest.locator('.rolled-total').innerText());
    const current: RoomView = await (await host.request.get(`/api/rooms/${room.id}`)).json();
    expect(current.game!.rolls[0].playerId).toBe(room.seats[1].id);
  } finally {
    await context.close();
  }
});
