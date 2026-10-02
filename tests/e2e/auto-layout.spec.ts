import { expect, test, type Page } from '@playwright/test';
import type { Game, RoomView } from '../../src/shared/schema.js';

type RotationProbe = Window & { rotateDevice: (landscape: boolean) => void };

// Real device rotation changes the physical screen, unlike the keyboard resizing
// only the visual/layout viewport. Keep those signals independent in both engines.
async function deviceOrientation(
  page: Page,
  landscape = false,
  coarse = true,
  source: 'native' | 'legacy' | 'screen' = 'native',
) {
  await page.addInitScript(
    ({ initialLandscape, coarsePointer, orientationSource }) => {
      let sideways = sessionStorage.getItem('test-device-landscape') === 'true';
      if (sessionStorage.getItem('test-device-landscape') === null) sideways = initialLandscape;
      const orientation = new EventTarget();
      Object.defineProperty(orientation, 'type', {
        get: () => (sideways ? 'landscape-primary' : 'portrait-primary'),
      });
      Object.defineProperty(orientation, 'angle', { get: () => (sideways ? 90 : 0) });
      Object.defineProperty(screen, 'orientation', {
        configurable: true,
        value: orientationSource === 'native' ? orientation : undefined,
      });
      Object.defineProperty(screen, 'width', {
        configurable: true,
        get: () => (sideways && orientationSource !== 'legacy' ? 844 : 390),
      });
      Object.defineProperty(screen, 'height', {
        configurable: true,
        get: () => (sideways && orientationSource !== 'legacy' ? 390 : 844),
      });
      Object.defineProperty(window, 'orientation', {
        configurable: true,
        get: () => (orientationSource === 'screen' ? undefined : sideways ? 90 : 0),
      });
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const media = matchMedia(query);
        if (/\((?:any-)?pointer:\s*coarse\)/.test(query))
          Object.defineProperty(media, 'matches', { get: () => coarsePointer });
        return media;
      };
      (window as unknown as RotationProbe).rotateDevice = (next) => {
        sideways = next;
        sessionStorage.setItem('test-device-landscape', String(next));
        orientation.dispatchEvent(new Event('change'));
        window.dispatchEvent(new Event('orientationchange'));
      };
    },
    { initialLandscape: landscape, coarsePointer: coarse, orientationSource: source },
  );
  await page.setViewportSize(landscape ? { width: 844, height: 390 } : { width: 390, height: 844 });
}

async function rotate(page: Page, landscape: boolean) {
  await page.evaluate((next) => (window as unknown as RotationProbe).rotateDevice(next), landscape);
  await page.setViewportSize(landscape ? { width: 844, height: 390 } : { width: 390, height: 844 });
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

async function openLayout(page: Page) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Table layout', exact: true }).click();
}

