import { elapsed, teamOf } from '../../shared/game.js';
import type { Game } from '../../shared/schema.js';
import { emblemPaths, emblemSize } from '../brand/emblem.js';

export type Recap = {
  gameId: string;
  final: boolean;
  preset: string;
  at: number;
  duration: string;
  result: string;
  players: {
    id: string;
    name: string;
    color: string;
    life: number;
    commanders: string[];
    eliminated: boolean;
    winner: boolean;
    archenemy?: boolean;
  }[];
  /** Life totals over the game, in player order, when the game recorded them. */
  life?: { from: number; to: number; points: { t: number; l: number[] }[] };
};

/** The recap result that matches a winner recorded during the game. */
export function recordedResult(game: Game): string {
  const result = game.result;
  if (!result) return '';
  if (result.draw) return 'draw';
  if (result.winners.length === 1) return result.winners[0];
  const same = (ids: string[]) =>
    ids.length === result.winners.length && ids.every((id) => result.winners.includes(id));
  if (game.archenemy && same(teamOf(game))) return 'team';
  const team = game.teams?.findIndex(same) ?? -1;
  return team >= 0 ? `team:${team}` : result.winners.length ? 'recorded' : '';
}

export function recapDuration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

// Winner selection belongs to this image only. Life totals and elimination flags
// cannot tell us who won through alternate win conditions, concessions or a draw.
export function createRecap(game: Game, capturedAt: number, result = ''): Recap {
  const final = game.status === 'ended';
  const at = final
    ? (game.endedAt ?? game.timer.pausedAt ?? game.history.at(-1)?.at ?? game.timer.startedAt)
    : capturedAt;
  const winnerId = final && game.order.includes(result) ? result : null;
  // In Archenemy the whole team shares a victory.
  const teamWins = final && result === 'team' && !!game.archenemy;
  // Two-Headed Giant teams, or any winners recorded together during the game.
  const side = !final
    ? []
    : /^team:\d$/.test(result)
      ? (game.teams?.[Number(result.slice(5))] ?? [])
      : result === 'recorded'
        ? (game.result?.winners ?? [])
        : [];
  const log = game.lifeLog ?? [];
  return {
    gameId: game.id,
    final,
    preset: game.settings.preset,
    at,
    duration: recapDuration(elapsed(game, at)),
    result: winnerId
      ? `${game.players[winnerId].name} wins`
      : teamWins
        ? 'The team wins'
        : side.length
          ? `${side.map((id) => game.players[id].name).join(' & ')} win`
          : final && result === 'draw'
            ? 'Draw'
            : '',
    players: game.order.map((id) => ({
      id,
      name: game.players[id].name,
      color: game.players[id].color,
      life: game.players[id].life,
      commanders: game.settings.commander
        ? Object.values(game.commanders)
            .filter((commander) => commander.ownerId === id)
            .map((commander) => commander.label)
        : [],
      eliminated: game.players[id].eliminated,
      winner: id === winnerId || (teamWins && id !== game.archenemy!.playerId) || side.includes(id),
      ...(game.archenemy?.playerId === id ? { archenemy: true } : {}),
    })),
    ...(log.length > 1 && log.every((point) => point.l.length === game.order.length)
      ? { life: { from: log[0].t, to: Math.max(at, log.at(-1)!.t), points: log } }
      : {}),
  };
}

const colors: Record<string, string> = {
  ivory: '#d4c5a0',
  blue: '#9dbfe2',
  violet: '#baa4d5',
  ember: '#e1a283',
  green: '#a4c6a7',
  teal: '#8bc5bf',
  rose: '#d6a0b6',
  copper: '#cca982',
};
const gold = '#d6b66a';
const white = '#f3f0e8';
const muted = '#b6c0ce';
const bodyFont = 'Inter, sans-serif';
const titleFont = '"Cormorant Garamond", serif';

function wrapped(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // Break long uninterrupted names without dropping characters or overflowing.
    for (const character of Array.from(word)) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, r = 22) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

