import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('start and join stay on the first small-phone screen', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    for (const name of ['Quick 4 · 40 life', 'Create room', 'Join room']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('one table look coordinates the finish and colors and survives reopening', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Display & browser settings', exact: true }).click();
  const customize = page.locator('.appearance-customize');
  await expect(customize).not.toHaveAttribute('open', '');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Verdant haven', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'forest');
  await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'green');
  await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'verdant');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Close Your table, your way', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'verdant');
  await page.getByRole('button', { name: 'Display & browser settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verdant haven', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a failed optional tool download leaves the saved table playable', async ({ page }) => {
  let attempts = 0;
  await page.route(
    /\/(?:assets\/Settings-[^/]+\.js|src\/client\/features\/Settings\.tsx)(?:\?.*)?$/,
    (route) => {
      attempts++;
      return route.abort('failed');
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  const increase = page.getByRole('button', { name: "Increase Player 1's life", exact: true });
  await increase.click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Display & preferences', exact: true }).click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Unable to open this tool', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Unable to open this tool', exact: true }).click();
  await increase.click();
  await expect(page.getByTestId('life-0')).toHaveText('42');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('42');
});

test('a failed elimination notice download keeps the table reachable and saved', async ({ page }) => {
  let attempts = 0;
  await page.route(
    /\/(?:assets\/GameMoments-[^/]+\.js|src\/client\/features\/GameMoments\.tsx)(?:\?.*)?$/,
    (route) => {
      attempts++;
      return route.abort('failed');
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminate player', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: "Increase Player 2's life", exact: true }).click();
  await expect(page.getByTestId('life-1')).toHaveText('41');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('life-1')).toHaveText('41');
  await expect(page.getByText('Eliminated · tap name to restore', { exact: true })).toBeVisible();
});

test('rejected exact life, damage and cast corrections retain drafts until a successful receipt', async ({
  page,
}) => {
  let reject = true;
  await page.routeWebSocket('**/api/rooms/**/live?*', (route) => {
    const server = route.connectToServer();
    route.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (
        reject &&
        message.type === 'command' &&
        ['set', 'damageSet', 'castSet'].includes(message.envelope.command.type)
      ) {
        message.envelope.baseRevision = 0;
        server.send(JSON.stringify(message));
      } else server.send(raw);
    });
    server.onMessage((raw) => route.send(raw));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Host details', exact: true }).click();
  await page.getByText('Correct recorded totals', { exact: false }).click();
  await page.locator('.commander-casts summary').first().click();
  const corrections = [
    { field: page.getByRole('spinbutton', { name: 'Exact life', exact: true }), value: '17', submit: 'Set' },
    { field: page.locator('.damage-correction input').first(), value: '9', submit: 'Correct' },
    {
      field: page.getByRole('spinbutton', { name: 'Previous command-zone casts', exact: true }).first(),
      value: '2',
      submit: 'Correct casts',
    },
  ];
  for (const { field, value, submit } of corrections) {
    reject = true;
    await field.fill(value);
    const button = field.locator('xpath=ancestor::form').getByRole('button', { name: submit, exact: true });
    await button.click();
    await expect(page.getByRole('alert')).toContainText('The room changed before this action');
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue(value);
    reject = false;
    await button.click();
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue(value);
  }
  await page.getByRole('button', { name: 'Close Host', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('17');
  await page.getByRole('button', { name: 'Host details', exact: true }).click();
  await expect(page.locator('.commander-casts .tax').first()).toContainText('+4');
  await page.getByText('Correct recorded totals', { exact: false }).click();
  await expect(page.locator('.damage-correction input').first()).toHaveValue('9');
});
