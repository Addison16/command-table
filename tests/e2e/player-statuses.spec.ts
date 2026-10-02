import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createGame, defaultSetup } from '../../src/shared/game.js';
import { newId } from '../../src/shared/random.js';
import type { CommanderCard } from '../../src/shared/cards.js';
import type { Game, RoomView } from '../../src/shared/schema.js';

const artwork: CommanderCard = {
  id: '12345678-1234-4234-8234-123456789abc',
  name: 'Tymna the Weaver',
  imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
  scryfallUrl: 'https://scryfall.com/card/test/1/tymna-the-weaver',
  artist: 'Fixture Artist',
};
const fixtureImage = readFileSync(new URL('../../public/icon-192.png', import.meta.url));

function fixture(count = 4) {
  const setup = defaultSetup(count);
  setup.settings.poisonThreshold = 12;
  setup.settings.commanderThreshold = 25;
  setup.seats[0].name = 'Mira';
  setup.seats[0].commanders = ['Tymna the Weaver', 'Thrasios, Triton Hero'];
  setup.seats[1].name = 'Rowan';
  setup.seats[1].commanders = ['Lathril, Blade of the Elves'];
  setup.seats[2].name = 'Tess';
  setup.seats[2].commanders = ['Isshin, Two Heavens as One'];
  return createGame(setup, newId, Date.now() - 60_000);
}

async function mockArtwork(context: BrowserContext) {
  await context.route('https://cards.scryfall.io/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: fixtureImage,
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
}

async function importGame(page: Page, game: Game) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByText('Import a game backup', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Paste backup JSON', exact: true })
    .fill(JSON.stringify({ format: 'mtg-util-game', version: 1, game }));
  await page.getByRole('button', { name: 'Validate & import', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Import a local game?', exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.player-tile')).toHaveCount(game.order.length);
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
}

async function savedGame(page: Page): Promise<Game> {
  return page.evaluate(async () => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = db.transaction('records').objectStore('records').get('active');
      return await new Promise<Game>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result.game);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  });
}

function chip(tile: Locator, status: 'commander-damage' | 'poison' | 'tax') {
  return tile.locator(`.status-chip[data-status="${status}"]`);
}

async function setPoison(page: Page, amount: number) {
  const field = page.getByRole('spinbutton', { name: 'Exact poison', exact: true });
  await field.fill(String(amount));
  await page.locator('form').filter({ has: field }).getByRole('button', { name: 'Set', exact: true }).click();
}

