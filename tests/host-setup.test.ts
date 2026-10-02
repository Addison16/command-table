import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/database.js';
import { hash, RoomService } from '../src/server/service.js';
import { createGame, defaultSetup } from '../src/shared/game.js';

const config = readConfig({
  PUBLIC_ORIGIN: 'http://localhost:5173',
  ALLOW_INSECURE_HTTP: 'true',
});
const close: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  while (close.length) await close.pop()!();
});

function fixture() {
  const db = openDatabase(':memory:');
  close.push(() => {
    db.close();
  });
  const service = new RoomService(db, config);
  const host = hash(service.session(undefined, true).token);
  const setup = defaultSetup(2);
  setup.seats[0].commanders = ['Tymna the Weaver', 'Thrasios, Triton Hero'];
  const game = createGame(setup, randomUUID, Date.now());
  return { db, service, host, game };
}

describe('host player setup', () => {
  it('reserves the first seat for older clients and retains its commanders', () => {
    const f = fixture();
    const room = f.service.create(f.host, f.game, '  Mira  ');
    expect(room.me.seatId).toBe(f.game.order[0]);
    expect(room.me.name).toBe('Mira');
    expect(room.game!.players[room.me.seatId!].name).toBe('Mira');
    expect(room.seats.map((seat) => seat.taken)).toEqual([true, false]);
    expect(room.game!.commanders).toEqual(f.game.commanders);
    expect(f.service.view(room.id, f.host).me.seatId).toBe(room.me.seatId);

    const guest = hash(f.service.session(undefined, true).token);
    const joined = f.service.join(guest, room.code!, 'Alex');
    const attempt = f.service.execute(guest, {
      protocolVersion: 1,
      roomId: room.id,
      gameId: room.gameId,
      operationId: randomUUID(),
      baseRevision: joined.revision,
      command: { type: 'requestSeat', playerId: room.me.seatId!, profile: { name: 'Alex' } },
    });
    expect(attempt.receipt.ok).toBe(false);
    expect(attempt.receipt.error).toMatch(/taken/);
    expect(f.service.view(room.id, f.host).me.seatId).toBe(room.me.seatId);
  });

  it('assigns an explicitly selected host seat without changing the other players', () => {
    const f = fixture();
    const room = f.service.create(f.host, f.game, 'Mira', f.game.order[1]);
    expect(room.me.seatId).toBe(f.game.order[1]);
    expect(room.game!.players[f.game.order[0]]).toEqual(f.game.players[f.game.order[0]]);
    expect(room.seats.map((seat) => ({ name: seat.name, taken: seat.taken }))).toEqual([
      { name: 'Player 1', taken: false },
      { name: 'Mira', taken: true },
    ]);
  });

  it('rejects an unknown host seat without creating a room or membership', () => {
    const f = fixture();
    expect(() => f.service.create(f.host, f.game, 'Mira', randomUUID())).toThrow(/existing player/);
    expect(f.db.prepare('SELECT id FROM rooms').all()).toEqual([]);
    expect(f.db.prepare('SELECT id FROM members').all()).toEqual([]);
  });

  it('accepts the host seat through the room creation endpoint', async () => {
    const { app } = await buildApp({ config, filename: ':memory:' });
    close.push(() => app.close());
    const headers = { origin: config.publicOrigin, 'x-mtg-client': '1' };
    const session = await app.inject({ method: 'POST', url: '/api/session', headers, payload: {} });
    const game = createGame(defaultSetup(2, false), randomUUID, Date.now());
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: {
        ...headers,
        'x-csrf-token': session.json().csrf,
        cookie: `mtg_guest=${session.cookies[0].value}`,
      },
      payload: { game, name: 'Mira', hostPlayerId: game.order[1] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().me.seatId).toBe(game.order[1]);
    expect(response.json().game.players[game.order[1]].name).toBe('Mira');
  });
});
