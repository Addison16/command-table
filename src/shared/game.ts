import {
  commandSchema,
  gameSchema,
  setupSchema,
  LIMIT,
  palettes,
  type Change,
  type Command,
  type Game,
  type Roll,
  type Setup,
} from './schema.js';

export type Context = {
  id: string;
  operationId: string;
  now: number;
  actorId: string;
  actor: string;
  groupId?: string;
  roll?: Roll;
  newGameId?: string;
};
export const GAME_RECOVERY_MS = 24 * 60 * 60 * 1000;
export function recoveryDeadline(game: Game): number | null {
  return game.status === 'ended' && game.endedAt !== null ? game.endedAt + GAME_RECOVERY_MS : null;
}
export function defaultSetup(count = 4, commander = true): Setup {
  return {
    settings: {
      preset: commander ? 'Commander' : '20-life game',
      startingLife: commander ? 40 : 20,
      poison: true,
      commander,
      turnTracking: false,
      poisonThreshold: 10,
      commanderThreshold: 21,
      counters: [],
      markerTrackers: [],
    },
    seats: Array.from({ length: count }, (_, i) => ({
      name: `Player ${i + 1}`,
      color: palettes[i],
      commanders: ['Commander 1'],
    })),
  };
}
export const ARCHENEMY_LIFE = 60;
/**
 * Archenemy Commander: one seat plays alone against everyone else as a team.
 * Team players keep the usual 40 life; the archenemy starts at 60 by default.
 */
