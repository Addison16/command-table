import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { createGame, defaultSetup } from '../src/shared/game.js';
import { csrfFor, hash } from '../src/server/service.js';
import type { Receipt, RoomView } from '../src/shared/schema.js';
type Frame = { type: string; view?: RoomView; receipt?: Receipt };
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Socket expectation timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
describe('shared socket delivery and command budgets', () => {
  it('coalesces observers and avoids sending the actor the same state twice while retaining lobby privacy', async () => {
    const config = readConfig({
      PUBLIC_ORIGIN: 'http://localhost:8080',
      ALLOW_INSECURE_HTTP: 'true',
      MAX_CONNECTIONS: '2',
    });
    const { app, service } = await buildApp({ config, filename: ':memory:' });
    const sockets: WebSocket[] = [];
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      const host = service.session(undefined, true),
        guest = service.session(undefined, true);
      const room = service.create(
        hash(host.token),
        createGame(defaultSetup(), randomUUID, Date.now()),
        'Host',
      );
      service.join(hash(guest.token), room.code!, 'Pending');
      const connect = (token: string) => {
        const frames: Frame[] = [];
        const socket = new WebSocket(
          `${origin.replace('http:', 'ws:')}/api/rooms/${room.id}/live?protocol=1`,
          { headers: { origin: config.publicOrigin, cookie: `mtg_guest=${token}` } },
        );
        sockets.push(socket);
        socket.on('message', (raw) => frames.push(JSON.parse(String(raw))));
        return { socket, frames };
      };
      const actor = connect(host.token),
        observer = connect(guest.token);
      await until(
        () => actor.frames.some((f) => f.type === 'ready') && observer.frames.some((f) => f.type === 'ready'),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      actor.frames.length = 0;
      observer.frames.length = 0;
      for (let i = 0; i < 3; i++)
        actor.socket.send(
          JSON.stringify({
            type: 'command',
            csrf: csrfFor(host.token),
            envelope: {
              protocolVersion: 1,
              roomId: room.id,
              gameId: room.gameId,
              baseRevision: room.revision,
              operationId: randomUUID(),
              command: { type: 'adjust', playerId: room.me.seatId!, field: 'life', delta: -1 },
            },
          }),
        );
      await until(
        () =>
          actor.frames.filter((f) => f.type === 'ack').length === 3 &&
          observer.frames.some((f) => f.type === 'state'),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(actor.frames.filter((f) => f.type === 'state')).toHaveLength(0);
      expect(actor.frames.at(-1)!.view!.game!.players[room.me.seatId!].life).toBe(37);
      const states = observer.frames.filter((f) => f.type === 'state');
      expect(states).toHaveLength(1);
      expect(states[0].view).not.toHaveProperty('game');
      expect(states[0].view).not.toHaveProperty('code');
      expect(states[0].view!.members).toHaveLength(1);
      const denied = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(
          `${origin.replace('http:', 'ws:')}/api/rooms/${room.id}/live?protocol=1`,
          { headers: { origin: config.publicOrigin, cookie: `mtg_guest=${host.token}` } },
        );
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          socket.terminate();
          resolve(response.statusCode!);
        });
        socket.on('error', () => {
          /* Admission rejection closes the failed upgrade. */
        });
        socket.on('open', () => {
          sockets.push(socket);
          reject(new Error('Admission limit was bypassed'));
        });
      });
      expect(denied).toBe(503);
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
    }
  });
  it('shares one session command allowance across two sockets', async () => {
    const config = readConfig({ PUBLIC_ORIGIN: 'http://localhost:8080', ALLOW_INSECURE_HTTP: 'true' });
    const now = Date.now();
    const { app, service, db } = await buildApp({ config, filename: ':memory:', now: () => now });
    const sockets: WebSocket[] = [];
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      const host = service.session(undefined, true);
      const room = service.create(hash(host.token), createGame(defaultSetup(), randomUUID, now), 'Host');
      let ready = 0,
        acknowledged = 0,
        refused = 0;
      for (let i = 0; i < 2; i++) {
        const socket = new WebSocket(
          `${origin.replace('http:', 'ws:')}/api/rooms/${room.id}/live?protocol=1`,
          { headers: { origin: config.publicOrigin, cookie: `mtg_guest=${host.token}` } },
        );
        socket.on('message', (raw) => {
          const frame = JSON.parse(String(raw));
          if (frame.type === 'ready') ready++;
          if (frame.type === 'ack') acknowledged++;
          if (frame.type === 'error') refused++;
        });
        sockets.push(socket);
      }
      await until(() => ready === 2);
      for (let i = 0; i < 61; i++)
        sockets[i % 2].send(
          JSON.stringify({
            type: 'command',
            csrf: csrfFor(host.token),
            envelope: {
              protocolVersion: 1,
              roomId: room.id,
              gameId: room.gameId,
              baseRevision: room.revision,
              operationId: randomUUID(),
              command: { type: 'adjust', playerId: room.me.seatId!, field: 'life', delta: -1 },
            },
          }),
        );
      await until(() => acknowledged === 60 && refused === 1);
      expect(db.prepare('SELECT count(*) FROM receipts').pluck().get()).toBe(60);
      expect(service.view(room.id, hash(host.token)).game!.players[room.me.seatId!].life).toBe(-20);
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
    }
  });
});
