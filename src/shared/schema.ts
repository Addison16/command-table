import { z } from 'zod';
import { commanderCardSchema } from './cards.js';

export const PROTOCOL = 1;
export const LIMIT = 999_999;
export const idSchema = z.string().uuid();
export const nameSchema = z.string().trim().min(1).max(40);
export const commanderNameSchema = z.string().trim().min(1).max(100);
export const counterKey = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .refine((s) => !['__proto__', 'prototype', 'constructor'].includes(s), 'Reserved counter name');
export const palettes = ['ivory', 'blue', 'violet', 'ember', 'green', 'teal', 'rose', 'copper'] as const;
const int = z.number().int().min(0).max(LIMIT);
const life = z.number().int().min(-LIMIT).max(LIMIT);
export const settingsSchema = z
  .strictObject({
    preset: z.enum(['Commander', '20-life game', 'Archenemy', 'Custom']),
    startingLife: life,
    poison: z.boolean(),
    commander: z.boolean(),
    turnTracking: z.boolean().default(false),
    poisonThreshold: int.min(1),
    commanderThreshold: int.min(1),
    counters: z.array(counterKey).max(12),
    markerTrackers: z.array(z.enum(['monarch', 'initiative'])).max(2),
    /** Present only in Archenemy games: the lone villain's starting life. */
    archenemyLife: life.optional(),
  })
  .strict();
export const schemeNameSchema = z.string().trim().min(1).max(60);
export const setupSchema = z
  .strictObject({
    settings: settingsSchema,
    seats: z
      .array(
        z
          .strictObject({
            name: nameSchema,
            color: z.enum(palettes),
            commanders: z.array(commanderNameSchema).min(1).max(2),
            commanderCards: z.array(commanderCardSchema.nullable()).min(1).max(2).optional(),
            archenemy: z.boolean().optional(),
          })
          .strict()
          .refine((seat) => !seat.commanderCards || seat.commanderCards.length === seat.commanders.length, {
            message: 'Commander artwork must match the number of commanders.',
            path: ['commanderCards'],
          }),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((setup, ctx) => {
    const villains = setup.seats.filter((seat) => seat.archenemy).length;
    if (villains > 1)
      ctx.addIssue({ code: 'custom', message: 'Choose only one archenemy.', path: ['seats'] });
    if (villains && setup.seats.length < 2)
      ctx.addIssue({
        code: 'custom',
        message: 'Archenemy needs at least two players: the archenemy and a team.',
        path: ['seats'],
      });
  });
export type Setup = z.infer<typeof setupSchema>;
export const playerSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema,
    color: z.enum(palettes),
    life,
    poison: int,
    counters: z.record(counterKey, int),
    eliminated: z.boolean(),
  })
  .strict();
export const commanderSchema = z
  .strictObject({
    id: idSchema,
    ownerId: idSchema,
    label: commanderNameSchema,
    casts: int,
    card: commanderCardSchema.optional(),
  })
  .strict();
export const rollSchema = z
  .strictObject({
    id: idSchema,
    kind: z.enum(['dice', 'coin', 'first', 'd20-each']),
    sides: z.number().int().min(2).max(100),
    values: z.array(int).max(20),
    candidates: z.array(idSchema).max(8),
    rounds: z.array(z.array(z.strictObject({ playerId: idSchema, value: int }))).max(64),
    winner: idSchema.nullable(),
    at: z.number().int(),
    actor: nameSchema,
    playerId: idSchema.optional(),
  })
  .strict();
export type Roll = z.infer<typeof rollSchema>;
const safePath = z
  .array(z.string().refine((s) => !['__proto__', 'prototype', 'constructor'].includes(s)))
  .min(1)
  .max(6);
export const changeSchema = z.strictObject({
  path: safePath,
  before: z.json().optional(),
  after: z.json().optional(),
});
export type Change = z.infer<typeof changeSchema>;
const historySchema = z.strictObject({
  id: idSchema,
  actorId: z.string().max(80),
  actor: nameSchema,
  operationId: idSchema,
  summary: z.string().max(250),
  at: z.number().int(),
  revision: z.number().int().nonnegative(),
  groupId: idSchema.optional(),
});
export type HistoryEntry = z.infer<typeof historySchema>;
const frameSchema = z.strictObject({
  changes: z.array(changeSchema).max(250),
  actorId: z.string().max(80),
  groupId: idSchema.optional(),
  summary: z.string().max(250),
  revision: z.number().int().nonnegative(),
});
export const gameSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: idSchema,
    revision: z.number().int().nonnegative(),
    settings: settingsSchema,
    order: z.array(idSchema).min(1).max(8),
    players: z.record(idSchema, playerSchema),
    commanders: z.record(idSchema, commanderSchema),
    damageReceived: z.record(idSchema, z.record(idSchema, int)),
    markers: z.strictObject({ monarch: idSchema.nullable(), initiative: idSchema.nullable() }),
    turn: z.strictObject({ playerId: idSchema.nullable(), number: int }),
    timer: z.strictObject({
      startedAt: z.number().int(),
      pausedAt: z.number().int().nullable(),
      pausedMs: z.number().int().nonnegative(),
    }),
    status: z.enum(['active', 'ended']),
    endedAt: z.number().int().nonnegative().nullable().default(null),
    rolls: z.array(rollSchema).max(30),
    history: z.array(historySchema).max(200),
    undo: z.array(frameSchema).max(60),
    redo: z.array(frameSchema).max(60),
    /** Archenemy games only. One seat plays alone against everyone else as a team. */
    archenemy: z
      .strictObject({
        playerId: idSchema,
        schemes: int,
        ongoing: z.array(schemeNameSchema).max(12),
      })
      .optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      new Set(g.order).size !== g.order.length ||
      Object.keys(g.players).length !== g.order.length ||
      g.order.some((id) => g.players[id]?.id !== id)
    )
      invalid('Invalid seat references');
    if (Object.keys(g.commanders).length > 16) invalid('Too many commanders');
    for (const [id, c] of Object.entries(g.commanders))
      if (id !== c.id || !g.players[c.ownerId]) invalid('Invalid commander reference');
    for (const id of g.order) {
      const count = Object.values(g.commanders).filter((c) => c.ownerId === id).length;
      if (count < 1 || count > 2) invalid('Each seat needs one or two commanders');
    }
    for (const [id, sources] of Object.entries(g.damageReceived))
      if (!g.players[id] || Object.keys(sources).some((cid) => !g.commanders[cid]))
        invalid('Invalid damage reference');
    if ([g.markers.monarch, g.markers.initiative, g.turn.playerId].some((id) => id && !g.players[id]))
      invalid('Invalid marker or turn');
    if (g.rolls.some((roll) => roll.playerId && !g.players[roll.playerId]))
      invalid('Invalid dice player reference');
    if (g.archenemy && !g.players[g.archenemy.playerId]) invalid('Invalid archenemy');
    const roots = [
      'players',
      'commanders',
      'damageReceived',
      'markers',
      'turn',
      'timer',
      'settings',
      'status',
      'endedAt',
      'archenemy',
    ];
    if ([...g.undo, ...g.redo].some((f) => f.changes.some((c) => !roots.includes(c.path[0]))))
      invalid('Invalid undo fields');
  });
