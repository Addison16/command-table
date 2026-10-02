import { networkInterfaces } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { buildApp } from '../dist/server/server/app.js';
import { readConfig } from '../dist/server/server/config.js';

const host =
  process.env.LAN_HOST ??
  Object.values(networkInterfaces())
    .flat()
    .find(
      (ip) =>
        ip &&
        !ip.internal &&
        ip.family === 'IPv4' &&
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.address),
    )?.address;
if (!host) throw new Error('Set LAN_HOST to this computer’s LAN IPv4 address.');
const config = readConfig({
  PUBLIC_ORIGIN: `http://${host}:8080`,
  ALLOW_INSECURE_HTTP: 'true',
  NODE_ENV: 'production',
});
const { app } = await buildApp({ config, filename: ':memory:' });
await app.listen({ host: '0.0.0.0', port: 0 });
config.publicOrigin = `http://${host}:${app.server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(config.publicOrigin);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await page.getByRole('button', { name: 'Quick 2 · 20 life' }).click();
  await page.getByRole('button', { name: "Decrease Player 1's life" }).click();
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('life-0')).toHaveText('19');
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  const room = await (await created).json();
  // Creating a room starts a fresh setup instead of reusing the local 20-life game.
  expect(room.game.settings.startingLife).toBe(40);
  expect(room.seats).toHaveLength(4);
  await expect(page.getByTestId('life-0')).toHaveText('40');
  await page.getByRole('button', { name: 'Live room', exact: true }).click();
  expect(new URL(await page.getByLabel('Join link', { exact: true }).inputValue()).origin).toBe(
    config.publicOrigin,
  );
  await page.getByRole('button', { name: 'Close Invite your table', exact: true }).click();
  await page.getByRole('button', { name: "Decrease Host's life" }).click();
  await expect
    .poll(async () => {
      const result = await page.request.get(`${config.publicOrigin}/api/rooms/${room.id}`);
      return (await result.json()).game.players[room.seats[0].id].life;
    })
    .toBe(39);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Live room', exact: true })).toBeVisible();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  console.info(
    'PASS: actual HTTP LAN origin, insecure-context ID fallback, IndexedDB resume, guest cookie, public invitation address and shared update/reconnect. This is a desktop browser, not a physical-phone check.',
  );
} finally {
  await browser.close();
  await app.close();
}
