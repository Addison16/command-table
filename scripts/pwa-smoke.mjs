import { chromium, webkit, expect } from '@playwright/test';
import { createServer, request } from 'node:http';
import { buildApp } from '../dist/server/server/app.js';
import { readConfig } from '../dist/server/server/config.js';

// Test a real origin outage without relying on a browser's network emulation.
// The forwarding server serves only the already-built application; all private
// requests are disabled along with it when the outage begins.
const config = readConfig({
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'http://127.0.0.1:8080',
  ALLOW_INSECURE_HTTP: 'true',
});
const { app } = await buildApp({ config, filename: ':memory:' });
const upstream = await app.listen({ host: '127.0.0.1', port: 0 });
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    let available = true;
    let update = false;
    const server = createServer((req, res) => {
      if (!available) {
        req.socket.destroy();
        return;
      }
      const requestHeaders = { ...req.headers };
      if (update && req.url === '/sw.js') {
        delete requestHeaders['if-none-match'];
        delete requestHeaders['if-modified-since'];
      }
      const forward = request(
        new URL(req.url, upstream),
        { method: req.method, headers: requestHeaders },
        (response) => {
          if (update && req.url === '/sw.js') {
            const parts = [];
            response.on('data', (chunk) => parts.push(chunk));
            response.on('end', () => {
              const headers = { ...response.headers };
              delete headers['content-length'];
              delete headers.etag;
              res.writeHead(200, headers);
              res.end(Buffer.concat(parts).toString() + '\n// Test a new app version.\n');
            });
            return;
          }
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      forward.on('error', () => res.destroy());
      req.pipe(forward);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(origin);
      await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
      const appearance = async (theme, colorTheme, accentColor, tableFinish) => {
        await page.getByRole('button', { name: 'Game menu', exact: true }).click();
        await page.getByRole('button', { name: 'Display & preferences', exact: true }).click();
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
        await page.getByRole('radio', { name: colorTheme, exact: true }).check();
        await page.getByRole('radio', { name: accentColor, exact: true }).check();
        await page.getByRole('combobox', { name: 'Table background', exact: true }).selectOption(tableFinish);
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem('command-table-appearance')))
          .toBe(theme);
        await expect
          .poll(() =>
            page.evaluate(() => JSON.parse(localStorage.getItem('command-table-style')).tableFinish),
          )
          .toBe(tableFinish);
        await page.getByRole('button', { name: 'Close Your table, your way', exact: true }).click();
      };
      await appearance('dark', 'Arcane', 'Teal', 'aurora');
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.getByRole('button', { name: "Decrease Player 1's life" }).click();
      await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('life-0')).toHaveText('39');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'arcane');
      await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'teal');
      await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'aurora');
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      update = true;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await expect(page.getByRole('button', { name: 'Save & update' })).toBeVisible();
      await expect(page.getByTestId('life-0')).toHaveText('39');
      await page.getByRole('button', { name: 'Save & update' }).click();
      const reloaded = page.waitForEvent('load');
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await reloaded;
      await expect(page.getByTestId('life-0')).toHaveText('39');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      available = false;
      await page.goto(`${origin}/?offline-reopen=1`, { timeout: 15000 });
      await expect(page.getByTestId('life-0')).toHaveText('39');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'arcane');
      await appearance('system', 'Forest', 'Copper', 'gilded');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.getByRole('button', { name: "Decrease Player 1's life" }).click();
      await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
      await page.reload({ timeout: 15000 });
      await expect(page.getByTestId('life-0')).toHaveText('38');
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'forest');
      await expect(page.locator('html')).toHaveAttribute('data-accent-color', 'copper');
      await expect(page.locator('html')).toHaveAttribute('data-table-finish', 'gilded');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      const privateCached = await page.evaluate(async () => {
        for (const name of await caches.keys()) {
          const entries = await (await caches.open(name)).keys();
          if (entries.some((r) => new URL(r.url).pathname.startsWith('/api/'))) return true;
        }
        return false;
      });
      expect(privateCached).toBe(false);
      console.info(
        `PASS (${name}): prompted service-worker update preserves the game and appearance; production shell reopens during a real origin outage; offline appearance follows device changes; local edits survive another reload; no private API cache.`,
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
} finally {
  await app.close();
}
