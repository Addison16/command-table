/** Original Commander-and-mana artwork shared by the UI, app icon and recap. */
export const emblemSize = 128;
export const emblemPalette = {
  background: '#090d14',
  gold: '#d9b96f',
  goldLight: '#f5deb0',
  card: '#17202b',
  sun: '#f1dfa8',
  water: '#86c7e8',
  skull: '#c6bfd8',
  flame: '#ef9875',
  tree: '#9ac9a4',
} as const;

export type EmblemPath = {
  id: string;
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: 'evenodd' | 'nonzero';
  opacity?: number;
  monochrome: 'fill' | 'stroke' | 'omit';
};

const number = (value: number) => Number(value.toFixed(3));
const point = (x: number, y: number) => `${number(x)} ${number(y)}`;
const circle = (x: number, y: number, radius: number) =>
  `M${point(x + radius, y)}A${radius} ${radius} 0 1 0 ${point(x - radius, y)}A${radius} ${radius} 0 1 0 ${point(x + radius, y)}Z`;
const polygon = (cx: number, cy: number, points: readonly (readonly [number, number])[]) =>
  `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${point(cx + x, cy + y)}`).join('')}Z`;

/** Every medallion, including its outline, fits inside the maskable safe circle. */
export const emblemMedallions = [
  { id: 'sun', cx: 64, cy: 27, color: emblemPalette.sun, plate: '#2b2b24', rim: '#c8b582' },
  { id: 'water', cx: 99.19, cy: 52.57, color: emblemPalette.water, plate: '#182c3c', rim: '#6ca5c1' },
  { id: 'skull', cx: 85.75, cy: 93.93, color: emblemPalette.skull, plate: '#292634', rim: '#9a91b0' },
  { id: 'flame', cx: 42.25, cy: 93.93, color: emblemPalette.flame, plate: '#37241f', rim: '#c48765' },
  { id: 'tree', cx: 28.81, cy: 52.57, color: emblemPalette.tree, plate: '#20332a', rim: '#79a28a' },
] as const;

function sun(cx: number, cy: number) {
  const rays = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * Math.PI) / 4;
    const ray = [
      [5.9, -1],
      [9, 0],
      [5.9, 1],
    ] as const;
    return polygon(
      cx,
      cy,
      ray.map(([x, y]) => [
        x * Math.cos(angle) - y * Math.sin(angle),
        x * Math.sin(angle) + y * Math.cos(angle),
      ]),
    );
  });
  return `${circle(cx, cy, 4.7)}${rays.join('')}`;
}

function glyph(id: (typeof emblemMedallions)[number]['id'], cx: number, cy: number) {
  const at = (x: number, y: number) => point(cx + x, cy + y);
  if (id === 'sun') return sun(cx, cy);
  if (id === 'water') {
    return `M${at(0, -9)}C${at(-2.5, -5.3)} ${at(-6.5, -1.3)} ${at(-6.5, 2.6)}C${at(-6.5, 10.2)} ${at(6.5, 10.2)} ${at(6.5, 2.6)}C${at(6.5, -1.3)} ${at(2.5, -5.3)} ${at(0, -9)}Z`;
  }
  if (id === 'skull') {
    return `M${at(-7, -1)}C${at(-7, -10)} ${at(7, -10)} ${at(7, -1)}C${at(7, 1.8)} ${at(5.4, 3.6)} ${at(3.8, 4.1)}L${at(3.8, 7)}H${number(cx - 3.8)}V${number(cy + 4.1)}C${at(-5.4, 3.6)} ${at(-7, 1.8)} ${at(-7, -1)}Z${circle(cx - 2.8, cy - 0.8, 1.7)}${circle(cx + 2.8, cy - 0.8, 1.7)}${polygon(
      cx,
      cy,
      [
        [0, 1.5],
        [-1.5, 3.7],
        [1.5, 3.7],
      ],
    )}`;
  }
  if (id === 'flame') {
    return `M${at(-6.7, 2.2)}C${at(-6.7, -1.6)} ${at(-2.9, -4.2)} ${at(-3.5, -7.1)}C${at(-0.3, -5.8)} ${at(0.8, -3.9)} ${at(0.3, -1.6)}C${at(4.1, -3.7)} ${at(3.3, -6.7)} ${at(2.1, -9)}C${at(7.1, -6)} ${at(7, -0.2)} ${at(6.4, 2.9)}C${at(5.3, 9.5)} ${at(-6.7, 9.4)} ${at(-6.7, 2.2)}Z`;
  }
  return polygon(cx, cy, [
    [0, -9],
    [-5.4, -3],
    [-2.8, -3],
    [-7.1, 2],
    [-3.9, 2],
    [-8.1, 6],
    [-1.6, 6],
    [-1.6, 9],
    [1.6, 9],
    [1.6, 6],
    [8.1, 6],
    [3.9, 2],
    [7.1, 2],
    [2.8, -3],
    [5.4, -3],
  ]);
}

const cardOutline = 'M53 43H75A6 6 0 0 1 81 49V81A6 6 0 0 1 75 87H53A6 6 0 0 1 47 81V49A6 6 0 0 1 53 43Z';
const cardInset = 'M54 47H74A3 3 0 0 1 77 50V80A3 3 0 0 1 74 83H54A3 3 0 0 1 51 80V50A3 3 0 0 1 54 47Z';

/** Absolute paths, in paint order; Canvas consumers can use Path2D directly. */
export const emblemPaths: readonly EmblemPath[] = [
  {
    id: 'mana-orbit',
    d: circle(64, 64, 37),
    fill: 'none',
    stroke: emblemPalette.gold,
    strokeWidth: 1.8,
    opacity: 0.4,
    monochrome: 'stroke',
  },
  ...emblemMedallions.flatMap(({ id, cx, cy, color, plate, rim }): EmblemPath[] => [
    { id: `${id}-plate`, d: circle(cx, cy, 12), fill: plate, monochrome: 'omit' },
    {
      id: `${id}-rim`,
      d: circle(cx, cy, 12),
      fill: 'none',
      stroke: rim,
      strokeWidth: 1.7,
      monochrome: 'stroke',
    },
    { id: `${id}-glyph`, d: glyph(id, cx, cy), fill: color, fillRule: 'evenodd', monochrome: 'fill' },
  ]),
  { id: 'commander-card', d: cardOutline, fill: emblemPalette.card, monochrome: 'omit' },
  {
    id: 'commander-rim',
    d: `${cardOutline}${cardInset}`,
    fill: emblemPalette.gold,
    fillRule: 'evenodd',
    monochrome: 'fill',
  },
  {
    id: 'commander-highlight',
    d: 'M53 43H75A6 6 0 0 1 81 49M47 69V49A6 6 0 0 1 53 43',
    fill: 'none',
    stroke: emblemPalette.goldLight,
    strokeWidth: 1.3,
    opacity: 0.75,
    monochrome: 'omit',
  },
  {
    id: 'commander-crown',
    d: 'M53 56L58 61L64 52L70 61L75 56L73 70H55Z M64 60L66.1 63L64 66L61.9 63Z',
    fill: emblemPalette.goldLight,
    fillRule: 'evenodd',
    monochrome: 'fill',
  },
  { id: 'commander-band', d: 'M55 72H73V74H55Z', fill: emblemPalette.gold, monochrome: 'fill' },
  {
    id: 'commander-text',
    d: 'M56 78H72',
    fill: 'none',
    stroke: emblemPalette.gold,
    strokeWidth: 1.8,
    opacity: 0.8,
    monochrome: 'stroke',
  },
];
