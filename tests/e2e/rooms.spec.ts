import { test, expect } from '@playwright/test';
import type { RoomView } from '../../src/shared/schema.js';
test('independent browsers control only their own seats, converge and reconnect', async ({
  page: host,
  browser,
}) => {
  const errors: string[] = [];
  host.on('pageerror', (e) => errors.push(e.message));
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await host.getByLabel('Your display name').fill('Mira');
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await expect(host.getByRole('button', { name: "Decrease Mira's life" })).toBeEnabled();
  await expect(host.getByRole('button', { name: "Decrease Player 2's life" })).toBeDisabled();
  await host.getByRole('button', { name: 'Live room', exact: true }).click();
  const url = await host.getByLabel('Join link', { exact: true }).inputValue();
  await guest.goto(url);
  await guest.getByLabel('Your display name').fill('Alex');
  await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(guest.getByText('Pick your place.')).toBeVisible();
  expect(await guest.locator('.life-total').count()).toBe(0);
  await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
  await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
  await expect(guest.getByTestId('life-1')).toHaveText('40');
  await expect(guest.getByRole('button', { name: "Decrease Mira's life" })).toBeDisabled();
  await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
  await expect(host.getByRole('button', { name: "Decrease Alex's life" })).toBeDisabled();
  for (const [viewer, other] of [
    [host, 'Alex'],
    [guest, 'Mira'],
  ] as const) {
    await viewer.getByRole('button', { name: `${other} details`, exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Decrease life', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Increase poison', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Record cast', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Record combat damage', exact: true })).toBeDisabled();
    await viewer.getByText('Edit player & commanders', { exact: true }).click();
    await expect(viewer.getByRole('textbox', { name: 'Player name', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('textbox', { name: 'Commander 1 name', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await viewer.getByRole('button', { name: `Close ${other}`, exact: true }).click();
  }
  await Promise.all([
    host.getByRole('button', { name: "Decrease Mira's life" }).click(),
    guest.getByRole('button', { name: "Decrease Alex's life" }).click(),
  ]);
  for (const device of [host, guest]) {
    await expect(device.getByTestId('life-0')).toHaveText('39');
    await expect(device.getByTestId('life-1')).toHaveText('39');
  }
  await guestContext.setOffline(true);
  await expect(guest.getByText('Reconnecting — changes paused', { exact: false })).toBeVisible({
    timeout: 40000,
  });
  await expect(guest.getByRole('button', { name: "Decrease Alex's life" })).toBeDisabled();
  await host.getByRole('button', { name: "Decrease Mira's life" }).click();
  await guestContext.setOffline(false);
  await expect(guest.getByTestId('life-0')).toHaveText('38');
  await expect(guest.getByTestId('life-1')).toHaveText('39');
  await expect(guest.getByRole('button', { name: "Decrease Alex's life" })).toBeEnabled();
  await guest.reload();
  await expect(guest.getByTestId('life-0')).toHaveText('38');
  await expect(guest.getByTestId('life-1')).toHaveText('39');
  await expect(guest.getByRole('button', { name: "Decrease Alex's life" })).toBeEnabled();
  await guest.getByRole('button', { name: 'My seat', exact: true }).click();
  await expect(guest.locator('.my-view')).toBeVisible();
  await host.getByRole('button', { name: 'Utilities', exact: true }).click();
  await host.getByRole('button', { name: 'Roll 1d20', exact: true }).click();
  await expect(host.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(guest.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(guest.locator('.die')).toHaveText((await host.locator('.die').textContent()) ?? '');
  await guest.getByRole('button', { name: 'Back to game', exact: true }).click();
  await host.getByRole('button', { name: 'Back to game', exact: true }).click();
  await guest.getByRole('button', { name: 'Utilities', exact: true }).click();
  await guest.getByRole('button', { name: 'd20 for everyone', exact: true }).click();
  await expect(guest.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'false');
  await expect(guest.locator('.winner-name')).toHaveCount(0);
  await expect(host.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(guest.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
  await expect(guest.locator('.winner-name')).toHaveText((await host.locator('.winner-name').textContent())!);
  await guest.getByRole('button', { name: 'Back to game', exact: true }).click();
  await guest.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await guest.getByRole('button', { name: 'Quick 2 · 20 life', exact: true }).click();
  await guest.getByRole('button', { name: 'Home & recent games', exact: true }).click();
  await guest.getByRole('button', { name: /^Resume shared room:/ }).click();
  await expect(guest.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await expect(guest.locator('.my-view')).toBeVisible();
  await expect(guest.getByTestId('life-1')).toHaveText('39');
  await expect(guest.getByRole('button', { name: "Decrease Alex's life" })).toBeEnabled();
  expect(errors).toEqual([]);
  await guestContext.close();
});
test('refresh after a lost acknowledgement retries the original durable operation once', async ({ page }) => {
  let drop = false,
    lostOperation = '';
  await page.routeWebSocket('**/api/rooms/**/live?*', (route) => {
    const server = route.connectToServer();
    route.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'command' && msg.envelope.command.type === 'adjust') {
        drop = true;
        lostOperation = msg.envelope.operationId;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (drop && ['ack', 'state'].includes(msg.type)) return;
      route.send(raw);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = (await (await response).json()) as RoomView;
  await expect(page.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await page.getByRole('button', { name: "Decrease Host's life" }).click();
  await expect.poll(() => lostOperation).not.toBe('');
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/rooms/${room.id}`)).json()) as RoomView).game!.players[
          room.seats[0].id
        ].life,
    )
    .toBe(39);
  drop = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  const pending = await page.evaluate(async (id) => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = db.transaction('records').objectStore('records').get(`pending:${id}`);
    return await new Promise<unknown[]>((resolve) => {
      read.onsuccess = () => resolve(read.result ?? []);
    });
  }, room.id);
  expect(pending).toHaveLength(0);
});

test('automatic reconnect reconciles a lost acknowledgement without repeating the player’s change', async ({
  page,
}) => {
  let lostOperation = '';
  let lostAcknowledgement = false;
  await page.routeWebSocket('**/api/rooms/**/live?*', (route) => {
    const server = route.connectToServer();
    let hiddenOperation = '';
    route.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (!lostOperation && message.type === 'command' && message.envelope.command.type === 'adjust') {
        lostOperation = hiddenOperation = message.envelope.operationId;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (hiddenOperation && ['ack', 'state'].includes(message.type)) {
        if (message.receipt?.operationId === hiddenOperation) {
          lostAcknowledgement = true;
          void route.close({ code: 1012, reason: 'Test disconnect after durable server commit' });
          void server.close();
        }
        return;
      }
      route.send(raw);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = (await (await created).json()) as RoomView;
  await page.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
  await expect.poll(() => lostAcknowledgement).toBe(true);
  await expect(page.getByRole('button', { name: "Decrease Host's life", exact: true })).toBeEnabled({
    timeout: 15000,
  });
  await expect(page.getByTestId('life-0')).toHaveText('39');
  const changed = ((await (await page.request.get(`/api/rooms/${room.id}`)).json()) as RoomView).game!;
  expect(changed.players[changed.order[0]].life).toBe(39);
  expect(changed.order.slice(1).map((id) => changed.players[id].life)).toEqual([40, 40, 40]);
  expect(changed.history.filter((entry) => entry.operationId === lostOperation)).toHaveLength(1);
  expect(changed.history).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  expect(((await (await page.request.get(`/api/rooms/${room.id}`)).json()) as RoomView).game).toEqual(
    changed,
  );
});