test('mobile rotation follows the device on first load and reload without changing the game', async ({
  page,
}) => {
  await deviceOrientation(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  const board = page.locator('.board');
  await expect(board).toHaveAttribute('data-layout', 'shared');
  await expect(board.locator('[data-facing="across"]')).toHaveCount(2);
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).tap();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByRole('button', { name: 'Increase poison', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Mira');
  await page.getByLabel('Commander 1 name', { exact: true }).fill('Tymna the Weaver');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close Mira', exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const game = await savedGame(page);
  for (const landscape of [false, true, false]) {
    await rotate(page, landscape);
    await expect(board).toHaveAttribute('data-layout', landscape ? 'shared' : 'upright');
    await expect(board.locator('[data-facing="across"]')).toHaveCount(landscape ? 2 : 0);
    expect(await savedGame(page)).toEqual(game);
    await page.reload();
    await expect(board).toHaveAttribute('data-layout', landscape ? 'shared' : 'upright');
    await expect(page.getByRole('button', { name: 'Mira details', exact: true })).toBeVisible();
    expect(await savedGame(page)).toEqual(game);
  }
});

test('a portrait keyboard resize does not switch layouts or interrupt player editing', async ({ page }) => {
  await deviceOrientation(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  await page.getByText('Edit player & commanders', { exact: true }).click();
  const name = page.getByLabel('Player name', { exact: true });
  await name.focus();
  await page.setViewportSize({ width: 390, height: 280 });
  await name.fill('Keyboard edit');
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await expect(page.locator('.board [data-facing="across"]')).toHaveCount(0);
  await expect(name).toHaveValue('Keyboard edit');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close Keyboard edit', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
});

for (const source of ['legacy', 'screen'] as const) {
  test(`mobile rotation uses the ${source} fallback without treating keyboard resize as rotation`, async ({
    page,
  }) => {
    await deviceOrientation(page, true, true, source);
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
    // The legacy mock deliberately keeps screen.width/height portrait, so the
    // legacy angle must take priority when the native Orientation API is absent.
    await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
    await rotate(page, false);
    await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
    await page.setViewportSize({ width: 390, height: 280 });
    await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
    await rotate(page, true);
    await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
    await page.reload();
    await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  });
}

test('manual layouts persist and the rotation toggle can restore or freeze automatic facing', async ({
  page,
}) => {
  await deviceOrientation(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await openLayout(page);
  const automatic = page.getByRole('checkbox', { name: 'Follow device rotation', exact: true });
  await expect(automatic).toBeChecked();
  await page.getByRole('button', { name: /All facing me Hold the phone/ }).click();
  await expect(automatic).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await rotate(page, false);
  await rotate(page, true);
  await page.reload();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await openLayout(page);
  await expect(automatic).not.toBeChecked();
  await automatic.check();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  await rotate(page, false);
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await openLayout(page);
  await automatic.uncheck();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await rotate(page, true);
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await openLayout(page);
  await automatic.check();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
});

test('old fixed layouts adopt device rotation and a later seat flip remains remembered', async ({ page }) => {
  await deviceOrientation(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  const game = await savedGame(page);
  await page.evaluate(async (ids) => {
    const request = indexedDB.open('mtg-util', 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const read = store.get('profile');
    read.onsuccess = () => {
      const profile = read.result;
      delete profile.rotationDefaultsVersion;
      profile.autoTableLayout = false;
      profile.tableLayout = 'shared';
      profile.rotations = Object.fromEntries(ids.map((id) => [id, true]));
      store.put(profile, 'profile');
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, game.order);
  await page.reload();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await expect(page.locator('.board [data-facing="across"]')).toHaveCount(0);
  await openLayout(page);
  await expect(page.getByRole('checkbox', { name: 'Follow device rotation', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await rotate(page, true);
  await expect(page.locator('.board [data-facing="across"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  const flip = page.getByRole('checkbox', { name: 'Face this seat across the table', exact: true });
  await expect(flip).toBeChecked();
  await flip.uncheck();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await rotate(page, false);
  await page.reload();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  const tiles = page.locator('.board .tile-content');
  await expect(tiles.nth(0)).toHaveAttribute('data-facing', 'near');
  await expect(tiles.nth(1)).toHaveAttribute('data-facing', 'across');
  await expect(tiles.nth(2)).toHaveAttribute('data-facing', 'near');
  await expect(tiles.nth(3)).toHaveAttribute('data-facing', 'near');
  await openLayout(page);
  const automatic = page.getByRole('checkbox', { name: 'Follow device rotation', exact: true });
  await expect(automatic).not.toBeChecked();
  await automatic.check();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await expect(page.locator('.board [data-facing="across"]')).toHaveCount(0);
  expect(await savedGame(page)).toEqual(game);
});

test('desktop resizing and screen orientation do not replace the chosen layout', async ({ page }) => {
  await deviceOrientation(page, true, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await rotate(page, false);
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await openLayout(page);
  await page.getByRole('button', { name: /Shared table Lay it sideways/ }).click();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await rotate(page, true);
  await page.setViewportSize({ width: 900, height: 1440 });
  await page.reload();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
});

test('rotating cancels a held life counter before its repeat can follow the moving seat', async ({
  page,
}) => {
  await deviceOrientation(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life', exact: true }).click();
  const minus = page.getByRole('button', { name: "Decrease Player 1's life", exact: true });
  const box = (await minus.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  // No viewport resize or pointer-up: cancellation must come from the app's
  // orientation change handling, not an injected browser pointercancel.
  await page.evaluate(() => (window as unknown as RotationProbe).rotateDevice(true));
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  await page.waitForTimeout(650);
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await page.mouse.up();
});

test('room phones rotate independently while My seat and guest edit permissions stay intact', async ({
  page: host,
  browser,
}) => {
  const guestContext = await browser.newContext({ hasTouch: true, isMobile: true });
  const guest = await guestContext.newPage();
  try {
    await deviceOrientation(host);
    await deviceOrientation(guest, true);
    await host.goto('/');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = host.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST',
    );
    await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
    const room = (await (await created).json()) as RoomView;
    await guest.goto(room.joinUrl!);
    await guest.getByRole('textbox', { name: /^Your display name/ }).fill('Rowan');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await expect(host.locator('.board')).toHaveAttribute('data-layout', 'upright');
    await expect(guest.locator('.board')).toHaveAttribute('data-layout', 'shared');
    await guest.getByRole('button', { name: "Decrease Rowan's life", exact: true }).tap();
    await expect(host.getByTestId('life-1')).toHaveText('39');
    const before = (await (await guest.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    await guest.getByRole('button', { name: 'My seat', exact: true }).click();
    await expect(guest.locator('.my-view .tile-content')).toHaveAttribute('data-facing', 'near');
    await rotate(host, true);
    await rotate(guest, false);
    await expect(host.locator('.board')).toHaveAttribute('data-layout', 'shared');
    await expect(guest.locator('.my-view .tile-content')).toHaveAttribute('data-facing', 'near');
    await rotate(guest, true);
    await expect(guest.locator('.my-view .tile-content')).toHaveAttribute('data-facing', 'near');
    await guest.getByRole('button', { name: 'Table view', exact: true }).click();
    await rotate(guest, false);
    await expect(guest.locator('.board')).toHaveAttribute('data-layout', 'upright');
    await expect(host.locator('.board')).toHaveAttribute('data-layout', 'shared');
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await expect(guest.getByRole('button', { name: "Decrease Host's life", exact: true })).toBeDisabled();
    const after = (await (await guest.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(after.game).toEqual(before.game);
    expect(after.me).toEqual(before.me);
  } finally {
    await guestContext.close();
  }
});
