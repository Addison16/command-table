import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openLayout(page: Page) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Table layout', exact: true }).click();
}

test('shared table faces both sides, enlarges touch controls and remembers local choices', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
  await openLayout(page);
  await page.getByRole('button', { name: /Shared table Lay it sideways/ }).click();
  await expect(page.getByRole('button', { name: /Shared table Lay it sideways/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  const tiles = page.locator('.tile-content');
  await expect(tiles.nth(0)).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await expect(tiles.nth(1)).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await expect(tiles.nth(2)).toHaveCSS('transform', 'none');
  await expect(tiles.nth(3)).toHaveCSS('transform', 'none');
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    for (const button of await page.locator('.board .hold').all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(64);
      expect(box.height).toBeGreaterThanOrEqual(52);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    const dimensions = await page.locator('.board').evaluate((board) => ({
      height: board.clientHeight,
      content: board.scrollHeight,
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.height + 1);
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width);
    if (info.project.name === 'chromium-phone')
      await page.screenshot({ path: `docs/screenshots/shared-table-${viewport.width}.png` });
  }
  // Touch both a far-side and near-side counter; their player IDs stay fixed.
  await page.getByRole('button', { name: "Decrease Player 1's life", exact: true }).tap();
  await page.getByRole('button', { name: "Increase Player 4's life", exact: true }).tap();
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByTestId('life-3')).toHaveText('41');
  await expect(page.getByText('Saved here', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'shared');
  await expect(page.getByTestId('life-0')).toHaveText('39');
  await expect(page.getByTestId('life-3')).toHaveText('41');
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(tiles.nth(0)).toHaveAttribute('data-facing', 'across');
  await page.getByRole('button', { name: 'Player 1 details', exact: true }).click();
  const flip = page.getByRole('checkbox', { name: 'Face this seat across the table', exact: true });
  await expect(flip).toBeChecked();
  await flip.uncheck();
  await page.getByRole('button', { name: 'Close Player 1', exact: true }).click();
  await expect(tiles.nth(0)).toHaveAttribute('data-facing', 'near');
  await expect(tiles.nth(1)).toHaveAttribute('data-facing', 'across');
  await openLayout(page);
  await page.getByRole('button', { name: /All facing me Hold the phone/ }).click();
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-layout', 'upright');
  await expect(page.locator('[data-facing="across"]')).toHaveCount(0);
  await expect(page.getByTestId('life-0')).toHaveText('39');
});

type Draw = {
  text: string;
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
  faceX: number;
  faceY: number;
};
type Probe = Window & { diceDraw: Draw[]; diceSample: number };

async function installDiceProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as Probe;
    probe.diceDraw = [];
    probe.diceSample = 19;
    const random = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: Uint32Array<ArrayBuffer>) => {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = probe.diceSample;
          return array;
        }
        return random(array);
      },
    });
    const paths = new WeakMap<CanvasRenderingContext2D, [number, number][]>();
    const centers = new WeakMap<CanvasRenderingContext2D, [number, number]>();
    const proto = CanvasRenderingContext2D.prototype;
    const begin = proto.beginPath;
    proto.beginPath = function () {
      if (this.canvas.classList.contains('dice-canvas')) paths.set(this, []);
      begin.call(this);
    };
    for (const method of ['moveTo', 'lineTo'] as const) {
      const original = proto[method];
      proto[method] = function (x, y) {
        if (this.canvas.classList.contains('dice-canvas')) {
          const matrix = this.getTransform();
          paths
            .get(this)
            ?.push([matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f]);
        }
        original.call(this, x, y);
      };
    }
    const clip = proto.clip;
    proto.clip = function (...args: unknown[]) {
      const points = paths.get(this);
      if (this.canvas.classList.contains('dice-canvas') && points?.length) {
        centers.set(this, [
          points.reduce((sum, point) => sum + point[0], 0) / points.length,
          points.reduce((sum, point) => sum + point[1], 0) / points.length,
        ]);
      }
      Reflect.apply(clip, this, args);
    };
    const clear = proto.clearRect;
    proto.clearRect = function (x, y, width, height) {
      if (this.canvas.classList.contains('dice-canvas')) probe.diceDraw = [];
      clear.call(this, x, y, width, height);
    };
    const fill = proto.fillText;
    proto.fillText = function (text, x, y, maxWidth) {
      if (this.canvas.classList.contains('dice-canvas')) {
        const matrix = this.getTransform();
        const ratio = this.canvas.width / this.canvas.getBoundingClientRect().width;
        const center = centers.get(this) ?? [NaN, NaN];
        probe.diceDraw.push({
          text,
          a: matrix.a,
          b: matrix.b,
          c: matrix.c,
          d: matrix.d,
          x: matrix.e / ratio,
          y: matrix.f / ratio,
          faceX: center[0] / ratio,
          faceY: center[1] / ratio,
        });
      }
      if (maxWidth === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, maxWidth);
    };
  });
}

async function expectUprightFace(page: Page, label: string, centerX: number) {
  await expect
    .poll(() =>
      page.evaluate(
        (text) => (window as unknown as Probe).diceDraw.filter((draw) => draw.text === text).length,
        label,
      ),
    )
    .toBeGreaterThan(0);
  const draws = await page.evaluate(
    (text) => (window as unknown as Probe).diceDraw.filter((draw) => draw.text === text),
    label,
  );
  for (const draw of draws) {
    expect(draw.a).toBeGreaterThan(0);
    expect(draw.d).toBeGreaterThan(0);
    expect(draw.b).toBeCloseTo(0, 5);
    expect(draw.c).toBeCloseTo(0, 5);
    expect(draw.a).toBeCloseTo(draw.d, 5);
    expect(draw.x).toBeCloseTo(centerX, 1);
    // Inspect the actual clipped face, so both axes must center the engraving.
    expect(draw.x).toBeCloseTo(draw.faceX, 5);
    expect(draw.y).toBeCloseTo(draw.faceY, 5);
  }
}

