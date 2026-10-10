import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('archenemy setup marks the villain, runs the scheme deck, and shares the team turn', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('combobox', { name: 'Game preset', exact: true }).selectOption('Archenemy');
  await expect(setup.getByRole('button', { name: '1', exact: true })).toBeDisabled();
  await expect(setup.getByRole('spinbutton', { name: 'Team starting life' })).toHaveValue('40');
  await expect(setup.getByRole('spinbutton', { name: /Archenemy starting life/ })).toHaveValue('60');
  await setup.getByRole('button', { name: 'Player 3', exact: true }).click();
  await expect(setup.getByRole('button', { name: 'Player 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await setup.getByRole('button', { name: 'Let’s play', exact: true }).click();

  await expect(page.getByText('ARCHENEMY · 1 VS 3')).toBeVisible();
  await expect(page.getByTestId('life-2')).toHaveText('60');
  await expect(page.getByTestId('life-0')).toHaveText('40');
  const villain = page.locator('[data-role="archenemy"]');
  await expect(villain).toHaveCount(1);
  await expect(villain).toHaveAttribute('aria-label', 'Player 3 (archenemy) seat');
  await expect(page.locator('[data-role="team"]')).toHaveCount(3);
  if (info.project.name === 'chromium-phone') await page.screenshot({ path: 'test-results/archenemy.png' });

  await page.getByRole('button', { name: /Player 3: open the scheme deck/ }).click();
  const deck = page.getByRole('dialog', { name: 'Scheme deck' });
  await deck.getByRole('textbox', { name: /Scheme name/ }).fill('All Shall Smolder in My Wake');
  await deck.getByRole('checkbox', { name: 'Ongoing scheme', exact: true }).check();
  await deck.getByRole('button', { name: 'Set a scheme in motion', exact: true }).click();
  await expect(deck.getByTestId('schemes-in-motion')).toHaveText('1');
  await expect(deck.getByText('All Shall Smolder in My Wake')).toBeVisible();
  await deck.getByRole('button', { name: 'Abandon All Shall Smolder in My Wake', exact: true }).click();
  await expect(deck.getByText('No ongoing schemes.', { exact: false })).toBeVisible();
  await deck.getByRole('button', { name: 'Back to game', exact: true }).click();

  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).check();
  await page.getByRole('button', { name: 'Close A little luck & magic', exact: true }).click();
  await expect(villain.getByText('TURN 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect(page.locator('[data-role="team"]').getByText('TEAM TURN 2')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect(villain.getByText('TURN 3')).toBeVisible();

  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Group life change', exact: true }).click();
  const group = page.getByRole('dialog', { name: 'Group life change', exact: true });
  await group.getByRole('combobox', { name: 'Caster', exact: true }).selectOption({ label: 'Player 1' });
  await expect(group.getByRole('group', { name: 'Opponents affected' }).getByRole('checkbox')).toHaveCount(1);
  await expect(group.getByText('teammates are not opponents', { exact: false })).toBeVisible();
});
