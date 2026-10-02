import { readFileSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CommanderCard } from '../../src/shared/cards.js';
import type { Game, RoomView } from '../../src/shared/schema.js';

const card: CommanderCard = {
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Atraxa, Praetors’ Voice',
  imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
  scryfallUrl: 'https://scryfall.com/card/test/1/atraxa',
  artist: 'Fixture Artist',
};
const fixtureImage = readFileSync(new URL('../../public/icon-192.png', import.meta.url));

async function mockArtwork(context: BrowserContext) {
  await context.route('https://cards.scryfall.io/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: fixtureImage }),
  );
  await context.route('**/api/cards/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/suggest') ? { names: [] } : { card },
    }),
  );
}

async function localRecord<T>(page: Page, key: string): Promise<T> {
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

async function localGame(page: Page) {
  return (await localRecord<{ game: Game }>(page, 'active')).game;
}

async function customSetup(page: Page) {
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('combobox', { name: 'Game preset', exact: true }).selectOption('Custom');
  await page.getByLabel('Starting life', { exact: true }).fill('37');
  await page.getByText('Names, colors & commanders', { exact: false }).click();
  const seat = page.locator('.seat-form').first();
  await seat.getByLabel('Seat 1 name', { exact: true }).fill('Mira');
  await seat.getByRole('combobox', { name: 'Color', exact: true }).selectOption('rose');
  await seat.getByRole('combobox', { name: 'Commanders', exact: true }).selectOption('2');
  await seat.getByLabel('Commander 1', { exact: true }).fill(card.name);
  await seat.getByRole('button', { name: 'Find artwork', exact: true }).first().click();
  await expect(seat.getByRole('img', { name: `${card.name} artwork`, exact: true })).toBeVisible();
  await seat.getByLabel('Commander 2', { exact: true }).fill('Tymna the Weaver');
  await page.getByText('Trackers & house rules', { exact: false }).click();
  await page.getByLabel('Poison warning threshold', { exact: true }).fill('12');
  await page.getByLabel('Commander damage warning threshold', { exact: true }).fill('25');
}

async function expectFreshSetup(page: Page, mode: 'One phone' | 'Multiple phones') {
  await expect(page.getByRole('button', { name: '4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Game preset', exact: true })).toHaveValue('Commander');
  await expect(page.getByLabel('Starting life', { exact: true })).toHaveValue('40');
  const seats = page.locator('.seat-form');
  if (mode === 'Multiple phones') {
    await expect(page.getByRole('group', { name: 'Your player', exact: true })).toBeVisible();
    await expect(page.getByLabel('Your display name')).toHaveValue('');
    await expect(page.getByLabel('Commander 1 name', { exact: true })).toHaveValue('');
    await expect(
      page.getByRole('checkbox', { name: 'Two commanders / partners', exact: true }),
    ).not.toBeChecked();
    await expect(seats).toHaveCount(0);
  } else {
    await page.getByText('Names, colors & commanders', { exact: false }).click();
    await expect(seats).toHaveCount(4);
    for (const [index, color] of ['ivory', 'blue', 'violet', 'ember'].entries()) {
      await expect(seats.nth(index).getByLabel(`Seat ${index + 1} name`, { exact: true })).toHaveValue('');
      await expect(seats.nth(index).getByRole('combobox', { name: 'Color', exact: true })).toHaveValue(color);
      await expect(seats.nth(index).getByRole('combobox', { name: 'Commanders', exact: true })).toHaveValue(
        '1',
      );
      await expect(seats.nth(index).getByLabel('Commander 1', { exact: true })).toHaveValue('');
    }
  }
  await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(0);
  await page.getByText('Trackers & house rules', { exact: false }).click();
  await expect(page.getByRole('checkbox', { name: 'Poison tracker', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Commander tools', exact: true })).toBeChecked();
  await expect(page.getByLabel('Poison warning threshold', { exact: true })).toHaveValue('10');
  await expect(page.getByLabel('Commander damage warning threshold', { exact: true })).toHaveValue('21');
}

async function endPrompt(page: Page) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'End game', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'End this game?', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function expectReset(game: Game, life: number) {
  expect(game.status).toBe('active');
  expect(game.endedAt).toBeNull();
  for (const player of Object.values(game.players)) {
    expect(player.life).toBe(life);
    expect(player.poison).toBe(0);
    expect(player.counters).toEqual({});
    expect(player.eliminated).toBe(false);
  }
  expect(Object.values(game.commanders).every((commander) => commander.casts === 0)).toBe(true);
  expect(game.damageReceived).toEqual({});
  expect(game.markers).toEqual({ monarch: null, initiative: null });
  expect(game.turn).toEqual({ playerId: null, number: 0 });
  expect(game.timer.pausedAt).toBeNull();
  expect(game.timer.pausedMs).toBe(0);
  expect(game.rolls).toEqual([]);
  expect(game.undo).toEqual([]);
  expect(game.redo).toEqual([]);
}

for (const mode of ['One phone', 'Multiple phones'] as const) {
  test(`new ${mode.toLowerCase()} setup clears the previous players, artwork and house rules`, async ({
    page,
    context,
  }) => {
    await mockArtwork(context);
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
    await customSetup(page);
    await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
    await page.getByRole('button', { name: "Decrease Mira's life", exact: true }).click();
    await expect(page.getByTestId('life-0')).toHaveText('36');
    const original = await localGame(page);
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'New game · change setup', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(mode) }).click();
    await expectFreshSetup(page, mode);
    const created =
      mode === 'Multiple phones'
        ? page.waitForResponse(
            (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
          )
        : undefined;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: mode === 'One phone' ? 'Let’s play' : 'Create room', exact: true })
      .click();
    await expect(page.getByTestId('life-0')).toHaveText('40');
    const fresh = created
      ? (((await (await created).json()) as RoomView).game as Game)
      : await localGame(page);
    expect(fresh.id).not.toBe(original.id);
    expect(fresh.order).toHaveLength(4);
    expect(fresh.order.map((id) => fresh.players[id].name)).toEqual([
      mode === 'Multiple phones' ? 'Host' : 'Player 1',
      'Player 2',
      'Player 3',
      'Player 4',
    ]);
    expect(Object.values(fresh.commanders).map((commander) => commander.label)).toEqual(
      Array(4).fill('Commander 1'),
    );
    expect(Object.values(fresh.commanders).every((commander) => !commander.card)).toBe(true);
    expect(fresh.settings.turnTracking).toBe(false);
    expectReset(fresh, 40);
    await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
    await page.getByRole('button', { name: 'Resume one-phone game: Mira, Player 2', exact: true }).click();
    await expect(page.getByTestId('life-0')).toHaveText('36');
    expect(await localGame(page)).toEqual(original);
    // The home setup path must also ignore the remembered custom profile after a reload.
    await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
    await page
      .getByRole('button', { name: mode === 'One phone' ? 'Set up a game' : 'Create room', exact: true })
      .click();
    await expectFreshSetup(page, mode);
  });
}

test('the ending prompt cancels safely or rematches with custom starting life and editable profiles', async ({
  page,
  context,
}) => {
  await mockArtwork(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await customSetup(page);
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await page.getByRole('button', { name: 'Increase poison', exact: true }).click();
  await page.getByLabel('Damage amount', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
  await page.getByRole('button', { name: 'Record cast', exact: true }).first().click();
  await page.getByRole('button', { name: 'Close Mira', exact: true }).click();
  await page.getByRole('button', { name: 'Player 2 details', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminate player', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Close Player 2', exact: true }).click();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Turn tracking', exact: true }).check();
  await page.getByText('Game timer', { exact: false }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await page.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('32');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const original = await localGame(page);
  expect(original.players[original.order[0]].poison).toBe(1);
  expect(original.players[original.order[1]].eliminated).toBe(true);
  expect(original.rolls).toHaveLength(1);
  expect(original.timer.pausedAt).not.toBeNull();
  expect(original.turn.number).toBeGreaterThan(0);
  let prompt = await endPrompt(page);
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await localGame(page)).toEqual(original);
  // Cancel leaves the game menu open.
  await page.getByRole('button', { name: 'End game', exact: true }).click();
  prompt = page.getByRole('dialog', { name: 'End this game?', exact: true });
  await expect(prompt).toHaveCSS('opacity', '1');
  const audit = await new AxeBuilder({ page })
    .include('.confirm-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
    })),
  ).toEqual([]);
  await prompt.getByRole('button', { name: 'Rematch', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('37');
  await expect(page.getByTestId('life-1')).toHaveText('37');
  const rematch = await localGame(page);
  expectReset(rematch, 37);
  expect(rematch.id).not.toBe(original.id);
  expect(rematch.order).toEqual(original.order);
  expect(rematch.settings).toEqual(original.settings);
  expect(rematch.timer.startedAt).toBeGreaterThan(original.timer.startedAt);
  expect(rematch.commanders).toEqual(
    Object.fromEntries(
      Object.entries(original.commanders).map(([id, commander]) => [id, { ...commander, casts: 0 }]),
    ),
  );
  for (const id of original.order) {
    expect(rematch.players[id].name).toBe(original.players[id].name);
    expect(rematch.players[id].color).toBe(original.players[id].color);
  }
  const archive = await localRecord<Game[]>(page, 'archive');
  const ended = archive.find((game) => game.id === original.id)!;
  expect(ended.status).toBe('ended');
  expect(ended.players).toEqual(original.players);
  expect(ended.commanders).toEqual(original.commanders);
  expect(ended.damageReceived).toEqual(original.damageReceived);
  expect(ended.rolls).toEqual(original.rolls);
  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await expect(page.getByLabel('Player name', { exact: true })).toHaveValue('Mira');
  await expect(page.getByLabel('Commander 1 name', { exact: true })).toHaveValue(card.name);
  await page.getByLabel('Player name', { exact: true }).fill('Mira rematch');
  await page.getByLabel('Commander 2 name', { exact: true }).fill('Thrasios, Triton Hero');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Mira rematch', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mira rematch details', exact: true })).toBeVisible();
  await expect(page.getByTestId('life-0')).toHaveText('37');
  expect(Object.values((await localGame(page)).commanders).map((commander) => commander.label)).toContain(
    'Thrasios, Triton Hero',
  );
});

