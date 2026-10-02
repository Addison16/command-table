import { test, expect, type Page } from '@playwright/test';
import type { Game } from '../../src/shared/schema.js';

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

async function startWithPartners(page: Page) {
  await page.context().route('**/api/cards/**', (route) => route.fulfill({ json: { names: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await page.getByText('Names, colors & commanders', { exact: false }).click();
  await page
    .locator('.seat-form')
    .first()
    .getByRole('combobox', { name: 'Commanders', exact: true })
    .selectOption('2');
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('40');
}

async function editDraft(page: Page, name: string, color: string, commanders: [string, string]) {
  const editor = page.locator('.edit-player');
  await editor.getByRole('textbox', { name: 'Player name', exact: true }).fill(name);
  await editor.getByRole('combobox', { name: 'Player color', exact: true }).selectOption(color);
  await editor.getByRole('textbox', { name: 'Commander 1 name', exact: true }).fill(commanders[0]);
  await editor.getByRole('textbox', { name: 'Commander 2 name', exact: true }).fill(commanders[1]);
}

async function expectDraft(page: Page, name: string, color: string, commanders: [string, string]) {
  const editor = page.locator('.edit-player');
  await expect(editor.getByRole('textbox', { name: 'Player name', exact: true })).toHaveValue(name);
  await expect(editor.getByRole('combobox', { name: 'Player color', exact: true })).toHaveValue(color);
  await expect(editor.getByRole('textbox', { name: 'Commander 1 name', exact: true })).toHaveValue(
    commanders[0],
  );
  await expect(editor.getByRole('textbox', { name: 'Commander 2 name', exact: true })).toHaveValue(
    commanders[1],
  );
}

test('one Save changes persists the player and both commanders, and one undo restores them without losing play', async ({
  page,
}) => {
  await startWithPartners(page);
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page
    .locator('.commander-casts')
    .first()
    .getByRole('button', { name: 'Record cast', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Damage amount', exact: true }).fill('5');
  await page.getByRole('button', { name: 'Record combat damage', exact: true }).click();
  await expect
    .poll(async () => {
      const game = await savedGame(page);
      return game.players[game.order[0]].life;
    })
    .toBe(34);
  const before = await savedGame(page);
  const playerId = before.order[0];
  const commanders = Object.values(before.commanders).filter((commander) => commander.ownerId === playerId);
  expect(commanders).toHaveLength(2);
  expect(commanders[0].casts).toBe(1);
  const source = Object.values(before.commanders).find((commander) => commander.ownerId !== playerId)!;
  expect(before.damageReceived[playerId][source.id]).toBe(5);
  await page.getByText('Edit player & commanders', { exact: true }).click();
  const editor = page.locator('.edit-player');
  await expect(editor.locator('form')).toHaveCount(1);
  await expect(editor.getByRole('button', { name: /^Save/ })).toHaveCount(1);
  await editDraft(page, 'Rowan', 'teal', ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
  expect(await savedGame(page)).toEqual(before);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('Changes saved.');
  const edited = await savedGame(page);
  expect(edited.revision).toBe(before.revision + 1);
  expect(edited.history).toHaveLength(before.history.length + 1);
  expect(edited.undo).toHaveLength(before.undo.length + 1);
  expect(edited.players[playerId]).toEqual({ ...before.players[playerId], name: 'Rowan', color: 'teal' });
  expect(edited.commanders[commanders[0].id]).toEqual({ ...commanders[0], label: 'Tymna the Weaver' });
  expect(edited.commanders[commanders[1].id]).toEqual({ ...commanders[1], label: 'Kraum, Ludevic’s Opus' });
  expect(edited.damageReceived).toEqual(before.damageReceived);
  await page.getByRole('button', { name: 'Close Rowan', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('34');
  await expect(page.locator('.player-tile').first()).toHaveClass(/\bteal\b/);
  await page.getByRole('button', { name: 'Rowan details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await expectDraft(page, 'Rowan', 'teal', ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
  await page.getByRole('button', { name: 'Close Rowan', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Player 1 details', exact: true })).toBeVisible();
  await expect(page.getByTestId('life-0')).toHaveText('34');
  const undone = await savedGame(page);
  expect(undone.players).toEqual(before.players);
  expect(undone.commanders).toEqual(before.commanders);
  expect(undone.damageReceived).toEqual(before.damageReceived);
});

test('a rejected durable save keeps every draft and retry commits the complete player profile once', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startWithPartners(page);
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  const before = await savedGame(page);
  const playerId = before.order[0];
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await editDraft(page, 'Retry Rowan', 'rose', ['My first commander', 'My second commander']);
  await page.evaluate(
    ({ playerId }) => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        const request = original.call(this, value, key);
        const record = value as { game?: Game };
        if (
          this.name === 'records' &&
          key === 'active' &&
          record.game?.players[playerId]?.name === 'Retry Rowan'
        ) {
          // Fail the actual transaction once, including its checkpoint write.
          // Lease renewals and unrelated preference writes remain unaffected.
          IDBObjectStore.prototype.put = original;
          this.transaction.abort();
        }
        return request;
      };
    },
    { playerId },
  );
  const editor = page.locator('.edit-player');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Your edits are still here.');
  await expectDraft(page, 'Retry Rowan', 'rose', ['My first commander', 'My second commander']);
  expect(await savedGame(page)).toEqual(before);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('Changes saved.');
  const saved = await savedGame(page);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.history).toHaveLength(before.history.length + 1);
  expect(saved.players[playerId]).toEqual({
    ...before.players[playerId],
    name: 'Retry Rowan',
    color: 'rose',
  });
  expect(
    Object.values(saved.commanders)
      .filter((commander) => commander.ownerId === playerId)
      .map((commander) => commander.label),
  ).toEqual(['My first commander', 'My second commander']);
  await page.getByRole('button', { name: 'Close Retry Rowan', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await page.getByRole('button', { name: 'Retry Rowan details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await expectDraft(page, 'Retry Rowan', 'rose', ['My first commander', 'My second commander']);
  expect(errors).toEqual([]);
});
