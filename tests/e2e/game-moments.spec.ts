import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function eliminate(page: Page, name: string) {
  await page.getByRole('button', { name: `${name} details`, exact: true }).click();
  await page.getByRole('button', { name: 'Eliminate player', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
}

test('an elimination notice preserves another phone’s dice canvas and recorded result', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByLabel('Your display name').fill('Mira');
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    const url = await host.getByLabel('Join link', { exact: true }).inputValue();
    await guest.goto(url);
    await guest.getByLabel('Your display name').fill('Alex');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByTestId('life-1')).toHaveText('40');
    await guest.getByRole('button', { name: 'Utilities', exact: true }).click();
    await guest.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
    await expect(guest.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
    const canvas = await guest.locator('.dice-canvas').elementHandle();
    const total = await guest.locator('.rolled-total').textContent();
    await host.getByRole('button', { name: 'Back to game', exact: true }).click();
    await eliminate(host, 'Mira');
    await expect(guest.getByTestId('player-fallen')).toContainText('Mira');
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(guest.getByTestId('player-fallen')).toHaveCount(0);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(guest.locator('.rolled-total')).toHaveText(total!);
  } finally {
    await guestContext.close();
  }
});

test('an elimination notice comes and goes, and the last player standing is declared the winner', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  const fallen = page.getByTestId('player-fallen');
  const winner = page.getByTestId('winner-screen');

  await eliminate(page, 'Player 1');
  await expect(fallen).toBeVisible();
  await expect(fallen).toContainText('Player 1');
  await expect(fallen).toContainText('3 players remain');
  // The notice never blocks the table: the open sheet stays usable beneath it.
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await expect(fallen).toHaveCount(0);
  await expect(winner).toHaveCount(0);

  await eliminate(page, 'Player 2');
  await page.getByRole('button', { name: 'Close Player 2', exact: true }).click();
  await expect(fallen).toHaveCount(0);

  await eliminate(page, 'Player 3');
  await expect(fallen).toContainText('Player 3');
  await expect(winner).toBeVisible();
  await expect(fallen).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Player 4 wins', exact: true })).toBeVisible();
  await expect(winner).toContainText('LAST PLAYER STANDING');
  await expect(winner).toContainText('40 life');
  await expect(page.getByRole('button', { name: 'Close Player 3', exact: true })).toHaveCount(0);
  const audit = await new AxeBuilder({ page }).include('.victory-screen').analyze();
  expect(audit.violations).toEqual([]);

  // Back closes the winner like any other sheet and leaves the game as it was.
  await page.goBack();
  await expect(winner).toHaveCount(0);
  await expect(page.getByText('Eliminated · tap name to restore')).toHaveCount(3);
  await expect(page.getByTestId('life-3')).toHaveText('40');

  // Undo restores the player; eliminating them again declares the winner again.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Eliminated · tap name to restore')).toHaveCount(2);
  await expect(winner).toHaveCount(0);
  await eliminate(page, 'Player 3');
  await expect(winner).toBeVisible();
  await winner.getByRole('button', { name: 'Rematch', exact: true }).click();
  await expect(winner).toHaveCount(0);
  await expect(page.getByText('Eliminated · tap name to restore')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('40');
});

test('the winner can end the game, and both screens work with motion switched off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
  await eliminate(page, 'Player 2');
  await expect(page.getByTestId('player-fallen')).toBeVisible();
  await expect(page.getByTestId('player-fallen')).toHaveCount(0);
  const winner = page.getByRole('dialog', { name: 'Player 1 wins', exact: true });
  await expect(winner).toBeVisible();
  await winner.getByRole('button', { name: 'End game', exact: true }).click();
  await expect(winner).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set up a game', exact: true })).toBeVisible();
  // Viewing the finished game later does not announce the result again.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set up a game', exact: true })).toBeVisible();
  await expect(page.getByTestId('winner-screen')).toHaveCount(0);
});

test('every phone in a shared room sees the elimination and the winner, with host-only actions', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await host.getByRole('button', { name: '2', exact: true }).click();
  await host.getByLabel('Your display name').fill('Mira');
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  await host.getByRole('button', { name: 'Live room', exact: true }).click();
  const url = await host.getByLabel('Join link', { exact: true }).inputValue();
  await guest.goto(url);
  await guest.getByLabel('Your display name').fill('Alex');
  await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
  await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
  await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
  await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
  await expect(guest.getByTestId('life-1')).toHaveText('40');

  await eliminate(guest, 'Alex');
  for (const device of [host, guest]) await expect(device.getByTestId('player-fallen')).toContainText('Alex');
  const hostWinner = host.getByRole('dialog', { name: 'Mira wins', exact: true });
  const guestWinner = guest.getByRole('dialog', { name: 'Mira wins', exact: true });
  await expect(hostWinner).toBeVisible();
  await expect(guestWinner).toBeVisible();
  await expect(guestWinner.getByRole('button', { name: 'Rematch', exact: true })).toHaveCount(0);
  await expect(guestWinner).toContainText('The host can start a rematch or end the game.');
  await guestWinner.getByRole('button', { name: 'Back to the table', exact: true }).click();
  await expect(guestWinner).toHaveCount(0);
  await expect(hostWinner).toBeVisible();

  await hostWinner.getByRole('button', { name: 'Rematch', exact: true }).click();
  await expect(hostWinner).toHaveCount(0);
  for (const device of [host, guest]) {
    await expect(device.getByText('Eliminated · tap name to restore')).toHaveCount(0);
    await expect(device.getByTestId('winner-screen')).toHaveCount(0);
  }
  await guestContext.close();
});