test('a host can rematch from the ending prompt without losing guest seats or edit permissions', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.getByLabel('Starting life', { exact: true }).fill('30');
    const created = host.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await created).json()) as RoomView;
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByLabel('Commander 1 name', { exact: true }).fill('Tymna the Weaver');
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: "Decrease Rowan's life", exact: true }).click();
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('29');
    await expect(guest.getByTestId('life-1')).toHaveText('29');
    await guest.getByRole('button', { name: 'Game menu', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'End game', exact: true })).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Rematch · same seats', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Close Around the table', exact: true }).click();
    const before = (await (await guest.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    const prompt = await endPrompt(host);
    await prompt.getByRole('button', { name: 'Rematch', exact: true }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.getByTestId('life-0')).toHaveText('30');
    await expect(guest.getByTestId('life-0')).toHaveText('30');
    await expect(guest.getByTestId('life-1')).toHaveText('30');
    const after = (await (await guest.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(after.gameId).not.toBe(before.gameId);
    expect(after.id).toBe(before.id);
    expect(after.me).toEqual(before.me);
    expect(after.game!.order).toEqual(before.game!.order);
    expect(after.game!.commanders).toEqual(before.game!.commanders);
    expectReset(after.game!, 30);
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await expect(guest.getByRole('button', { name: "Decrease Host's life", exact: true })).toBeDisabled();
    await expect(host.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Rowan details', exact: true }).click();
    await guest.getByText('Edit player & commanders', { exact: true }).click();
    await expect(guest.getByLabel('Commander 1 name', { exact: true })).toHaveValue('Tymna the Weaver');
    await guest.getByLabel('Player name', { exact: true }).fill('Rowan rematch');
    await guest.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(guest.getByText('Changes saved.', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Close Rowan rematch', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Rowan rematch details', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: "Decrease Rowan rematch's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('29');
  } finally {
    await guestContext.close();
  }
});

test('a stale rematch confirmation cannot reset the replacement game from another host tab', async ({
  page: host,
  context,
}) => {
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  const created = host.waitForResponse(
    (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
  );
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = (await (await created).json()) as RoomView;
  const second = await context.newPage();
  try {
    await second.goto('/');
    await expect(second.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Game menu', exact: true }).click();
    await host.getByRole('button', { name: 'Rematch · same seats', exact: true }).click();
    const stale = host.getByRole('dialog', { name: 'Start a rematch?', exact: true });
    await expect(stale).toBeVisible();
    const prompt = await endPrompt(second);
    await prompt.getByRole('button', { name: 'Rematch', exact: true }).click();
    await second.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('39');
    const before = (await (await second.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(before.gameId).not.toBe(room.gameId);
    await stale.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(host.getByRole('alert')).toContainText('The game changed while this prompt was open.');
    const after = (await (await second.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(after.game).toEqual(before.game);
    await expect(second.getByTestId('life-0')).toHaveText('39');
  } finally {
    await second.close();
  }
});
