import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Game, RoomView } from '../../src/shared/schema.js';

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

async function startLocal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('40');
}

async function openGroupLife(page: Page) {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Group life change', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Group life change', exact: true })).toBeVisible();
}

async function createRoom(page: Page): Promise<RoomView> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = (await (await response).json()) as RoomView;
  await expect(page.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  return room;
}

async function roomGame(page: Page, id: string): Promise<Game> {
  return ((await (await page.request.get(`/api/rooms/${id}`)).json()) as RoomView).game!;
}

test('opponents lose life while the caster stays safe, explicit gain is a total, and one undo survives reload', async ({
  page,
}) => {
  await startLocal(page);
  const before = await savedGame(page);
  await openGroupLife(page);
  const caster = page.getByRole('combobox', { name: 'Caster', exact: true });
  const apply = page.getByRole('button', { name: /^Apply to/ });
  await expect(apply).toBeDisabled();
  await caster.selectOption({ label: 'Player 1' });
  const opponents = page.getByRole('group', { name: 'Opponents affected', exact: true });
  await expect(opponents.getByRole('checkbox')).toHaveCount(3);
  await expect(opponents.getByRole('checkbox', { name: /^Player 1\b/ })).toHaveCount(0);
  for (const checkbox of await opponents.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
  await page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true }).fill('3');
  await expect(page.locator('.group-life-caster')).toContainText('40 → 40');
  await expect(page.locator('.group-life-caster')).toContainText('unchanged');
  await apply.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('40');
  for (const index of [1, 2, 3]) await expect(page.getByTestId(`life-${index}`)).toHaveText('37');
  const lossOnly = await savedGame(page);
  expect(lossOnly.history).toHaveLength(1);
  expect(lossOnly.undo).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await savedGame(page)).players).toEqual(before.players);

  await openGroupLife(page);
  await caster.selectOption({ label: 'Player 1' });
  await page.getByRole('checkbox', { name: 'Caster gains life', exact: true }).check();
  await page.getByRole('spinbutton', { name: /^Total life gained by caster/ }).fill('9');
  await caster.selectOption({ label: 'Player 2' });
  await expect(page.getByRole('checkbox', { name: 'Caster gains life', exact: true })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: /^Total life gained by caster/ })).toHaveCount(0);
  await expect(opponents.getByRole('checkbox', { name: /^Player 2\b/ })).toHaveCount(0);
  await caster.selectOption({ label: 'Player 1' });
  await opponents.getByRole('checkbox', { name: /^Player 4\b/ }).uncheck();
  await page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true }).fill('5');
  await page.getByRole('checkbox', { name: 'Caster gains life', exact: true }).check();
  const gain = page.getByRole('spinbutton', { name: /^Total life gained by caster/ });
  await expect(gain).toHaveValue('0');
  await gain.fill('7');
  await expect(page.locator('.group-life-caster')).toContainText('40 → 47');
  await expect(apply).toHaveText('Apply to 2 opponents');
  await apply.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('47');
  await expect(page.getByTestId('life-1')).toHaveText('35');
  await expect(page.getByTestId('life-2')).toHaveText('35');
  await expect(page.getByTestId('life-3')).toHaveText('40');
  const changed = await savedGame(page);
  expect(changed.commanders).toEqual(before.commanders);
  expect(changed.damageReceived).toEqual(before.damageReceived);
  expect(changed.undo).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await savedGame(page)).players).toEqual(before.players);
});

test('invalid amounts and empty selections cannot submit, and the narrow form is accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await startLocal(page);
  const before = await savedGame(page);
  await openGroupLife(page);
  const caster = page.getByRole('combobox', { name: 'Caster', exact: true });
  await caster.focus();
  await expect(caster).toBeFocused();
  await caster.selectOption({ label: 'Player 1' });
  const opponents = page.getByRole('group', { name: 'Opponents affected', exact: true });
  const apply = page.getByRole('button', { name: /^Apply to/ });
  for (const checkbox of await opponents.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(apply).toBeDisabled();
  await opponents.getByRole('checkbox', { name: /^Player 2\b/ }).check();
  const loss = page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true });
  for (const value of ['0', '-1', '1.5', '1000000', '']) {
    await loss.fill(value);
    await expect(apply).toBeDisabled();
  }
  await loss.fill('2');
  await page.getByRole('checkbox', { name: 'Caster gains life', exact: true }).check();
  const gain = page.getByRole('spinbutton', { name: /^Total life gained by caster/ });
  await gain.fill('999999');
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('supported range');
  await gain.fill('3');
  await expect(apply).toBeEnabled();
  await page.bringToFront();
  await expect(page.locator('html')).toHaveAttribute('data-hidden', 'false');
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(await savedGame(page)).toEqual(before);
});

test('a failed durable write preserves every total and locks direct retry until a fresh review', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startLocal(page);
  const before = await savedGame(page);
  const casterId = before.order[0];
  await openGroupLife(page);
  await page.getByRole('combobox', { name: 'Caster', exact: true }).selectOption(casterId);
  await page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true }).fill('4');
  await page.evaluate(
    ({ casterId }) => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        const request = original.call(this, value, key);
        const record = value as { game?: Game };
        if (
          this.name === 'records' &&
          key === 'active' &&
          record.game?.history.at(-1)?.summary.includes('lost 4 life each') &&
          record.game.players[casterId].life === 40
        ) {
          IDBObjectStore.prototype.put = original;
          this.transaction.abort();
        }
        return request;
      };
    },
    { casterId },
  );
  const apply = page.getByRole('button', { name: /^Apply to/ });
  await apply.click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('not confirmed');
  await expect(apply).toBeDisabled();
  expect(await savedGame(page)).toEqual(before);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Group life change', exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true }).fill('2');
  await expect(apply).toBeDisabled();
  await page.getByRole('button', { name: 'Clear and review a new effect', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Caster', exact: true })).toHaveValue('');
  await expect(apply).toBeDisabled();
  await page.getByRole('combobox', { name: 'Caster', exact: true }).selectOption(casterId);
  await page.getByRole('spinbutton', { name: 'Life lost per selected opponent', exact: true }).fill('4');
  await apply.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('40');
  await expect(page.getByTestId('life-1')).toHaveText('36');
  const changed = await savedGame(page);
  expect(changed.revision).toBe(before.revision + 1);
  expect(changed.history).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('room players and hosts cannot apply group effects to other players’ totals', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  try {
    const room = await createRoom(host);
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Pick your place.', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    const before = await roomGame(host, room.id);
    for (const device of [host, guest]) {
      await device.getByRole('button', { name: 'Utilities', exact: true }).click();
      await expect(device.getByRole('button', { name: 'Group life change', exact: true })).toBeDisabled();
      await device.getByRole('button', { name: 'Close A little luck & magic', exact: true }).click();
      for (const index of [0, 1, 2, 3]) await expect(device.getByTestId(`life-${index}`)).toHaveText('40');
    }
    expect(await roomGame(host, room.id)).toEqual(before);
  } finally {
    await guestContext.close();
  }
});