async function damage(page: Page, source: string, amount: number) {
  await page.getByRole('combobox', { name: 'Combat damage source', exact: true }).selectOption(source);
  await page.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill(String(amount));
  await page.getByRole('checkbox', { name: 'Also subtract this much life', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
}

async function closePlayer(page: Page, name = 'Mira') {
  await page.getByRole('button', { name: `Close ${name}`, exact: true }).click();
}

test('badges use per-source damage and independent partner tax, respect thresholds, and follow undo, reload and rematch', async ({
  page,
}) => {
  const game = fixture();
  const commanders = Object.values(game.commanders);
  const sources = [
    commanders.find((commander) => commander.ownerId === game.order[1])!,
    commanders.find((commander) => commander.ownerId === game.order[2])!,
  ];
  await importGame(page, game);
  const tile = page.locator('.player-tile').first();
  await expect(page.locator('.status-chip')).toHaveCount(9);
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('0');
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+0', '+0']);
  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await setPoison(page, 5);
  await damage(page, sources[0].id, 11);
  await damage(page, sources[1].id, 14);
  const casts = page.getByRole('button', { name: 'Record cast', exact: true });
  await casts.nth(0).click();
  await casts.nth(0).click();
  await casts.nth(1).click();
  await closePlayer(page);
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('14');
  await expect(chip(tile, 'commander-damage')).not.toHaveClass(/is-warning/u);
  await expect(chip(tile, 'commander-damage')).toHaveAccessibleName(
    /Highest commander damage.*14.*Rowan's Lathril, Blade of the Elves: 11.*Tess's Isshin, Two Heavens as One: 14.*Warning at 25/u,
  );
  await expect(chip(tile, 'poison').locator('.status-chip-value')).toHaveText('5');
  await expect(chip(tile, 'poison')).not.toHaveClass(/is-warning/u);
  await expect(chip(tile, 'tax')).toHaveCount(2);
  await expect(chip(tile, 'tax').nth(0).locator('.status-chip-value')).toHaveText('+4');
  await expect(chip(tile, 'tax').nth(1).locator('.status-chip-value')).toHaveText('+2');
  await expect(chip(tile, 'tax').nth(0)).toHaveAccessibleName(
    /Tymna the Weaver: next command-zone cast costs \+4/u,
  );
  await expect(chip(tile, 'tax').nth(1)).toHaveAccessibleName(
    /Thrasios, Triton Hero: next command-zone cast costs \+2/u,
  );
  await expect(tile.locator('.player-statuses')).toHaveAttribute('aria-label', 'Player status');
  await expect(tile.locator('.player-statuses button')).toHaveCount(3);
  await expect(page.getByTestId('life-0')).toHaveText('40');
  // Two different sources total 25, but neither has reached the 25-point warning.
  expect(Object.values((await savedGame(page)).damageReceived[game.order[0]])).toEqual([11, 14]);

  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await setPoison(page, 12);
  await damage(page, sources[0].id, 14);
  await closePlayer(page);
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('25');
  await expect(chip(tile, 'commander-damage')).toHaveClass(/is-warning/u);
  await expect(chip(tile, 'poison')).toHaveClass(/is-warning/u);
  await expect(page.getByRole('button', { name: "Decrease Mira's life", exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('14');
  await expect(chip(tile, 'commander-damage')).not.toHaveClass(/is-warning/u);
  const saved = await savedGame(page);
  await page.reload();
  await expect(chip(tile, 'poison').locator('.status-chip-value')).toHaveText('12');
  await expect(chip(tile, 'tax').nth(0).locator('.status-chip-value')).toHaveText('+4');
  expect(await savedGame(page)).toEqual(saved);
  await page.getByRole('button', { name: 'Mira details', exact: true }).click();
  await setPoison(page, 0);
  await closePlayer(page);
  await expect(chip(tile, 'poison')).toHaveCount(0);
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Rematch · same seats', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.status-chip')).toHaveCount(9);
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('0');
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+0', '+0']);
  await expect(page.getByRole('button', { name: 'Mira details', exact: true })).toBeVisible();
  await expect(page.getByTestId('life-0')).toHaveText('40');
});

test('disabled trackers hide retained values while ended and eliminated seats keep their final badges', async ({
  page,
}) => {
  const disabled = fixture();
  disabled.players[disabled.order[0]].poison = 8;
  const commander = Object.values(disabled.commanders)[0];
  commander.casts = 3;
  const source = Object.values(disabled.commanders).find((entry) => entry.ownerId !== disabled.order[0])!;
  disabled.damageReceived[disabled.order[0]] = { [source.id]: 20 };
  disabled.settings.commander = false;
  disabled.settings.poison = false;
  await importGame(page, disabled);
  await expect(page.locator('.status-chip')).toHaveCount(0);
  const saved = await savedGame(page);
  expect(saved.players[saved.order[0]].poison).toBe(8);
  expect(saved.commanders[commander.id].casts).toBe(3);
  expect(saved.damageReceived[saved.order[0]][source.id]).toBe(20);

  await page.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  const ended = structuredClone(disabled);
  ended.settings.commander = true;
  ended.settings.poison = true;
  ended.status = 'ended';
  ended.endedAt = Date.now();
  ended.timer.pausedAt = ended.endedAt;
  ended.players[ended.order[0]].eliminated = true;
  await importGame(page, ended);
  const tile = page.locator('.player-tile').first();
  await expect(chip(tile, 'poison').locator('.status-chip-value')).toHaveText('8');
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('20');
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+6', '+0']);
  await expect(page.getByRole('button', { name: "Decrease Mira's life", exact: true })).toBeDisabled();
  await chip(tile, 'tax').first().click();
  await expect(page.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
});

test('approved room players receive the same live badges and can only change their permitted seat', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const response = host.waitForResponse(
      (result) => result.url().endsWith('/api/rooms') && result.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await response).json()) as RoomView;
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/u }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    const source = Object.values(room.game!.commanders).find(
      (commander) => commander.ownerId === room.game!.order[0],
    )!;
    await guest.getByRole('button', { name: 'Rowan details', exact: true }).click();
    await setPoison(guest, 3);
    await closePlayer(guest, 'Rowan');
    const guestTile = guest.locator('.player-tile').nth(1);
    await chip(guestTile, 'commander-damage').click();
    await expect(
      guest
        .getByRole('group', { name: 'Combat damage source', exact: true })
        .getByRole('button', { name: /^Rowan:/u }),
    ).toHaveCount(0);
    await guest
      .getByRole('button', { name: `Host: ${source.label}, 0 damage recorded`, exact: true })
      .click();
    await guest.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill('7');
    await guest.getByRole('checkbox', { name: 'Also subtract this much life', exact: true }).uncheck();
    await guest.getByRole('button', { name: 'Apply damage', exact: true }).click();
    await expect(guest.getByRole('dialog')).toHaveCount(0);
    await chip(guestTile, 'tax').click();
    await guest.getByRole('button', { name: 'Record cast', exact: true }).click();
    await expect(guest.locator('.commander-casts .tax')).toContainText('+2');
    await guest.getByRole('button', { name: 'Close Commander tax', exact: true }).click();
    for (const device of [host, guest]) {
      const tile = device.locator('.player-tile').nth(1);
      await expect(chip(tile, 'poison').locator('.status-chip-value')).toHaveText('3');
      await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('7');
      await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText('+2');
      await expect(device.getByTestId('life-1')).toHaveText('40');
    }
    await guest.getByRole('button', { name: 'Host details', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Increase poison', exact: true })).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Record combat damage', exact: true })).toBeDisabled();
    await closePlayer(guest, 'Host');
    await chip(guest.locator('.player-tile').first(), 'commander-damage').click();
    await expect(
      guest.getByRole('button', { name: `Host: ${source.label}, 0 damage recorded`, exact: true }),
    ).toHaveCount(0);
    await guest
      .getByRole('group', { name: 'Combat damage source', exact: true })
      .getByRole('button')
      .first()
      .click();
    await expect(guest.getByRole('button', { name: 'Apply damage', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Close Commander damage', exact: true }).click();
    await chip(guest.locator('.player-tile').first(), 'tax').click();
    await expect(guest.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Close Commander tax', exact: true }).click();
    // Host privileges also do not grant another player's quick controls.
    await chip(host.locator('.player-tile').nth(1), 'tax').click();
    await expect(host.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
    await host.getByRole('button', { name: 'Close Commander tax', exact: true }).click();
    await guest.reload();
    await expect(chip(guest.locator('.player-tile').nth(1), 'tax').locator('.status-chip-value')).toHaveText(
      '+2',
    );
    await guest.getByRole('button', { name: 'My seat', exact: true }).click();
    const mine = guest.locator('.my-view .player-tile');
    await expect(mine).toHaveCount(1);
    await expect(mine.locator('.status-chip')).toHaveCount(3);
    await expect(chip(mine, 'poison').locator('.status-chip-value')).toHaveText('3');
    await expect(chip(mine, 'commander-damage').locator('.status-chip-value')).toHaveText('7');
    const bounds = await mine.evaluate((tile) => {
      const player = tile.getBoundingClientRect();
      const statuses = tile.querySelector('.player-statuses')!.getBoundingClientRect();
      return {
        inside:
          statuses.left >= player.left &&
          statuses.right <= player.right &&
          statuses.top >= player.top &&
          statuses.bottom <= player.bottom,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(bounds).toEqual({ inside: true, horizontalOverflow: false });
    await guest.screenshot({ path: test.info().outputPath('status-my-seat.png') });
    await guest.getByRole('button', { name: "Decrease Rowan's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('39');
  } finally {
    await guestContext.close();
  }
});

test('quick damage saves life and the selected source together, remembers each seat, and preserves undo', async ({
  page,
}) => {
  const game = fixture();
  await importGame(page, game);
  const tile = page.locator('.player-tile').first();
  const shortcut = chip(tile, 'commander-damage');
  await shortcut.click();
  const panel = page.getByRole('dialog', { name: 'Commander damage', exact: true });
  const apply = panel.getByRole('button', { name: 'Apply damage', exact: true });
  await expect(apply).toBeDisabled();
  await panel
    .getByRole('button', { name: 'Rowan: Lathril, Blade of the Elves, 0 damage recorded', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Increase damage amount', exact: true }).click();
  await panel.getByRole('button', { name: 'Increase damage amount', exact: true }).click();
  const amount = panel.getByRole('spinbutton', { name: 'Damage amount', exact: true });
  await expect(amount).toHaveValue('3');
  await panel.getByRole('button', { name: 'Decrease damage amount', exact: true }).click();
  await expect(amount).toHaveValue('2');
  for (const invalid of ['0', '-1', '1.5', '1000000', '']) {
    await amount.fill(invalid);
    await expect(apply).toBeDisabled();
  }
  await amount.fill('7');
  await expect(panel.locator('.quick-damage-preview')).toContainText('40 → 33');
  const audit = await new AxeBuilder({ page })
    .include('.sheet')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('quick-commander-damage.png') });
  await apply.click();
  await expect(panel).toHaveCount(0);
  await expect(shortcut).toBeFocused();
  await expect(page.getByTestId('life-0')).toHaveText('33');
  await expect(shortcut.locator('.status-chip-value')).toHaveText('7');
  const after = await savedGame(page);
  expect(after.revision).toBe(game.revision + 1);
  expect(Object.values(after.damageReceived[game.order[0]])).toEqual([7]);
  await shortcut.click();
  await expect(
    panel.getByRole('button', { name: 'Rowan: Lathril, Blade of the Elves, 7 damage recorded', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await amount.fill('4');
  await panel.getByRole('checkbox', { name: 'Also subtract this much life', exact: true }).uncheck();
  await apply.click();
  await expect(panel).toHaveCount(0);
  await expect(shortcut.locator('.status-chip-value')).toHaveText('11');
  await expect(page.getByTestId('life-0')).toHaveText('33');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shortcut.locator('.status-chip-value')).toHaveText('7');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shortcut.locator('.status-chip-value')).toHaveText('0');
  await expect(page.getByTestId('life-0')).toHaveText('40');
  await chip(page.locator('.player-tile').nth(1), 'commander-damage').click();
  await expect(panel.getByRole('button', { pressed: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Commander damage', exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await shortcut.click();
  await expect(
    panel.getByRole('button', { name: 'Rowan: Lathril, Blade of the Elves, 0 damage recorded', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    panel.getByRole('checkbox', { name: 'Also subtract this much life', exact: true }),
  ).toBeChecked();
  await page.goBack();
  await expect(panel).toHaveCount(0);
});

test('damage controls exclude each recipient’s own commanders and ignore a remembered own source', async ({
  page,
}) => {
  await importGame(page, fixture());
  const game = await savedGame(page);
  for (const playerId of game.order.slice(0, 2)) {
    const player = game.players[playerId];
    const owned = Object.values(game.commanders).filter((entry) => entry.ownerId === playerId);
    const opponents = game.order
      .filter((id) => id !== playerId)
      .flatMap((id) => Object.values(game.commanders).filter((entry) => entry.ownerId === id));
    await page.evaluate(
      ({ gameId, playerId, commanderId }) => {
        sessionStorage.setItem(`mtg-util:damage-source:${gameId}:${playerId}`, commanderId);
      },
      { gameId: game.id, playerId, commanderId: owned[0].id },
    );
    const tile = page.locator('.player-tile').nth(game.order.indexOf(playerId));
    await chip(tile, 'commander-damage').click();
    const panel = page.getByRole('dialog', { name: 'Commander damage', exact: true });
    const sources = panel.getByRole('group', { name: 'Combat damage source', exact: true });
    await expect(sources.getByRole('button')).toHaveCount(opponents.length);
    for (const commander of owned) {
      await expect(
        sources.getByRole('button', {
          name: `${player.name}: ${commander.label}, 0 damage recorded`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await expect(sources.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Apply damage', exact: true })).toBeDisabled();
    await sources.getByRole('button').first().click();
    await panel.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill('2');
    await panel.getByRole('button', { name: 'Apply damage', exact: true }).click();
    await expect(tile.locator('.status-chip[data-status="commander-damage"] .status-chip-value')).toHaveText(
      '2',
    );

    await page.getByRole('button', { name: `${player.name} details`, exact: true }).click();
    const source = page.getByRole('combobox', { name: 'Combat damage source', exact: true });
    expect(
      await source
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(opponents.map((commander) => commander.id));
    await expect(source).toHaveValue(opponents[0].id);
    await page.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
    await page.getByText('Correct recorded totals', { exact: false }).click();
    await expect(page.locator('.damage-correction')).toHaveCount(opponents.length);
    for (const commander of owned) {
      await expect(
        page.getByRole('spinbutton', {
          name: `${commander.label} recorded damage`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    const correction = page.locator('.damage-correction').first();
    await expect(correction.getByRole('spinbutton')).toHaveValue('5');
    await correction.getByRole('spinbutton').fill('4');
    await correction.getByRole('button', { name: 'Correct', exact: true }).click();
    await expect(correction).toContainText('4 recorded');
    await closePlayer(page, player.name);
    await expect(chip(tile, 'tax')).toHaveCount(owned.length);
    await expect(page.getByTestId(`life-${game.order.indexOf(playerId)}`)).toHaveText('35');
    expect((await savedGame(page)).damageReceived[playerId]).toEqual({ [opponents[0].id]: 4 });
  }
});

test('a solo seat cannot record commander damage and retains its own partner tax controls', async ({
  page,
}) => {
  const setup = defaultSetup(1);
  setup.seats[0].commanders = ['Solo commander', 'Solo partner'];
  const game = createGame(setup, newId, Date.now());
  const playerId = game.order[0];
  const owned = Object.values(game.commanders);
  // Older backups remain readable, but self-damage no longer produces badges or warnings.
  game.damageReceived[playerId] = { [owned[0].id]: 30 };
  await importGame(page, game);
  const tile = page.locator('.player-tile').first();
  await expect(chip(tile, 'commander-damage').locator('.status-chip-value')).toHaveText('0');
  await expect(chip(tile, 'commander-damage')).not.toHaveClass(/is-warning/u);
  await chip(tile, 'commander-damage').click();
  await expect(page.getByText('No opposing commanders are available.', { exact: true })).toBeVisible();
  await expect(page.locator('.commander-source')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply damage', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Damage amount', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close Commander damage', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await expect(page.getByText('No opposing commanders are available.', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Combat damage source', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Record combat damage', exact: true })).toBeDisabled();
  await expect(page.locator('.damage-correction')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record cast', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Record cast', exact: true }).first().click();
  await expect(page.locator('.commander-casts').first().locator('.tax')).toContainText('+2');
  await closePlayer(page, 'Player 1');
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+2', '+0']);
  expect((await savedGame(page)).damageReceived).toEqual(game.damageReceived);
  await expect(page.getByTestId('life-0')).toHaveText('40');
});

test('quick tax opens the tapped partner and records or corrects their casts independently', async ({
  page,
}) => {
  await importGame(page, fixture());
  const tile = page.locator('.player-tile').first();
  await chip(tile, 'tax').nth(1).click();
  const panel = page.getByRole('dialog', { name: 'Commander tax', exact: true });
  await expect(panel.getByRole('heading', { name: 'Thrasios, Triton Hero', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Record cast', exact: true }).click();
  await expect(panel.locator('.tax')).toContainText('+2');
  await panel.getByRole('button', { name: 'Mira: Tymna the Weaver, tax +0', exact: true }).click();
  await panel.getByRole('button', { name: 'Record cast', exact: true }).click();
  await expect(panel.locator('.tax')).toContainText('+2');
  await panel.getByRole('button', { name: 'Record cast', exact: true }).click();
  await expect(panel.locator('.tax')).toContainText('+4');
  await page.screenshot({ path: test.info().outputPath('quick-commander-tax.png') });
  await panel.locator('summary').filter({ hasText: 'Correct casts' }).click();
  await panel.getByRole('spinbutton', { name: 'Previous command-zone casts', exact: true }).fill('1');
  await panel.getByRole('button', { name: 'Correct casts', exact: true }).click();
  await expect(panel.locator('.tax')).toContainText('+2');
  await page.getByRole('button', { name: 'Close Commander tax', exact: true }).click();
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+2', '+2']);
  await expect(page.getByTestId('life-0')).toHaveText('40');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(chip(tile, 'tax').locator('.status-chip-value')).toHaveText(['+4', '+2']);
});

test('quick damage retains the draft and every total when the durable save fails', async ({ page }) => {
  await importGame(page, fixture());
  const before = await savedGame(page);
  await chip(page.locator('.player-tile').first(), 'commander-damage').click();
  const panel = page.getByRole('dialog', { name: 'Commander damage', exact: true });
  await panel
    .getByRole('button', { name: 'Rowan: Lathril, Blade of the Elves, 0 damage recorded', exact: true })
    .click();
  await panel.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill('6');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const result = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (this.name === 'records' && key === 'active') {
        IDBObjectStore.prototype.put = original;
        this.transaction.abort();
      }
      return result;
    };
  });
  await panel.getByRole('button', { name: 'Apply damage', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Damage was not confirmed');
  await expect(panel.getByRole('spinbutton', { name: 'Damage amount', exact: true })).toHaveValue('6');
  await expect(panel.getByRole('button', { name: 'Apply damage', exact: true })).toBeDisabled();
  expect(await savedGame(page)).toEqual(before);
  await page.getByRole('button', { name: 'Close Commander damage', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('40');
});

test('status rows with partner artwork remain legible and leave touch controls usable on narrow and shared tables', async ({
  page,
  context,
}, info) => {
  await mockArtwork(context);
  const game = fixture(8);
  for (const [index, id] of game.order.entries()) {
    game.players[id].name = index === 0 ? 'Mira with a long name around the table' : `Player ${index + 1}`;
    game.players[id].poison = index === 0 ? 999999 : 4;
    const own = Object.values(game.commanders).filter((commander) => commander.ownerId === id);
    for (const [partner, commander] of own.entries()) {
      commander.card = { ...artwork, name: commander.label };
      commander.casts = index === 0 ? 999999 - partner : 1;
    }
    const source = Object.values(game.commanders).find((commander) => commander.ownerId !== id)!;
    game.damageReceived[id] = { [source.id]: index === 0 ? 999999 : 8 };
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await importGame(page, game);
  await expect(page.locator('.commander-backdrop img')).toHaveCount(9);
  const original = await savedGame(page);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 844) {
      await page.getByRole('button', { name: 'Game menu', exact: true }).click();
      await page.getByRole('button', { name: 'Table layout', exact: true }).click();
      await page.getByRole('button', { name: /Shared table Lay it sideways/u }).click();
      await page.getByRole('button', { name: 'Back to game', exact: true }).click();
      await expect(page.locator('.tile-content[data-facing="across"]')).toHaveCount(4);
    }
    const measurements = await page.locator('.player-tile').evaluateAll((tiles) => {
      const overlap = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      return tiles.map((tile) => {
        const bounds = tile.getBoundingClientRect();
        const row = tile.querySelector<HTMLElement>('.player-statuses')!;
        const box = row.getBoundingClientRect();
        const controls = tile.querySelector('.life-controls')!.getBoundingClientRect();
        const chips = [...row.querySelectorAll<HTMLElement>('.status-chip')];
        return {
          rowInside:
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom,
          overlappingControls: overlap(box, controls),
          clippedValues: chips.some((badge) => {
            const value = badge.querySelector<HTMLElement>('.status-chip-value')!;
            return value.scrollWidth > value.clientWidth + 1;
          }),
          clippedRow: row.scrollWidth > row.clientWidth + 1 || row.scrollHeight > row.clientHeight + 1,
        };
      });
    });
    expect(measurements).toEqual(
      Array.from({ length: 8 }, () => ({
        rowInside: true,
        overlappingControls: false,
        clippedValues: false,
        clippedRow: false,
      })),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`status-table-${viewport.width}.png`) });
  }
  expect(await savedGame(page)).toEqual(original);
  const first = game.players[game.order[0]].name;
  await page.getByRole('button', { name: `Decrease ${first}'s life`, exact: true }).tap();
  await page.getByRole('button', { name: "Increase Player 8's life", exact: true }).tap();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByTestId('life-7')).toHaveText('41');
  await page.bringToFront();
  const audit = await new AxeBuilder({ page })
    .include('.board')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes }))).toEqual([]);
});

test('four normal badges fit on one line and all four seats stay reachable on a short landscape phone', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const orientation = new EventTarget();
    Object.defineProperty(orientation, 'type', { value: 'landscape-primary' });
    Object.defineProperty(screen, 'orientation', { configurable: true, value: orientation });
  });
  await page.setViewportSize({ width: 568, height: 320 });
  const game = fixture();
  const playerId = game.order[0];
  game.players[playerId].poison = 3;
  const owned = Object.values(game.commanders).filter((commander) => commander.ownerId === playerId);
  owned[0].casts = 1;
  owned[1].casts = 2;
  const source = Object.values(game.commanders).find((commander) => commander.ownerId !== playerId)!;
  game.damageReceived[playerId] = { [source.id]: 8 };
  await importGame(page, game);
  const board = page.locator('.board');
  await expect(board).toHaveAttribute('data-layout', 'shared');
  await expect(board.locator('[data-facing="across"]')).toHaveCount(2);
  await expect(board.locator('.player-tile').first().locator('.status-chip')).toHaveCount(4);
  const geometry = await board.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const tiles = [...element.querySelectorAll('.player-tile')].map((tile) => tile.getBoundingClientRect());
    const chips = [...element.querySelector('.player-tile')!.querySelectorAll('.status-chip')].map((badge) =>
      badge.getBoundingClientRect(),
    );
    return {
      oneLine:
        Math.max(...chips.map((box) => box.top + box.height / 2)) -
          Math.min(...chips.map((box) => box.top + box.height / 2)) <
        1,
      noScroll: element.scrollHeight <= element.clientHeight + 1,
      allVisible: tiles.every(
        (box) =>
          box.left >= bounds.left &&
          box.right <= bounds.right &&
          box.top >= bounds.top &&
          box.bottom <= bounds.bottom + 1 &&
          box.top >= 0 &&
          box.bottom <= innerHeight,
      ),
    };
  });
  expect(geometry).toEqual({ oneLine: true, noScroll: true, allVisible: true });
  await page.screenshot({ path: info.outputPath('status-four-seats-short-landscape.png') });
  await page.getByRole('button', { name: "Decrease Mira's life", exact: true }).tap();
  await page.getByRole('button', { name: "Increase Player 4's life", exact: true }).tap();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByTestId('life-3')).toHaveText('41');
});