const GRAPH_HEIGHT = 330;
/** A step line per player: life only ever changes at a recorded moment. */
function lifeGraph(ctx: CanvasRenderingContext2D, recap: Recap, y: number) {
  const life = recap.life!;
  const left = 132,
    right = 990,
    top = y + 74,
    bottom = y + GRAPH_HEIGHT - 44;
  ctx.fillStyle = '#ffffff07';
  box(ctx, 62, y, 956, GRAPH_HEIGHT);
  ctx.fill();
  ctx.strokeStyle = '#ffffff18';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = `600 18px ${bodyFont}`;
  ctx.fillText('LIFE OVER THE GAME', 92, y + 44);
  const values = life.points.flatMap((point) => point.l);
  const low = Math.min(0, ...values),
    high = Math.max(1, ...values);
  const span = Math.max(1, life.to - life.from);
  const px = (t: number) =>
    left + ((Math.min(life.to, Math.max(life.from, t)) - life.from) / span) * (right - left);
  const py = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  ctx.font = `400 18px ${bodyFont}`;
  ctx.textAlign = 'right';
  for (const mark of low < 0 ? [low, 0, high] : [0, high]) {
    ctx.fillStyle = muted;
    ctx.fillText(String(mark), left - 14, py(mark) + 6);
    ctx.strokeStyle = '#ffffff14';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, py(mark));
    ctx.lineTo(right, py(mark));
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [index, player] of recap.players.entries()) {
    ctx.strokeStyle = colors[player.color] ?? colors.ivory;
    ctx.lineWidth = player.winner ? 5 : 3;
    ctx.globalAlpha = player.eliminated && !player.winner ? 0.6 : 1;
    ctx.beginPath();
    ctx.moveTo(px(life.points[0].t), py(life.points[0].l[index]));
    for (const [at, point] of life.points.entries()) {
      if (!at) continue;
      ctx.lineTo(px(point.t), py(life.points[at - 1].l[index]));
      ctx.lineTo(px(point.t), py(point.l[index]));
    }
    ctx.lineTo(right, py(life.points.at(-1)!.l[index]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = muted;
  ctx.font = `400 17px ${bodyFont}`;
  ctx.fillText('Start', left, y + GRAPH_HEIGHT - 14);
  ctx.textAlign = 'right';
  ctx.fillText(recap.final ? 'End' : 'Now', right, y + GRAPH_HEIGHT - 14);
  ctx.textAlign = 'left';
}

function sigil(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // Draw the same local vector artwork used by the homepage and install icons.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / emblemSize, size / emblemSize);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const shape of emblemPaths) {
    const path = new Path2D(shape.d);
    ctx.globalAlpha = shape.opacity ?? 1;
    if (shape.fill !== 'none') {
      ctx.fillStyle = shape.fill;
      ctx.fill(path, shape.fillRule ?? 'nonzero');
    }
    if (shape.stroke && shape.stroke !== 'none') {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth ?? 1;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

export async function renderRecap(recap: Recap): Promise<Blob> {
  // Use the bundled fonts when available; the system fallbacks also work offline.
  if (document.fonts) {
    await Promise.allSettled([
      document.fonts.load(`500 64px ${titleFont}`),
      document.fonts.load(`400 26px ${bodyFont}`),
      document.fonts.load(`500 62px ${bodyFont}`),
      document.fonts.load(`600 36px ${bodyFont}`),
    ]);
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the recap image. Try opening it again.');
  ctx.font = `400 27px ${bodyFont}`;
  const rows = recap.players.map((player) => {
    const commanders = player.commanders.flatMap((name) => wrapped(ctx, name, 670));
    return { player, commanders, height: Math.max(174, 105 + commanders.length * 35) };
  });
  canvas.width = 1080;
  canvas.height =
    396 +
    rows.reduce((height, row) => height + row.height + 16, 0) +
    (recap.life ? GRAPH_HEIGHT + 16 : 0) +
    122;
  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#1b283a');
  background.addColorStop(0.45, '#101823');
  background.addColorStop(1, '#090d14');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d6b66a45';
  ctx.lineWidth = 2;
  box(ctx, 25, 25, canvas.width - 50, canvas.height - 50, 30);
  ctx.stroke();
  sigil(ctx, 52, 53, 92);
  ctx.fillStyle = white;
  ctx.font = `500 55px ${titleFont}`;
  ctx.fillText('Command Table', 166, 105);
  ctx.fillStyle = muted;
  ctx.font = `400 21px ${bodyFont}`;
  ctx.fillText('GOOD COMPANY. GREAT GAMES.', 168, 138);
  ctx.fillStyle = gold;
  ctx.font = `500 76px ${titleFont}`;
  ctx.fillText(recap.final ? 'A game to remember.' : 'Around the table.', 62, 236);
  ctx.fillStyle = muted;
  ctx.font = `400 26px ${bodyFont}`;
  const date = new Date(recap.at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  ctx.fillText(`${recap.preset} · ${recap.players.length} players · ${date}`, 66, 283);
  ctx.fillStyle = white;
  ctx.font = `600 28px ${bodyFont}`;
  ctx.fillText(`${recap.final ? 'Final' : 'In progress'} · ${recap.duration}`, 66, 332);
  ctx.textAlign = 'right';
  ctx.fillStyle = gold;
  ctx.font = `600 23px ${bodyFont}`;
  // Long winner names are shown in full on the player row; this banner is a cue.
  ctx.fillText(recap.result === 'Draw' ? 'DRAW' : recap.result ? 'VICTORY' : '', 1014, 332);
  ctx.textAlign = 'left';
  let y = 376;
  for (const { player, commanders, height } of rows) {
    const color = colors[player.color] ?? colors.ivory;
    ctx.fillStyle = player.winner ? '#28291f' : '#ffffff07';
    box(ctx, 62, y, 956, height);
    ctx.fill();
    ctx.strokeStyle = player.winner ? '#d6b66a99' : '#ffffff18';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    box(ctx, 62, y + 25, 5, height - 50, 3);
    ctx.fill();
    let nameSize = 36;
    ctx.font = `600 ${nameSize}px ${bodyFont}`;
    while (ctx.measureText(player.name).width > 670 && nameSize > 22) {
      nameSize -= 1;
      ctx.font = `600 ${nameSize}px ${bodyFont}`;
    }
    ctx.fillStyle = white;
    ctx.fillText(player.name, 92, y + 51, 670);
    ctx.fillStyle = muted;
    ctx.font = `400 27px ${bodyFont}`;
    for (const [index, commander] of commanders.entries()) {
      ctx.fillText(commander, 92, y + 94 + index * 35);
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    const lifeSize = String(player.life).length > 5 ? 43 : 62;
    ctx.font = `500 ${lifeSize}px ${bodyFont}`;
    ctx.fillText(String(player.life), 990, y + 75);
    ctx.fillStyle = muted;
    ctx.font = `400 20px ${bodyFont}`;
    ctx.fillText(recap.final ? 'FINAL LIFE' : 'LIFE', 990, y + 111);
    ctx.fillStyle = player.winner ? gold : muted;
    ctx.font = `600 18px ${bodyFont}`;
    ctx.fillText(
      player.winner ? 'WINNER' : player.eliminated ? 'ELIMINATED' : player.archenemy ? 'ARCHENEMY' : '',
      990,
      y + 148,
    );
    ctx.textAlign = 'left';
    y += height + 16;
  }
  if (recap.life) lifeGraph(ctx, recap, y);
  ctx.fillStyle = muted;
  ctx.font = `400 22px ${bodyFont}`;
  ctx.fillText('Until the next game.', 66, canvas.height - 76);
  ctx.textAlign = 'right';
  ctx.fillStyle = gold;
  ctx.fillText('COMMAND TABLE', 1014, canvas.height - 76);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('The recap image could not be saved. Please try again.')),
      'image/png',
    );
  });
}
