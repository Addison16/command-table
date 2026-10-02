import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import type { CommanderCard } from '../../src/shared/cards.js';
import type { RoomView } from '../../src/shared/schema.js';

test.use({ serviceWorkers: 'block' });

async function createRoom(host: Page, commander = true) {
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  if (!commander)
    await host.getByRole('combobox', { name: 'Game preset', exact: true }).selectOption('20-life game');
  if (!commander) await expect(host.getByLabel('Commander 1 name', { exact: true })).toHaveCount(0);
  const response = host.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  return (await (await response).json()) as RoomView;
}
async function join(guest: Page, url: string, name: string) {
  await guest.goto(url);
  await guest.getByLabel('Your display name').fill(name);
  await guest.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(guest.getByRole('heading', { name: 'Pick your place.' })).toBeVisible();
}

test('the host chooses their name and commanders and starts in their own reserved seat', async ({
  page: host,
  context,
}) => {
  const card: CommanderCard = {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Tymna the Weaver',
    imageUrl: 'https://cards.scryfall.io/art_crop/front/1/2/12345678-1234-4234-8234-123456789abc.jpg',
    scryfallUrl: 'https://scryfall.com/card/test/1/tymna-the-weaver',
    artist: 'Fixture Artist',
  };
  await context.route('**/api/cards/**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/suggest') ? { names: [card.name] } : { card },
    }),
  );
  await context.route('https://cards.scryfall.io/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: readFileSync(new URL('../../public/icon-192.png', import.meta.url)),
    }),
  );
  await host.goto('/');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  const profile = host.getByRole('group', { name: 'Your player', exact: true });
  await expect(profile).toBeVisible();
  await profile.getByRole('textbox', { name: /^Your display name/ }).fill('Mira');
  await profile.getByLabel('Commander 1 name', { exact: true }).fill('Tymna');
  await profile.getByRole('button', { name: card.name, exact: true }).click();
  await expect(profile.getByRole('img', { name: `${card.name} artwork`, exact: true })).toBeVisible();
  await profile.getByRole('checkbox', { name: 'Two commanders / partners', exact: true }).check();
  await profile.getByLabel('Commander 2 name', { exact: true }).fill('Thrasios, Triton Hero');
  const response = host.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await host.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = (await (await response).json()) as RoomView;
  expect(room.me.seatId).toBe(room.seats[0].id);
  expect(room.seats[0]).toMatchObject({ name: 'Mira', taken: true });
  expect(room.seats.slice(1).every((seat) => !seat.taken)).toBe(true);
  expect(Object.values(room.game!.commanders).filter((entry) => entry.ownerId === room.me.seatId)).toEqual([
    expect.objectContaining({ label: card.name, card }),
    expect.objectContaining({ label: 'Thrasios, Triton Hero' }),
  ]);
  await expect(host.getByRole('button', { name: "Decrease Mira's life", exact: true })).toBeEnabled();
  await host.reload();
  await expect(host.getByRole('button', { name: "Decrease Mira's life", exact: true })).toBeEnabled();
  await host.getByRole('button', { name: 'Mira details', exact: true }).click();
  await host.getByText('Edit player & commanders', { exact: true }).click();
  await expect(host.getByLabel('Commander 1 name', { exact: true })).toHaveValue(card.name);
  await expect(host.getByLabel('Commander 2 name', { exact: true })).toHaveValue('Thrasios, Triton Hero');
});

