import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { canUndoRoomAction } from '../shared/permissions.js';
import {
  commandSeat,
  isRelative,
  makeRoll,
  reduceGame,
  recoveryDeadline,
  GAME_RECOVERY_MS,
} from '../shared/game.js';
import {
  adminSchema,
  envelopeSchema,
  gameSchema,
  nameSchema,
  seatProfileSchema,
  PROTOCOL,
  type AdminCommand,
  type Command,
  type Game,
  type Member,
  type Receipt,
  type RoomView,
  type SeatProfile,
} from '../shared/schema.js';
import type { Config } from './config.js';
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const csrfFor = (token: string) => hash(`mtg-util-csrf:${token}`);
export const validCsrf = (token: string, csrf: string) => {
  const a = Buffer.from(csrfFor(token)),
    b = Buffer.from(csrf);
  return a.length === b.length && timingSafeEqual(a, b);
};
const DAY = 86400000;
type RoomRow = {
  id: string;
  code: string;
  revision: number;
  game: string;
  host_id: string;
  locked: number;
  everyone_edits: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
  undo_room_revision: number | null;
};
type MemberRow = {
  id: string;
  room_id: string;
  session_hash: string;
  name: string;
  seat_id: string | null;
  requested_seat: string | null;
  seat_profile: string | null;
  status: Member['status'];
};
export class RoomService {
  onChange: (roomId: string) => void = () => {};
  presence: (memberId: string) => boolean = () => false;
  constructor(
    public db: Database.Database,
    public config: Config,
    public now: () => number = Date.now,
  ) {}
  assertSession(sessionHash: string) {
    const row = this.db
      .prepare('SELECT expires_at, revoked FROM sessions WHERE hash = ?')
      .get(sessionHash) as { expires_at: number; revoked: number } | undefined;
    if (!row || row.revoked || row.expires_at <= this.now())
      throw new HttpError(401, 'Your guest session has expired or was revoked.');
  }
  session(token: string | undefined, allowNew: boolean) {
    return this.db.transaction(() => {
      if (token) {
        try {
          this.assertSession(hash(token));
          const expiresAt = this.now() + this.config.sessionTtlDays * DAY;
          this.db.prepare('UPDATE sessions SET expires_at = ? WHERE hash = ?').run(expiresAt, hash(token));
          return { token, expiresAt };
        } catch (e) {
          if (!allowNew) throw e;
        }
      }
      const fresh = randomBytes(32).toString('base64url'),
        expiresAt = this.now() + this.config.sessionTtlDays * DAY;
      this.db.prepare('INSERT INTO sessions (hash, expires_at) VALUES (?, ?)').run(hash(fresh), expiresAt);
      return { token: fresh, expiresAt };
    })();
  }
  room(roomId: string) {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!row) throw new HttpError(404, 'This room is unavailable.');
    if (row.expires_at <= this.now()) throw new HttpError(410, 'This room has expired.');
    return row;
  }
  member(roomId: string, sessionHash: string, includeRevoked = false) {
    const m = this.db
      .prepare('SELECT * FROM members WHERE room_id = ? AND session_hash = ?')
      .get(roomId, sessionHash) as MemberRow | undefined;
    if (!m || (!includeRevoked && m.status === 'revoked'))
      throw new HttpError(403, 'Your browser does not have access to this room.');
    return m;
  }
  members(roomId: string) {
    return this.db
      .prepare('SELECT * FROM members WHERE room_id = ? ORDER BY rowid')
      .all(roomId) as MemberRow[];
  }
  private inviteCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
      if (!this.db.prepare('SELECT id FROM rooms WHERE code = ?').get(code)) return code;
    }
  }
  private memberView(m: MemberRow): Member {
    return {
      id: m.id,
      name: m.name,
      seatId: m.seat_id,
      requestedSeat: m.requested_seat,
      ...(m.seat_profile ? { seatProfile: seatProfileSchema.parse(JSON.parse(m.seat_profile)) } : {}),
      status: m.status,
      connected: this.presence(m.id),
    };
  }
  view(roomId: string, sessionHash: string): RoomView {
    this.assertSession(sessionHash);
    const r = this.room(roomId),
      me = this.member(roomId, sessionHash),
      game = gameSchema.parse(JSON.parse(r.game)),
      all = this.members(roomId).filter((m) => m.status !== 'revoked');
    const host = me.id === r.host_id,
      approved = me.status === 'approved';
    return {
      protocolVersion: PROTOCOL,
      id: r.id,
      revision: r.revision,
      gameId: game.id,
      hostId: r.host_id,
      me: this.memberView(me),
      members: all
        .filter((m) => host || m.id === me.id || (approved && m.status === 'approved'))
        .map((m) => this.memberView(m)),
      seats: game.order.map((id) => ({
        id,
        name: game.players[id].name,
        taken: all.some((m) => m.seat_id === id && m.status === 'approved'),
      })),
      commanderEnabled: game.settings.commander,
      locked: !!r.locked,
      everyoneEdits: false,
      expiresAt: r.expires_at,
      retentionDays: this.config.roomTtlDays,
      serverTime: this.now(),
      ...(approved ? { game } : {}),
      ...(host ? { code: r.code, joinUrl: `${this.config.publicOrigin}/?join=${r.code}` } : {}),
      ...(approved && r.undo_room_revision !== null ? { undoRoomRevision: r.undo_room_revision } : {}),
    };
  }
  create(sessionHash: string, input: unknown, name: string, hostPlayerId?: string) {
    const roomId = randomUUID();
    this.db.transaction(() => {
      this.assertSession(sessionHash);
      const g = gameSchema.parse(input);
      const seatId = hostPlayerId ?? g.order[0];
      if (!g.order.includes(seatId) || !g.players[seatId])
        throw new HttpError(400, 'Choose an existing player for the host’s seat.');
      const hostName = nameSchema.parse(name);
      g.players[seatId].name = hostName;
      g.id = randomUUID();
      g.revision = 0;
      g.history = [];
      g.undo = [];
      g.redo = [];
      g.rolls = [];
      g.timer = { startedAt: this.now(), pausedAt: null, pausedMs: 0 };
      const hostId = randomUUID(),
        now = this.now();
      this.db
        .prepare(
          'INSERT INTO rooms (id,code,revision,game,host_id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          roomId,
          this.inviteCode(),
          1,
          JSON.stringify(g),
          hostId,
          now,
          now,
          now + this.config.roomTtlDays * DAY,
        );
      this.db
        .prepare(
          "INSERT INTO members (id,room_id,session_hash,name,seat_id,status) VALUES (?,?,?,?,?,'approved')",
        )
        .run(hostId, roomId, sessionHash, hostName, seatId);
    })();
    return this.view(roomId, sessionHash);
  }
  join(sessionHash: string, rawCode: string, name: string) {
    const code = rawCode.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code))
      throw new HttpError(400, 'Enter the eight-character room code.');
    const roomId = this.db.transaction(() => {
      this.assertSession(sessionHash);
      const r = this.db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
      if (!r) throw new HttpError(404, 'No room found with that code on this server.');
      this.room(r.id);
      const existing = this.members(r.id).find((m) => m.session_hash === sessionHash);
      if (existing?.status === 'revoked')
        throw new HttpError(
          403,
          'This guest identity was removed from the room. Ask the host for a new room or use a new browser identity and request approval.',
        );
      if (existing) return r.id;
      if (r.locked) throw new HttpError(403, 'The host has locked joining. Ask them to unlock the room.');
      if (this.members(r.id).filter((m) => m.status !== 'revoked').length >= 40)
        throw new HttpError(
          409,
          'This room has too many pending guests. Ask the host to remove unused requests.',
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO members (id,room_id,session_hash,name,status) VALUES (?,?,?,?,'pending')")
        .run(id, r.id, sessionHash, nameSchema.parse(name));
      this.commitRoom(r, undefined, 'A guest joined the lobby', id, randomUUID(), false);
      return r.id;
    })();
    this.onChange(roomId);
    return this.view(roomId, sessionHash);
  }
  private commitRoom(
    r: RoomRow,
    game: Game | undefined,
    summary: string,
    actorId: string,
    operationId: string,
    undoable: boolean,
  ) {
    r.revision++;
    r.updated_at = this.now();
    r.expires_at = this.now() + this.config.roomTtlDays * DAY;
    if (game) r.game = JSON.stringify(game);
    r.undo_room_revision = undoable ? r.revision : null;
    this.db
      .prepare(
        'UPDATE rooms SET code=?,revision=?,game=?,host_id=?,locked=?,everyone_edits=?,updated_at=?,expires_at=?,undo_room_revision=? WHERE id=?',
      )
      .run(
        r.code,
        r.revision,
        r.game,
        r.host_id,
        r.locked,
        r.everyone_edits,
        r.updated_at,
        r.expires_at,
        r.undo_room_revision,
        r.id,
      );
    this.db
      .prepare(
        'INSERT INTO events (id,room_id,revision,actor_id,operation_id,summary,at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(randomUUID(), r.id, r.revision, actorId, operationId, summary.slice(0, 250), this.now());
    this.db
      .prepare(
        'DELETE FROM events WHERE room_id=? AND revision NOT IN (SELECT revision FROM events WHERE room_id=? ORDER BY revision DESC LIMIT 200)',
      )
      .run(r.id, r.id);
  }
  private applySeatProfile(
    g: Game,
    playerId: string,
    profile: SeatProfile,
    actor: MemberRow,
    operationId: string,
  ) {
    if (g.status !== 'active') throw new HttpError(409, 'Reopen the game before setting up a player.');
    const player = g.players[playerId];
    player.name = profile.name;
    if (g.settings.commander && profile.commanders) {
      const existing = Object.values(g.commanders).filter((c) => c.ownerId === playerId);
      for (const commander of existing.slice(profile.commanders.length)) {
        if (
          commander.casts > 0 ||
          Object.values(g.damageReceived).some((damage) => (damage[commander.id] ?? 0) > 0)
        )
          throw new HttpError(
            409,
            'This seat has recorded partner casts or damage. Keep both commanders in the request to preserve its history.',
          );
        delete g.commanders[commander.id];
        for (const damage of Object.values(g.damageReceived)) delete damage[commander.id];
      }
      profile.commanders.forEach((label, index) => {
        const commander = existing[index];
        const card = profile.commanderCards?.[index];
        if (commander) {
          commander.label = label;
          if (card) commander.card = card;
          else delete commander.card;
        } else {
          const id = randomUUID();
          g.commanders[id] = { id, ownerId: playerId, label, casts: 0, ...(card ? { card } : {}) };
        }
      });
    }
    g.revision++;
    g.redo = [];
    g.history = [
      ...g.history,
      {
        id: randomUUID(),
        actorId: actor.id,
        actor: actor.name,
        operationId,
        summary: `${profile.name} set up their seat`,
        at: this.now(),
        revision: g.revision,
      },
    ].slice(-200);
    return gameSchema.parse(g);
  }
  private administer(
    r: RoomRow,
    g: Game,
    me: MemberRow,
    c: AdminCommand,
    operationId: string,
  ): Game | undefined {
    const host = r.host_id === me.id;
    if (c.type !== 'requestSeat' && !host) throw new HttpError(403, 'Only the host can manage this room.');
    const all = this.members(r.id);
    const target =
      'memberId' in c ? all.find((m) => m.id === c.memberId && m.status !== 'revoked') : undefined;
    if ('memberId' in c && !target) throw new HttpError(404, 'That guest is no longer in the room.');
    switch (c.type) {
      case 'requestSeat':
        if (!g.players[c.playerId]) throw new HttpError(400, 'Unknown seat.');
        if (all.some((m) => m.seat_id === c.playerId && m.status === 'approved'))
          throw new HttpError(409, 'That seat is taken. Choose another seat.');
        if (c.profile && g.status !== 'active')
          throw new HttpError(409, 'This game has ended. Ask the host to start or reopen a game.');
        this.db
          .prepare(
            "UPDATE members SET requested_seat=?,seat_profile=?, status=CASE WHEN status='approved' THEN 'approved' ELSE 'pending' END WHERE id=?",
          )
          .run(c.playerId, c.profile ? JSON.stringify(c.profile) : null, me.id);
        break;
      case 'approve': {
        if (!g.players[c.playerId]) throw new HttpError(400, 'Unknown seat.');
        const occupant = all.find(
          (m) => m.seat_id === c.playerId && m.status === 'approved' && m.id !== target!.id,
        );
        if (occupant) {
          if (!c.replace) throw new HttpError(409, 'That seat is taken. Refresh and choose another seat.');
          if (occupant.id === r.host_id)
            throw new HttpError(409, 'Release the host’s seat before replacing its guest.');
          this.db
            .prepare("UPDATE members SET status='revoked', seat_id=NULL, requested_seat=NULL WHERE id=?")
            .run(occupant.id);
        }
        const next = target!.seat_profile
          ? this.applySeatProfile(
              g,
              c.playerId,
              seatProfileSchema.parse(JSON.parse(target!.seat_profile)),
              target!,
              operationId,
            )
          : undefined;
        this.db
          .prepare(
            "UPDATE members SET status='approved',seat_id=?,requested_seat=NULL,seat_profile=NULL WHERE id=?",
          )
          .run(c.playerId, target!.id);
        this.db
          .prepare(
            "UPDATE members SET status=CASE WHEN status='approved' THEN 'approved' ELSE 'seat-taken' END,requested_seat=NULL WHERE room_id=? AND requested_seat=? AND id<>?",
          )
          .run(r.id, c.playerId, target!.id);
        return next;
      }
      case 'reject':
        this.db
          .prepare(
            "UPDATE members SET requested_seat=NULL,status=CASE WHEN status='approved' THEN 'approved' ELSE 'rejected' END WHERE id=?",
          )
          .run(target!.id);
        break;
      case 'release':
        this.db
          .prepare('UPDATE members SET seat_id=NULL,requested_seat=NULL,status=? WHERE id=?')
          .run(target!.id === r.host_id ? 'approved' : 'pending', target!.id);
        break;
      case 'remove':
        if (target!.id === r.host_id) throw new HttpError(409, 'Transfer host before leaving.');
        this.db
          .prepare("UPDATE members SET status='revoked',seat_id=NULL,requested_seat=NULL WHERE id=?")
          .run(target!.id);
        break;
      case 'transfer':
        if (target!.status !== 'approved' || target!.id === me.id)
          throw new HttpError(409, 'Choose another approved guest.');
        r.host_id = target!.id;
        break;
      case 'lock':
        r.locked = Number(c.locked);
        break;
      case 'policy':
        if (c.everyoneEdits)
          throw new HttpError(403, 'Each player can change only their own seat in shared rooms.');
        r.everyone_edits = 0;
        break;
      case 'rotateCode':
        r.code = this.inviteCode();
        break;
    }
  }
  private authorize(r: RoomRow, g: Game, me: MemberRow, c: Command) {
    if (me.status !== 'approved')
      throw new HttpError(403, 'Wait for host approval before viewing or changing the game.');
    const host = r.host_id === me.id;
    if (c.type === 'redo')
      throw new HttpError(400, 'Shared rooms do not support redo. Use a normal correction.');
    if (c.type === 'undo') {
      if (r.undo_room_revision !== r.revision || !g.undo.length)
        throw new HttpError(409, 'An intervening change makes undo unsafe. Use a normal correction.');
      if (!canUndoRoomAction(g, me.id, me.seat_id, host))
        throw new HttpError(403, 'You can undo only your own actions affecting your assigned seat.');
      return;
    }
    if (c.type === 'groupLife')
      throw new HttpError(
        403,
        'Group life changes are available only on one device. Each room player updates their own life.',
      );
    if (
      host &&
      ['marker', 'turn', 'turnTracking', 'timer', 'trackers', 'end', 'reopen', 'rematch'].includes(c.type)
    )
      return;
    // Rolling for the table never sets the turn. Only the host may confirm it.
    if (c.type === 'roll') return;
    const seat = commandSeat(g, c),
      numeric = ['adjust', 'set', 'damage', 'damageSet', 'cast', 'castSet'].includes(c.type);
    if (
      seat &&
      (numeric || ['customize', 'editPlayer', 'commanderName', 'eliminate'].includes(c.type)) &&
      seat === me.seat_id
    )
      return;
    throw new HttpError(403, 'You can change only your assigned seat. Table controls belong to the host.');
  }
  execute(sessionHash: string, input: unknown): { receipt: Receipt; view?: RoomView } {
    const env = envelopeSchema.parse(input);
    const payloadHash = hash(JSON.stringify(env));
    let changed = false;
    const result = this.db.transaction(() => {
      this.assertSession(sessionHash);
      const me = this.member(env.roomId, sessionHash, true);
      // Look up a receipt before roles, revisions, or game IDs that a previous command may have changed.
      const old = this.db
        .prepare('SELECT payload_hash,result FROM receipts WHERE room_id=? AND actor_id=? AND operation_id=?')
        .get(env.roomId, me.id, env.operationId) as { payload_hash: string; result: string } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new HttpError(409, 'An operation ID was reused with different content.');
        return JSON.parse(old.result) as Receipt;
      }
      const r = this.room(env.roomId);
      if (me.status === 'revoked') throw new HttpError(403, 'Your room membership has been revoked.');
      let receipt: Receipt;
      try {
        // Nested transaction gives a savepoint: partial administrative writes cannot survive a rejection.
        this.db.transaction(() => {
          const g = gameSchema.parse(JSON.parse(r.game));
          if (env.gameId !== g.id)
            throw new HttpError(409, 'The match changed. This old action was not applied.');
          const admin = adminSchema.safeParse(env.command);
          if ((admin.success || !isRelative(env.command as Command)) && env.baseRevision !== r.revision)
            throw new HttpError(
              409,
              'The room changed before this action. Review the latest state and try the correction again.',
            );
          if (admin.success) {
            const next = this.administer(r, g, me, admin.data, env.operationId);
            this.commitRoom(r, next, `Room: ${admin.data.type}`, me.id, env.operationId, false);
          } else {
            const c = env.command as Command;
            this.authorize(r, g, me, c);
            if (g.undo.length && r.undo_room_revision !== r.revision) delete g.undo.at(-1)!.groupId;
            if (c.type === 'rematch') {
              this.db
                .prepare('INSERT INTO snapshots (id,room_id,game_id,game,at) VALUES (?,?,?,?,?)')
                .run(randomUUID(), r.id, g.id, r.game, this.now());
              this.db
                .prepare(
                  'DELETE FROM snapshots WHERE room_id=? AND id NOT IN (SELECT id FROM snapshots WHERE room_id=? ORDER BY rowid DESC LIMIT 10)',
                )
                .run(r.id, r.id);
            }
            const ctx = {
              id: randomUUID(),
              operationId: env.operationId,
              now: this.now(),
              actorId: me.id,
              actor: me.name,
              groupId: env.groupId,
              newGameId: c.type === 'rematch' ? randomUUID() : undefined,
              roll:
                c.type === 'roll'
                  ? makeRoll(g, c, { id: randomUUID(), now: this.now(), actor: me.name }, randomInt)
                  : undefined,
            };
            const next = reduceGame(g, c, ctx);
            next.redo = [];
            this.commitRoom(
              r,
              next,
              c.type === 'roll' ? `${me.name} rolled ${c.kind}` : (next.history.at(-1)?.summary ?? c.type),
              me.id,
              env.operationId,
              !['roll', 'undo', 'rematch'].includes(c.type),
            );
          }
        })();
        changed = true;
        receipt = {
          operationId: env.operationId,
          revision: r.revision,
          gameId: (JSON.parse(r.game) as Game).id,
          ok: true,
        };
      } catch (e) {
        if (!(e instanceof HttpError) && !(e instanceof Error && !('code' in e))) throw e;
        const current = this.room(env.roomId);
        receipt = {
          operationId: env.operationId,
          revision: current.revision,
          gameId: (JSON.parse(current.game) as Game).id,
          ok: false,
          error: e instanceof Error ? e.message : 'Action rejected',
        };
      }
      this.db
        .prepare(
          'INSERT INTO receipts (room_id,actor_id,operation_id,game_id,payload_hash,result) VALUES (?,?,?,?,?,?)',
        )
        .run(env.roomId, me.id, env.operationId, env.gameId, payloadHash, JSON.stringify(receipt));
      return receipt;
    })();
    // Commit is complete before snapshots, acknowledgements, or broadcasts leave this process.
    let view: RoomView | undefined;
    try {
      view = this.view(env.roomId, sessionHash);
    } catch {
      /* A revoked actor gets only their original receipt, never fresh room data. */
    }
    if (changed) this.onChange(env.roomId);
    return { receipt: result, view };
  }
  cleanup() {
    const now = this.now();
    // Session deletion cascades to memberships, freeing seats even when the room
    // itself is still active. Publish that change to the remaining guests too.
    const affected = this.db
      .prepare(
        `SELECT id FROM rooms WHERE expires_at <= ?
         UNION
         SELECT m.room_id AS id FROM members m
         JOIN sessions s ON s.hash = m.session_hash
         WHERE s.expires_at <= ? OR s.revoked = 1`,
      )
      .all(now, now) as { id: string }[];
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(now);
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked = 1').run(now);
      // Membership changes need a new revision so delayed snapshots and stale
      // corrections cannot restore the old seat state. Cleanup is not activity
      // and must not extend room retention or change the gameplay snapshot.
      const update = this.db.prepare(
        'UPDATE rooms SET revision=revision+1,undo_room_revision=NULL WHERE id=?',
      );
      for (const room of affected) update.run(room.id);
    })();
    for (const r of affected) this.onChange(r.id);
  }
  archives(roomId: string, sessionHash: string) {
    const view = this.view(roomId, sessionHash);
    if (view.me.status !== 'approved') throw new HttpError(403, 'Host approval required.');
    return (
      this.db
        .prepare('SELECT game FROM snapshots WHERE room_id=? ORDER BY rowid DESC LIMIT 10')
        .all(roomId) as { game: string }[]
    ).map((row) => gameSchema.parse(JSON.parse(row.game)));
  }
  recent(sessionHash: string) {
    this.assertSession(sessionHash);
    const rows = this.db
      .prepare(
        `
      SELECT r.id, r.updated_at FROM rooms r
      JOIN members m ON m.room_id = r.id
      WHERE m.session_hash = ? AND m.status != 'revoked' AND r.expires_at > ?
        AND (json_extract(r.game, '$.status') = 'active' OR
          (m.status = 'approved' AND json_extract(r.game, '$.endedAt') > ?))
      ORDER BY r.updated_at DESC LIMIT 10
    `,
      )
      .all(sessionHash, this.now(), this.now() - GAME_RECOVERY_MS) as { id: string; updated_at: number }[];
    return rows.map((r) => {
      const view = this.view(r.id, sessionHash);
      return {
        id: view.id,
        gameId: view.gameId,
        names: view.seats.map((s) => s.name),
        preset: view.game?.settings.preset ?? 'Shared room',
        updatedAt: r.updated_at,
        expiresAt: view.expiresAt,
        approved: view.me.status === 'approved',
        status: view.game?.status ?? 'active',
        recoverUntil: view.game ? recoveryDeadline(view.game) : null,
        canReopen: view.hostId === view.me.id,
      };
    });
  }
}