async function expectSettledCanvasStable(page: Page) {
  expect(
    await page.locator('.dice-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!;
      const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return before.length === after.length && before.every((value, index) => value === after[index]);
    }),
  ).toBe(true);
}

test('eight-player narrow landscape tables keep life numbers separate from reachable controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up a game', exact: true }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByRole('button', { name: 'Let’s play', exact: true }).click();
  for (const layout of ['All facing me', 'Shared table']) {
    await openLayout(page);
    await page.getByRole('button', { name: new RegExp(`^${layout}`) }).click();
    await page.getByRole('button', { name: 'Back to game', exact: true }).click();
    // Measure after the seat-facing transition finishes, not mid-rotation.
    for (const [index, content] of (await page.locator('.tile-content').all()).entries()) {
      await expect(content).toHaveCSS(
        'transform',
        layout === 'Shared table' && index < 4 ? 'matrix(-1, 0, 0, -1, 0, 0)' : 'none',
      );
    }
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const tile of await page.locator('.player-tile').all()) {
        await tile.scrollIntoViewIfNeeded();
        const bounds = (await tile.boundingBox())!;
        const number = (await tile.locator('.life-total').boundingBox())!;
        const buttons = await tile.locator('.hold').all();
        const controls = await Promise.all(buttons.map((button) => button.boundingBox()));
        const [left, right] = controls.sort((a, b) => a!.x - b!.x);
        expect(number.x).toBeGreaterThanOrEqual(left!.x + left!.width - 1);
        expect(number.x + number.width).toBeLessThanOrEqual(right!.x + 1);
        for (const control of controls) {
          expect(control!.width).toBeGreaterThanOrEqual(44);
          expect(control!.height).toBeGreaterThanOrEqual(44);
          expect(control!.y).toBeGreaterThanOrEqual(bounds.y - 1);
          expect(control!.y + control!.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
        }
        const caption = tile.locator('.life-caption');
        if (await caption.isVisible()) {
          const label = (await caption.boundingBox())!;
          expect(label.y).toBeGreaterThanOrEqual(bounds.y - 1);
          expect(label.y + label.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
        }
      }
    }
  }
  await page.getByRole('button', { name: "Decrease Player 8's life", exact: true }).click();
  await expect(page.getByTestId('life-7')).toHaveText('39');
  await page.getByRole('button', { name: "Increase Player 1's life", exact: true }).click();
  await expect(page.getByTestId('life-0')).toHaveText('41');
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`settled dice draw exact upright, centered, stable results with ${motion} motion and replay`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await installDiceProbe(page);
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick 4 · 40 life' }).click();
    const cases = [
      { sides: 20, value: 20, labels: ['20'] },
      { sides: 4, value: 4, labels: ['4'] },
      { sides: 6, value: 6, labels: ['6'] },
      { sides: 8, value: 8, labels: ['8'] },
      { sides: 10, value: 10, labels: ['10'] },
      { sides: 12, value: 12, labels: ['12'] },
      { sides: 100, value: 100, labels: ['00', '0'] },
      { sides: 100, value: 47, labels: ['40', '7'] },
      { sides: 2, value: 1, labels: ['H'] },
      { sides: 2, value: 2, labels: ['T'] },
    ];
    for (const { sides, value, labels } of cases) {
      await page.evaluate((value) => {
        const probe = window as unknown as Probe;
        probe.diceDraw = [];
        probe.diceSample = value - 1;
      }, value);
      await page.getByRole('button', { name: 'Utilities', exact: true }).click();
      if (sides === 2) await page.getByRole('button', { name: 'Flip a coin', exact: true }).click();
      else {
        await page.getByRole('button', { name: `d${sides}`, exact: true }).click();
        await page.getByRole('button', { name: `Roll 1d${sides}`, exact: true }).click();
      }
      await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
      for (const [index, label] of labels.entries())
        await expectUprightFace(page, label, page.viewportSize()!.width * ((index + 0.5) / labels.length));
      await expect(page.locator('.rolled-total')).toHaveText(
        sides === 2 ? (value === 1 ? 'Heads' : 'Tails') : String(value),
      );
      await expectSettledCanvasStable(page);
      if (sides === 20 && motion === 'no-preference' && info.project.name === 'chromium-phone')
        await page.screenshot({ path: 'docs/screenshots/dice-upright.png' });
      await page.getByRole('button', { name: 'Back to game', exact: true }).click();
      // History bypasses motion independently of the browser's preference.
      await page.getByRole('button', { name: 'Utilities', exact: true }).click();
      await page.evaluate(() => {
        (window as unknown as Probe).diceDraw = [];
      });
      await page.locator('.roll-history-button').first().click();
      await expect(page.getByTestId('dice-result')).toHaveAttribute('data-revealed', 'true');
      await expect(page.getByRole('button', { name: 'Skip animation', exact: true })).toHaveCount(0);
      for (const [index, label] of labels.entries())
        await expectUprightFace(page, label, page.viewportSize()!.width * ((index + 0.5) / labels.length));
      await expectSettledCanvasStable(page);
      await page.getByRole('button', { name: 'Back to game', exact: true }).click();
    }
  });
}