export function archenemySetup(count = 4, archenemySeat = 0): Setup {
  const setup = defaultSetup(count);
  setup.settings.preset = 'Archenemy';
  setup.settings.archenemyLife = ARCHENEMY_LIFE;
  setup.seats = setup.seats.map((seat, index) => ({ ...seat, archenemy: index === archenemySeat }));
  return setup;
}
export function isArchenemy(game: Game, playerId: string | null | undefined) {
  return !!game.archenemy && game.archenemy.playerId === playerId;
}
/** Players on the other side of the table. Without Archenemy, everyone else is an opponent. */
export function opponentsOf(game: Game, playerId: string) {
  if (!game.archenemy) return game.order.filter((id) => id !== playerId);
  return isArchenemy(game, playerId) ? game.order.filter((id) => id !== playerId) : [game.archenemy.playerId];
}
export function teamOf(game: Game) {
  return game.archenemy ? game.order.filter((id) => id !== game.archenemy!.playerId) : [];
}
/** The team wins when the archenemy is out; the archenemy wins when every team member is out. */
export function archenemyOutcome(game: Game): 'team' | 'archenemy' | null {
  if (!game.archenemy) return null;
  if (game.players[game.archenemy.playerId].eliminated) return 'team';
  const team = teamOf(game);
  return team.length && team.every((id) => game.players[id].eliminated) ? 'archenemy' : null;
}
/** Who can take the next turn. In Archenemy the team shares one turn, recorded on its first active player. */
export function turnOrder(game: Game) {
  const active = game.order.filter((id) => !game.players[id].eliminated);
  if (!game.archenemy) return active;
  const villain = game.archenemy.playerId;
  return [active.find((id) => id === villain), active.find((id) => id !== villain)].filter(
    (id): id is string => !!id,
  );
}
export function isTeamTurn(game: Game) {
  return !!game.archenemy && !!game.turn.playerId && game.turn.playerId !== game.archenemy.playerId;
}
function startingLife(settings: Game['settings'], archenemy: boolean) {
  return archenemy ? (settings.archenemyLife ?? settings.startingLife) : settings.startingLife;
}
export function setupFromGame(game: Game): Setup {
  return {
    settings: structuredClone(game.settings),
    seats: game.order.map((id) => {
      const commanders = Object.values(game.commanders).filter((commander) => commander.ownerId === id);
      return {
        name: game.players[id].name,
        color: game.players[id].color,
        commanders: commanders.map((commander) => commander.label),
        ...(game.archenemy ? { archenemy: isArchenemy(game, id) } : {}),
        ...(commanders.some((commander) => commander.card)
          ? {
              commanderCards: commanders.map((commander) =>
                commander.card ? structuredClone(commander.card) : null,
              ),
            }
          : {}),
      };
    }),
  };
}
export function createGame(input: Setup, id: () => string, now: number): Game {
  const setup = setupSchema.parse(input);
  const game: Game = {
    schemaVersion: 1,
    id: id(),
    revision: 0,
    settings: setup.settings,
    order: [],
    players: {},
    commanders: {},
    damageReceived: {},
    markers: { monarch: null, initiative: null },
    turn: { playerId: null, number: 0 },
    timer: { startedAt: now, pausedAt: null, pausedMs: 0 },
    status: 'active',
    endedAt: null,
    rolls: [],
    history: [],
    undo: [],
    redo: [],
  };
  for (const seat of setup.seats) {
    const pid = id();
    game.order.push(pid);
    game.players[pid] = {
      id: pid,
      name: seat.name,
      color: seat.color,
      life: startingLife(setup.settings, !!seat.archenemy),
      poison: 0,
      counters: {},
      eliminated: false,
    };
    // The archenemy always takes the first turn.
    if (seat.archenemy) {
      game.archenemy = { playerId: pid, schemes: 0, ongoing: [] };
      game.turn = { playerId: pid, number: 1 };
    }
    for (const [index, label] of seat.commanders.entries()) {
      const cid = id();
      const card = seat.commanderCards?.[index];
      game.commanders[cid] = { id: cid, ownerId: pid, label, casts: 0, ...(card ? { card } : {}) };
    }
  }
  return game;
}
function core(g: Game) {
  return {
    players: g.players,
    commanders: g.commanders,
    damageReceived: g.damageReceived,
    markers: g.markers,
    turn: g.turn,
    timer: g.timer,
    settings: g.settings,
    status: g.status,
    endedAt: g.endedAt,
    archenemy: g.archenemy,
  };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function diff(a: unknown, b: unknown, path: string[] = []): Change[] {
  if (equal(a, b)) return [];
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aa = a as Record<string, unknown>,
      bb = b as Record<string, unknown>;
    return [...new Set([...Object.keys(aa), ...Object.keys(bb)])].flatMap((k) =>
      diff(aa[k], bb[k], [...path, k]),
    );
  }
  return [{ path, before: a as Change['before'], after: b as Change['after'] }];
}
function patch(g: Game, changes: Change[], forward: boolean) {
  for (const c of changes) {
    let node = g as unknown as Record<string, unknown>;
    for (const p of c.path.slice(0, -1)) {
      if (!node[p] || typeof node[p] !== 'object')
        throw new Error('This action can no longer be undone safely');
      node = node[p] as Record<string, unknown>;
    }
    const key = c.path.at(-1)!;
    if (!equal(node[key], forward ? c.before : c.after))
      throw new Error('This action can no longer be undone safely');
    const value = forward ? c.after : c.before;
    if (value === undefined) delete node[key];
    else node[key] = structuredClone(value);
  }
}
function bounded(n: number, min = 0) {
  if (!Number.isSafeInteger(n) || n < min || n > LIMIT)
    throw new Error(`Use a whole number between ${min.toLocaleString()} and ${LIMIT.toLocaleString()}`);
  return n;
}
export function reduceGame(previous: Game, input: Command, ctx: Context): Game {
  const c = commandSchema.parse(input),
    g = structuredClone(previous),
    groupId = c.type === 'groupLife' ? undefined : ctx.groupId;
  if (g.status === 'ended' && !['rematch', 'reopen', 'undo', 'redo', 'roll'].includes(c.type))
    throw new Error('This game has ended. Start a rematch to play again.');
  const p = 'playerId' in c && c.playerId ? g.players[c.playerId] : undefined;
  if ('playerId' in c && c.playerId && !p) throw new Error('Unknown player');
  if (p?.eliminated && ['adjust', 'set', 'damage', 'damageSet', 'cast', 'castSet'].includes(c.type))
    throw new Error('Restore this player before editing');
  const commander = 'commanderId' in c ? g.commanders[c.commanderId] : undefined;
  if ('commanderId' in c && !commander) throw new Error('Unknown commander');
  if (commander && ['cast', 'castSet'].includes(c.type) && g.players[commander.ownerId].eliminated)
    throw new Error('Restore this player before recording casts');
  let summary = '';
  switch (c.type) {
    case 'adjust':
    case 'set': {
      const target = c.field === 'life' || c.field === 'poison' ? p! : p!.counters;
      if (!['life', 'poison'].includes(c.field) && !g.settings.counters.includes(c.field))
        throw new Error('Enable this counter in Utilities first');
      const values = target as unknown as Record<string, number>,
        old = values[c.field] ?? 0;
      const next = bounded(c.type === 'adjust' ? old + c.delta : c.value, c.field === 'life' ? -LIMIT : 0);
      values[c.field] = next;
      summary =
        c.type === 'set'
          ? `${p!.name} set ${c.field} to ${next}`
          : `${p!.name} ${next >= old ? 'gained' : 'lost'} ${Math.abs(next - old)} ${c.field}`;
      break;
    }
    case 'groupLife': {
      const caster = g.players[c.casterId];
      if (!caster) throw new Error('Unknown caster');
      if (caster.eliminated) throw new Error('Restore the caster before changing life');
      const targets = c.targetIds.map((id) => {
        const target = g.players[id];
        if (!target) throw new Error('Unknown opponent');
        if (g.archenemy && !opponentsOf(g, c.casterId).includes(id))
          throw new Error('Teammates are not opponents in Archenemy. Choose the archenemy.');
        if (target.eliminated) throw new Error('Choose opponents still in the game');
        return target;
      });
      for (const target of targets) target.life = bounded(target.life - c.loss, -LIMIT);
      if (c.gain) caster.life = bounded(caster.life + c.gain, -LIMIT);
      summary = `${caster.name}: ${targets.length} opponent${targets.length === 1 ? '' : 's'} lost ${c.loss} life each${c.gain ? `; gained ${c.gain} life` : ''}`;
      break;
    }
    case 'damage':
    case 'damageSet': {
      if (commander!.ownerId === p!.id)
        throw new Error('Choose another player’s commander as the damage source.');
      g.damageReceived[p!.id] ??= {};
      const old = g.damageReceived[p!.id][commander!.id] ?? 0;
      g.damageReceived[p!.id][commander!.id] = bounded(c.type === 'damage' ? old + c.amount : c.value);
      if (c.type === 'damage' && c.subtractLife) p!.life = bounded(p!.life - c.amount, -LIMIT);
      summary =
        c.type === 'damage'
          ? `${p!.name} took ${c.amount} combat damage from ${g.players[commander!.ownerId].name}'s ${commander!.label}${c.subtractLife ? `; life −${c.amount}` : ''}`
          : `${p!.name} corrected ${commander!.label} damage to ${c.value}`;
      break;
    }
    case 'cast':
    case 'castSet':
      commander!.casts = bounded(c.type === 'cast' ? commander!.casts + 1 : c.value);
      summary = `${g.players[commander!.ownerId].name}: ${commander!.label} command-zone casts ${commander!.casts}`;
      break;
    case 'customize':
      p!.name = c.name;
      p!.color = c.color;
      summary = `${c.name} updated their seat`;
      break;
    case 'editPlayer': {
      const existing = Object.values(g.commanders).filter((entry) => entry.ownerId === c.playerId);
      if (
        existing.length !== c.commanders.length ||
        new Set(c.commanders.map((entry) => entry.id)).size !== existing.length ||
        c.commanders.some((entry) => g.commanders[entry.id]?.ownerId !== c.playerId)
      )
        throw new Error('Save all of this player’s current commanders. Reopen their details and try again.');
      p!.name = c.name;
      p!.color = c.color;
      for (const entry of c.commanders) {
        const target = g.commanders[entry.id];
        target.label = entry.label;
        if (entry.card) target.card = entry.card;
        else delete target.card;
      }
      summary = `${c.name} updated their player and commanders`;
      break;
    }
    case 'commanderName':
      commander!.label = c.label;
      if (c.card) commander!.card = c.card;
      else delete commander!.card;
      summary = `Commander renamed to ${c.label}`;
      break;
    case 'eliminate': {
      p!.eliminated = c.eliminated;
      summary = `${p!.name} ${c.eliminated ? 'was eliminated' : 'returned to the game'}`;
      const outcome = c.eliminated ? archenemyOutcome(g) : null;
      if (outcome === 'team') summary += '. The team defeated the archenemy!';
      if (outcome === 'archenemy') summary += '. The archenemy has conquered the team!';
      break;
    }
    case 'scheme': {
      if (!g.archenemy) throw new Error('Schemes are used only in Archenemy games');
      const villain = g.players[g.archenemy.playerId];
      if (villain.eliminated) throw new Error('Restore the archenemy before setting schemes in motion');
      if (c.ongoing && g.archenemy.ongoing.length >= 12)
        throw new Error('Abandon an ongoing scheme before adding another');
      g.archenemy.schemes = bounded(g.archenemy.schemes + 1);
      const name = c.name ?? `Scheme ${g.archenemy.schemes}`;
      if (c.ongoing) g.archenemy.ongoing.push(name);
      summary = `${villain.name} set ${name} in motion${c.ongoing ? ' (ongoing)' : ''}`;
      break;
    }
    case 'abandonScheme': {
      if (!g.archenemy) throw new Error('Schemes are used only in Archenemy games');
      const [name] = g.archenemy.ongoing.splice(c.index, 1);
      if (name === undefined) throw new Error('That scheme is no longer ongoing');
      summary = `${g.players[g.archenemy.playerId].name} abandoned ${name}`;
      break;
    }
    case 'marker':
      g.markers[c.marker] = c.playerId;
      summary = `${c.marker}: ${p?.name ?? 'cleared'}`;
      break;
    case 'turn':
      if (p?.eliminated) throw new Error('Choose a player still in the game');
      g.turn = {
        playerId: c.playerId,
        number: c.advance ? bounded(g.turn.number + 1) : c.playerId ? Math.max(1, g.turn.number) : 0,
      };
      summary = `Turn ${g.turn.number}: ${p?.name ?? 'cleared'}`;
      break;
    case 'turnTracking':
      g.settings.turnTracking = c.enabled;
      summary = `Turn tracking ${c.enabled ? 'enabled' : 'disabled'}`;
      break;
    case 'timer':
      if (c.action === 'pause' && g.timer.pausedAt === null) g.timer.pausedAt = ctx.now;
      if (c.action === 'resume' && g.timer.pausedAt !== null) {
        g.timer.pausedMs += Math.max(0, ctx.now - g.timer.pausedAt);
        g.timer.pausedAt = null;
      }
      summary = `Timer ${c.action === 'pause' ? 'paused' : 'resumed'}`;
      break;
    case 'trackers':
      g.settings.counters = [...new Set(c.counters)];
      g.settings.markerTrackers = [...new Set(c.markerTrackers)];
      summary = 'Manual trackers updated';
      break;
    case 'end':
      g.status = 'ended';
      g.endedAt = ctx.now;
      g.timer.pausedAt ??= ctx.now;
      summary = 'Game ended';
      break;
    case 'reopen':
      if ((recoveryDeadline(g) ?? 0) <= ctx.now)
        throw new Error('This game’s 24-hour recovery window has ended.');
      g.status = 'active';
      g.endedAt = null;
      summary = 'Game reopened';
      break;
    case 'rematch':
      if (!ctx.newGameId) throw new Error('Missing new game identity');
      g.id = ctx.newGameId;
      g.status = 'active';
      g.endedAt = null;
      for (const player of Object.values(g.players)) {
        player.life = startingLife(g.settings, isArchenemy(g, player.id));
        player.poison = 0;
        player.counters = {};
        player.eliminated = false;
      }
      for (const cmdr of Object.values(g.commanders)) cmdr.casts = 0;
      g.damageReceived = {};
      g.markers = { monarch: null, initiative: null };
      g.turn = g.archenemy ? { playerId: g.archenemy.playerId, number: 1 } : { playerId: null, number: 0 };
      if (g.archenemy) g.archenemy = { playerId: g.archenemy.playerId, schemes: 0, ongoing: [] };
      g.timer = { startedAt: ctx.now, pausedAt: null, pausedMs: 0 };
      g.rolls = [];
      g.history = [];
      g.undo = [];
      g.redo = [];
      summary = 'A new game began';
      break;
    case 'undo':
    case 'redo': {
      const stack = c.type === 'undo' ? g.undo : g.redo,
        frame = stack.pop();
      if (!frame) throw new Error(`Nothing to ${c.type}`);
      patch(g, frame.changes, c.type === 'redo');
      if (
        previous.status === 'ended' &&
        g.status === 'active' &&
        previous.endedAt !== null &&
        (recoveryDeadline(previous) ?? 0) <= ctx.now
      )
        throw new Error('This game’s 24-hour recovery window has ended.');
      (c.type === 'undo' ? g.redo : g.undo).push(frame);
      summary = `${c.type === 'undo' ? 'Undid' : 'Redid'}: ${frame.summary}`;
      break;
    }
    case 'roll':
      if (!ctx.roll) throw new Error('Missing recorded roll');
      g.rolls = [ctx.roll, ...g.rolls].slice(0, 30);
      summary = '';
      break;
  }
  g.revision++;
  if (!['undo', 'redo', 'rematch', 'roll'].includes(c.type)) {
    const changes = diff(core(previous), core(g));
    if (!changes.length) throw new Error('No change to record');
    const last = g.undo.at(-1);
    if (
      groupId &&
      last?.groupId === groupId &&
      last.actorId === ctx.actorId &&
      last.revision === previous.revision
    ) {
      const original = structuredClone(previous);
      patch(original, last.changes, false);
      last.changes = diff(core(original), core(g));
      last.revision = g.revision;
      if (c.type === 'adjust') {
        const beforePlayer = original.players[c.playerId];
        const before =
          c.field === 'life' || c.field === 'poison'
            ? beforePlayer[c.field]
            : (beforePlayer.counters[c.field] ?? 0);
        const after = c.field === 'life' || c.field === 'poison' ? p![c.field] : (p!.counters[c.field] ?? 0);
        summary = `${p!.name} ${after >= before ? 'gained' : 'lost'} ${Math.abs(after - before)} ${c.field}`;
      }
      last.summary = summary;
      if (g.history.at(-1)?.groupId === groupId) g.history.pop();
    } else
      g.undo = [...g.undo, { changes, actorId: ctx.actorId, groupId, summary, revision: g.revision }].slice(
        -60,
      );
    g.redo = [];
  }
  if (c.type === 'roll') g.redo = [];
  if (summary)
    g.history = [
      ...g.history,
      {
        id: ctx.id,
        actorId: ctx.actorId,
        actor: ctx.actor,
        operationId: ctx.operationId,
        summary,
        at: ctx.now,
        revision: g.revision,
        groupId,
      },
    ].slice(-200);
  return gameSchema.parse(g);
}
export function warnings(g: Game, playerId: string): string[] {
  const p = g.players[playerId];
  return [
    p.life <= 0 ? 'Life ≤ 0' : '',
    g.settings.poison && p.poison >= g.settings.poisonThreshold ? `${p.poison} poison` : '',
    g.settings.commander &&
    Object.entries(g.damageReceived[playerId] ?? {}).some(
      ([commanderId, amount]) =>
        g.commanders[commanderId]?.ownerId !== playerId && amount >= g.settings.commanderThreshold,
    )
      ? 'Commander damage'
      : '',
  ].filter(Boolean);
}
export function elapsed(g: Game, now: number) {
  return Math.max(0, (g.timer.pausedAt ?? now) - g.timer.startedAt - g.timer.pausedMs);
}
export function makeRoll(
  g: Game,
  c: Extract<Command, { type: 'roll' }>,
  ctx: Pick<Context, 'id' | 'now' | 'actor'>,
  rng: (max: number) => number,
): Roll {
  if (c.playerId && !g.players[c.playerId]) throw new Error('Unknown player');
  const candidates = g.order.filter((id) => !g.players[id].eliminated);
  const roll: Roll = {
    id: ctx.id,
    kind: c.kind,
    sides: c.sides,
    values: [],
    candidates: [],
    rounds: [],
    winner: null,
    at: ctx.now,
    actor: ctx.actor,
    ...((c.kind === 'dice' || c.kind === 'coin') && c.playerId ? { playerId: c.playerId } : {}),
  };
  if (c.kind === 'dice') roll.values = Array.from({ length: c.count }, () => rng(c.sides) + 1);
  if (c.kind === 'coin') {
    roll.sides = 2;
    roll.values = [rng(2) + 1];
  }
  if (c.kind === 'first' || c.kind === 'd20-each') {
    if (!candidates.length) throw new Error('Restore a player before choosing who starts');
    roll.candidates = candidates;
    if (c.kind === 'first') roll.winner = candidates[rng(candidates.length)];
    else {
      let tied = candidates;
      do {
        const round = tied.map((playerId) => ({ playerId, value: rng(20) + 1 }));
        roll.rounds.push(round);
        const high = Math.max(...round.map((r) => r.value));
        tied = round.filter((r) => r.value === high).map((r) => r.playerId);
      } while (tied.length > 1 && roll.rounds.length < 64);
      if (tied.length > 1) throw new Error('Too many ties. Roll again.');
      roll.winner = tied[0];
    }
  }
  return roll;
}
export function isRelative(c: Command) {
  return ['adjust', 'damage', 'cast', 'roll', 'scheme'].includes(c.type);
}
export function commandSeat(g: Game, c: Command): string | undefined {
  if (c.type === 'scheme' || c.type === 'abandonScheme') return g.archenemy?.playerId;
  return 'playerId' in c && c.playerId
    ? c.playerId
    : 'commanderId' in c
      ? g.commanders[c.commanderId]?.ownerId
      : undefined;
}