test('joining players choose their name and partners, revise a pending request, and keep control after refresh', async ({
  page: host,
  browser,
}, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  try {
    const room = await createRoom(host);
    await host.getByRole('button', { name: "Decrease Host's life", exact: true }).click();
    await expect(host.getByTestId('life-0')).toHaveText('39');
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await join(guest, room.joinUrl!, 'Alex');
    await expect(guest.locator('.lobby-seat').filter({ hasText: 'Host' }).getByRole('button')).toBeDisabled();
    await expect(guest.getByLabel('Player name', { exact: true })).toHaveValue('Alex');
    await guest.getByLabel('Player name', { exact: true }).fill('Rowan');
    await guest.getByLabel('Commander 1 name', { exact: true }).fill('Tymna the Weaver');
    await guest.getByRole('checkbox', { name: 'Two commanders / partners' }).check();
    await guest.getByLabel('Commander 2 name', { exact: true }).fill('Thrasios, Triton Hero');
    const audit = await new AxeBuilder({ page: guest }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await expect(guest.getByRole('button', { name: 'Requested', exact: true })).toBeDisabled();
    await expect(host.locator('.seat-request-preview')).toContainText(
      'Rowan · Tymna the Weaver + Thrasios, Triton Hero',
    );
    await guest.getByLabel('Commander 2 name', { exact: true }).fill('Kraum, Ludevic’s Opus');
    await guest.getByRole('button', { name: 'Update request', exact: true }).click();
    await expect(host.locator('.seat-request-preview')).toContainText('Kraum, Ludevic’s Opus');
    await guest.reload();
    await expect(guest.getByLabel('Player name', { exact: true })).toHaveValue('Rowan');
    await expect(guest.getByLabel('Commander 2 name', { exact: true })).toHaveValue('Kraum, Ludevic’s Opus');
    await expect(guest.locator('.board')).toHaveCount(0);
    await guest.setViewportSize({ width: 320, height: 568 });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name === 'chromium-phone')
      await guest.screenshot({ path: 'docs/screenshots/join-player-setup.png', fullPage: true });
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await expect(guest.getByTestId('life-0')).toHaveText('39');
    await expect(guest.getByTestId('life-1')).toHaveText('40');
    await host.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Rowan details', exact: true })).toBeVisible();
    const current = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    const originals = Object.values(room.game!.commanders).filter((c) => c.ownerId === room.seats[1].id);
    expect(current.game!.commanders[originals[0].id].label).toBe('Tymna the Weaver');
    expect(
      Object.values(current.game!.commanders).filter((c) => c.ownerId === room.seats[1].id),
    ).toHaveLength(2);
    await guest.getByRole('button', { name: 'Rowan details', exact: true }).click();
    await guest.getByText('Edit player & commanders', { exact: true }).click();
    await expect(guest.getByLabel('Commander 1 name', { exact: true })).toHaveValue('Tymna the Weaver');
    await expect(guest.getByLabel('Commander 2 name', { exact: true })).toHaveValue('Kraum, Ludevic’s Opus');
    await guest.getByLabel('Commander 1 name', { exact: true }).fill('Tymna');
    await guest.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(
        async () =>
          ((await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView).game!.commanders[
            originals[0].id
          ].label,
      )
      .toBe('Tymna');
    await guest.reload();
    await expect(guest.getByRole('button', { name: "Decrease Rowan's life", exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: "Decrease Rowan's life", exact: true }).click();
    await expect(host.getByTestId('life-1')).toHaveText('39');
    await guest.getByRole('button', { name: 'Host details', exact: true }).click();
    await guest.getByText('Edit player & commanders', { exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('joining a 20-life room uses the chosen name without asking for commanders', async ({
  page: host,
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  try {
    const room = await createRoom(host, false);
    await host.getByRole('button', { name: 'Live room', exact: true }).click();
    await join(guest, room.joinUrl!, 'Nissa');
    await expect(guest.getByLabel('Player name', { exact: true })).toHaveValue('Nissa');
    await expect(guest.getByLabel('Commander 1 name', { exact: true })).toHaveCount(0);
    await expect(guest.getByRole('checkbox', { name: 'Two commanders / partners' })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Request seat', exact: true }).first().click();
    await expect(host.locator('.seat-request-preview')).toHaveText('Nissa');
    await host.getByRole('button', { name: 'Approve seat', exact: true }).click();
    await expect(guest.getByRole('button', { name: "Decrease Nissa's life", exact: true })).toBeEnabled();
    await expect(guest.getByTestId('life-1')).toHaveText('20');
    const current = (await (await host.request.get(`/api/rooms/${room.id}`)).json()) as RoomView;
    expect(current.game!.commanders).toEqual(room.game!.commanders);
    expect(current.game!.settings.commander).toBe(false);
  } finally {
    await context.close();
  }
});