export type Game = z.infer<typeof gameSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('adjust'), playerId: idSchema, field: counterKey, delta: life }),
  z.strictObject({ type: z.literal('set'), playerId: idSchema, field: counterKey, value: life }),
  z
    .strictObject({
      type: z.literal('groupLife'),
      casterId: idSchema,
      targetIds: z.array(idSchema).min(1).max(7),
      loss: int.min(1),
      gain: int.optional(),
    })
    .refine((command) => new Set(command.targetIds).size === command.targetIds.length, {
      message: 'Choose each opponent only once.',
      path: ['targetIds'],
    })
    .refine((command) => !command.targetIds.includes(command.casterId), {
      message: 'The caster cannot lose life in an opponents-only change.',
      path: ['targetIds'],
    }),
  z.strictObject({
    type: z.literal('damage'),
    playerId: idSchema,
    commanderId: idSchema,
    amount: int,
    subtractLife: z.boolean(),
  }),
  z.strictObject({ type: z.literal('damageSet'), playerId: idSchema, commanderId: idSchema, value: int }),
  z.strictObject({ type: z.literal('cast'), commanderId: idSchema }),
  z.strictObject({ type: z.literal('castSet'), commanderId: idSchema, value: int }),
  z.strictObject({
    type: z.literal('customize'),
    playerId: idSchema,
    name: nameSchema,
    color: z.enum(palettes),
  }),
  z.strictObject({
    type: z.literal('editPlayer'),
    playerId: idSchema,
    name: nameSchema,
    color: z.enum(palettes),
    commanders: z
      .array(
        z.strictObject({
          id: idSchema,
          label: commanderNameSchema,
          card: commanderCardSchema.nullable().optional(),
        }),
      )
      .min(1)
      .max(2),
  }),
  z.strictObject({
    type: z.literal('commanderName'),
    commanderId: idSchema,
    label: commanderNameSchema,
    card: commanderCardSchema.nullable().optional(),
  }),
  z.strictObject({ type: z.literal('eliminate'), playerId: idSchema, eliminated: z.boolean() }),
  z.strictObject({
    type: z.literal('marker'),
    marker: z.enum(['monarch', 'initiative']),
    playerId: idSchema.nullable(),
  }),
  z.strictObject({ type: z.literal('turn'), playerId: idSchema.nullable(), advance: z.boolean() }),
  z.strictObject({ type: z.literal('turnTracking'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('scheme'),
    name: schemeNameSchema.optional(),
    ongoing: z.boolean(),
  }),
  z.strictObject({ type: z.literal('abandonScheme'), index: z.number().int().min(0).max(11) }),
  z.strictObject({ type: z.literal('timer'), action: z.enum(['pause', 'resume']) }),
  z.strictObject({
    type: z.literal('trackers'),
    counters: z.array(counterKey).max(12),
    markerTrackers: z.array(z.enum(['monarch', 'initiative'])).max(2),
  }),
  z.strictObject({ type: z.literal('end') }),
  z.strictObject({ type: z.literal('reopen') }),
  z.strictObject({ type: z.literal('rematch') }),
  z.strictObject({ type: z.literal('undo') }),
  z.strictObject({ type: z.literal('redo') }),
  z.strictObject({
    type: z.literal('roll'),
    kind: z.enum(['dice', 'coin', 'first', 'd20-each']),
    sides: z.union([
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(10),
      z.literal(12),
      z.literal(20),
      z.literal(100),
    ]),
    count: z.number().int().min(1).max(20),
    playerId: idSchema.optional(),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const seatProfileSchema = z
  .strictObject({
    name: nameSchema,
    commanders: z.array(commanderNameSchema).min(1).max(2).optional(),
    commanderCards: z.array(commanderCardSchema.nullable()).min(1).max(2).optional(),
  })
  .refine(
    (profile) => !profile.commanderCards || profile.commanderCards.length === profile.commanders?.length,
    {
      message: 'Commander artwork must match the number of commanders.',
      path: ['commanderCards'],
    },
  );
export type SeatProfile = z.infer<typeof seatProfileSchema>;
export const adminSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('requestSeat'),
    playerId: idSchema,
    profile: seatProfileSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('approve'),
    memberId: idSchema,
    playerId: idSchema,
    replace: z.boolean(),
  }),
  z.strictObject({ type: z.literal('reject'), memberId: idSchema }),
  z.strictObject({ type: z.literal('release'), memberId: idSchema }),
  z.strictObject({ type: z.literal('remove'), memberId: idSchema }),
  z.strictObject({ type: z.literal('transfer'), memberId: idSchema }),
  z.strictObject({ type: z.literal('lock'), locked: z.boolean() }),
  z.strictObject({ type: z.literal('policy'), everyoneEdits: z.boolean() }),
  z.strictObject({ type: z.literal('rotateCode') }),
]);
export type AdminCommand = z.infer<typeof adminSchema>;
export const envelopeSchema = z
  .strictObject({
    protocolVersion: z.literal(PROTOCOL),
    roomId: idSchema,
    gameId: idSchema,
    operationId: idSchema,
    baseRevision: z.number().int().nonnegative(),
    groupId: idSchema.optional(),
    command: z.union([commandSchema, adminSchema]),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export type Member = {
  id: string;
  name: string;
  seatId: string | null;
  requestedSeat: string | null;
  seatProfile?: SeatProfile;
  status: 'pending' | 'approved' | 'rejected' | 'seat-taken' | 'revoked';
  connected?: boolean;
};
export type RoomView = {
  protocolVersion: number;
  id: string;
  revision: number;
  gameId: string;
  hostId: string;
  me: Member;
  members: Member[];
  seats: { id: string; name: string; taken: boolean; archenemy?: boolean }[];
  commanderEnabled?: boolean;
  locked: boolean;
  everyoneEdits: boolean;
  expiresAt: number;
  retentionDays: number;
  serverTime: number;
  game?: Game;
  code?: string;
  joinUrl?: string;
  undoRoomRevision?: number;
};
export type Receipt = { operationId: string; revision: number; gameId: string; ok: boolean; error?: string };
export const recentRoomSchema = z.object({
  id: idSchema,
  gameId: idSchema,
  names: z.array(nameSchema).min(1).max(8),
  preset: z.string().max(40),
  updatedAt: z.number(),
  expiresAt: z.number(),
  approved: z.boolean(),
  status: z.enum(['active', 'ended']).default('active'),
  recoverUntil: z.number().nullable().default(null),
  canReopen: z.boolean().default(false),
});
export type RecentRoom = z.infer<typeof recentRoomSchema>;
