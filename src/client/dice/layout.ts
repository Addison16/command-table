export type SafeInsets = { top: number; right: number; bottom: number; left: number };

/**
 * Columns for the settled grid. Up to ten dice form the squarest grid, so a
 * four-player table settles 2×2, six 3×2 and nine 3×3. Larger rolls follow
 * the tray's proportions instead.
 */
export function diceColumns(count: number, trayWidth: number, trayHeight: number) {
  if (count > 10) return Math.max(2, Math.round(Math.sqrt((count * trayWidth) / trayHeight)));
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/** Share of the distance from the tray center to its grid cell at release. */
const GATHER = 0.45;

/**
 * Dice tumble together in the middle of the tray, then glide out to their
 * grid cells while they settle. The result is exactly the cell at the end.
 */
export function dieAnchor(
  center: [number, number],
  target: [number, number],
  elapsed: number,
  duration: number,
): [number, number] {
  const p = Math.max(0, Math.min(1, (elapsed - duration * 0.3) / (duration * 0.5)));
  const glide = GATHER + (1 - GATHER) * p * p * (3 - 2 * p);
  return [center[0] + (target[0] - center[0]) * glide, center[1] + (target[1] - center[1]) * glide];
}
