// Regenerate with: node --experimental-strip-types scripts/generate-emblem.mjs
import { writeFile } from 'node:fs/promises';
import { emblemPaths, emblemPalette, emblemSize } from '../src/client/brand/emblem.ts';

const paths = emblemPaths
  .map((shape) => {
    const attributes = [
      ['id', shape.id],
      ['d', shape.d],
      ['fill', shape.fill],
      ['stroke', shape.stroke],
      ['stroke-width', shape.strokeWidth],
      ['fill-rule', shape.fillRule],
      ['opacity', shape.opacity],
    ]
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}="${value}"`)
      .join(' ');
    return `    <path ${attributes}/>`;
  })
  .join('\n');

await writeFile(
  new URL('../public/icon.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${emblemSize} ${emblemSize}">\n` +
    `  <rect width="${emblemSize}" height="${emblemSize}" fill="${emblemPalette.background}"/>\n` +
    `  <g id="emblem-art" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n  </g>\n</svg>\n`,
);
