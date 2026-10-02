import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z, ZodError } from 'zod';
import type { WebSocket } from 'ws';
import { idSchema, nameSchema, PROTOCOL } from '../shared/schema.js';
import { readConfig, type Config } from './config.js';
import { openDatabase } from './database.js';
import { csrfFor, hash, HttpError, RoomService, validCsrf } from './service.js';
import { cardLookup, CardLookupError, type CardLookupService } from './cards.js';

export async function buildApp(
  options: { config?: Config; filename?: string; now?: () => number; cards?: CardLookupService } = {},
) {
  const config = options.config ?? readConfig();
  const db = openDatabase(options.filename ?? join(config.dataDir, 'mtg-util.sqlite'));
  const service = new RoomService(db, config, options.now);
  // URLs, cookies, credentials and player payloads are intentionally not logged.
  const app = Fastify({
    logger: false,
    bodyLimit: 2_000_000,
    trustProxy: config.trustProxy ? (_address, hop) => hop < config.trustProxy : false,
    requestTimeout: 15000,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 6000,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new HttpError(429, 'Too many requests. Please wait a moment.'),
  });
  await app.register(websocket, { options: { maxPayload: 16_384, perMessageDeflate: false } });
  const sessionHash = (req: FastifyRequest) => {
    const token = req.cookies.mtg_guest;
    if (!token) throw new HttpError(401, 'A guest session is required.');
    const id = hash(token);
    service.assertSession(id);
    return id;
  };
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (config.production)
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cards.scryfall.io; font-src 'self'; connect-src 'self' https://cards.scryfall.io; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    const upgrade = req.headers.upgrade?.toLowerCase() === 'websocket';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || upgrade) {
      if (req.headers.origin !== config.publicOrigin)
        throw new HttpError(403, 'Origin is not allowed. Check PUBLIC_ORIGIN for this site address.');
      if (!upgrade) {
        if (req.headers['x-mtg-client'] !== String(PROTOCOL))
          throw new HttpError(426, 'Please update or reload Command Table before continuing.');
        if (req.url !== '/api/session') {
          const token = req.cookies.mtg_guest,
            csrf = req.headers['x-csrf-token'];
          if (!token || typeof csrf !== 'string' || !validCsrf(token, csrf))
            throw new HttpError(403, 'Session verification failed. Reconnect and try again.');
        }
      }
    }
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof CardLookupError && err.retryAfter) reply.header('Retry-After', err.retryAfter);
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({ error: 'Invalid request. Check names, whole numbers, and the protocol version.' });
    const e = err as Error & { statusCode?: number };
    const code = e.statusCode && e.statusCode >= 400 && e.statusCode <= 599 ? e.statusCode : 500;
    return reply
      .code(code)
      .send({ error: code === 500 ? 'The server could not save this change. Please retry.' : e.message });
  });
  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE type=?').get('table');
    return { ok: true, protocolVersion: PROTOCOL };
  });
  const cards = options.cards ?? cardLookup;
  const cardQuery = z.object({ q: z.string().trim().max(512).default('') });
  app.get('/api/cards/suggest', { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } }, async (req) =>
    cards.suggest(cardQuery.parse(req.query).q),
  );
  app.get('/api/cards/resolve', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    cards.resolve(cardQuery.parse(req.query).q),
  );
  app.get('/api/cards/details', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    cards.details(cardQuery.parse(req.query).q),
  );
  app.get('/api/cards/rulings', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    cards.rulings(z.object({ id: idSchema }).parse(req.query).id),
  );
  app.post(
    '/api/session',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.strictObject({ reset: z.boolean().default(false) }).parse(req.body);
      const result = service.session(req.cookies.mtg_guest, body.reset);
      reply.setCookie('mtg_guest', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: config.secure,
        expires: new Date(result.expiresAt),
        maxAge: config.sessionTtlDays * 86400,
      });
      return { csrf: csrfFor(result.token), serverTime: service.now(), expiresAt: result.expiresAt };
    },
  );
  app.post('/api/rooms', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .strictObject({ game: z.unknown(), name: nameSchema, hostPlayerId: idSchema.optional() })
      .parse(req.body);
    return service.create(sessionHash(req), body.game, body.name, body.hostPlayerId);
  });
  app.post('/api/join', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.strictObject({ code: z.string().max(20), name: nameSchema }).parse(req.body);
    return service.join(sessionHash(req), body.code, body.name);
  });
  const roomId = (req: FastifyRequest) => idSchema.parse((req.params as { roomId: string }).roomId);
  app.get('/api/rooms/:roomId', async (req) => service.view(roomId(req), sessionHash(req)));
  app.get('/api/rooms', async (req) => service.recent(sessionHash(req)));
  app.get('/api/rooms/:roomId/archives', async (req) => service.archives(roomId(req), sessionHash(req)));
  app.post('/api/rooms/:roomId/command', { bodyLimit: 16_384 }, async (req) => {
    const body = req.body as { roomId?: string; protocolVersion?: number } | undefined;
    if (body?.protocolVersion !== PROTOCOL) throw new HttpError(426, 'Please update or reload this app.');
    if (body?.roomId !== roomId(req)) throw new HttpError(400, 'Room identity mismatch.');
    return service.execute(sessionHash(req), req.body);
  });
  type Client = {
    socket: WebSocket;
    session: string;
    roomId: string;
    memberId: string;
    token: string;
    alive: boolean;
    tokens: number;
    sampledAt: number;
  };
  const clients = new Set<Client>();
  const safeSend = (client: Client, data: unknown) => {
    if (client.socket.readyState !== 1) return;
    if (client.socket.bufferedAmount > 1_000_000) {
      client.socket.close(1013, 'Connection too slow; reconnect');
      return;
    }
    client.socket.send(JSON.stringify(data));
  };
  const broadcast = (id: string) => {
    for (const c of clients)
      if (c.roomId === id) {
        try {
          safeSend(c, { type: 'state', view: service.view(id, c.session) });
        } catch {
          c.socket.close(4003, 'Room access ended');
        }
      }
  };
  service.onChange = (id) => queueMicrotask(() => broadcast(id));
  service.presence = (id) => [...clients].some((c) => c.memberId === id && c.socket.readyState === 1);
  app.get(
    '/api/rooms/:roomId/live',
    {
      websocket: true,
      preValidation: async (req) => {
        if ((req.query as { protocol?: string }).protocol !== String(PROTOCOL))
          throw new HttpError(426, 'Update your app to reconnect.');
        const id = sessionHash(req);
        service.view(roomId(req), id);
        if ([...clients].filter((c) => c.session === id).length >= 12)
          throw new HttpError(429, 'Close unused tabs before opening another room connection.');
      },
    },
    (socket, req) => {
      const session = sessionHash(req),
        id = roomId(req),
        member = service.member(id, session);
      const client: Client = {
        socket,
        session,
        roomId: id,
        memberId: member.id,
        token: req.cookies.mtg_guest!,
        alive: true,
        tokens: 160,
        sampledAt: Date.now(),
      };
      clients.add(client);
      socket.on('message', (raw) => {
        try {
          const now = Date.now();
          client.tokens = Math.min(160, client.tokens + (now - client.sampledAt) / 10);
          client.sampledAt = now;
          if (client.tokens < 1) {
            socket.close(1008, 'Command rate exceeded');
            return;
          }
          client.tokens--;
          service.assertSession(session);
          service.room(id);
          const data = z
            .discriminatedUnion('type', [
              z.strictObject({ type: z.literal('ping') }),
              z.strictObject({
                type: z.literal('command'),
                csrf: z.string().max(128),
                envelope: z.unknown(),
              }),
            ])
            .parse(JSON.parse(raw.toString()));
          if (data.type === 'ping') {
            service.member(id, session);
            client.alive = true;
            safeSend(client, { type: 'pong', serverTime: service.now() });
            return;
          }
          if (!validCsrf(client.token, data.csrf))
            throw new HttpError(403, 'Session verification failed. Reconnect.');
          const env = data.envelope as { roomId?: string; protocolVersion?: number } | undefined;
          if (env?.protocolVersion !== PROTOCOL) throw new HttpError(426, 'Update your app to keep playing.');
          if (env?.roomId !== id) throw new HttpError(400, 'Only the subscribed room can be changed.');
          const result = service.execute(session, env);
          safeSend(client, { type: 'ack', ...result });
        } catch (e) {
          const error =
            e instanceof ZodError || e instanceof SyntaxError
              ? 'Invalid socket command.'
              : e instanceof HttpError
                ? e.message
                : 'This change could not be saved. Reconnect to check its result.';
          safeSend(client, { type: 'error', error });
          if (e instanceof HttpError && [401, 403].includes(e.statusCode))
            socket.close(4003, 'Authority ended');
        }
      });
      socket.on('pong', () => {
        client.alive = true;
      });
      socket.on('error', () => {
        /* Close clears presence; no payload logging. */
      });
      socket.on('close', () => {
        clients.delete(client);
        broadcast(id);
      });
      safeSend(client, { type: 'ready', view: service.view(id, session) });
      broadcast(id);
    },
  );
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      try {
        service.assertSession(c.session);
        service.member(c.roomId, c.session);
        service.room(c.roomId);
      } catch {
        c.socket.close(4003, 'Authority ended');
        continue;
      }
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }, 25000);
  heartbeat.unref();
  const cleanup = setInterval(() => service.cleanup(), 60000);
  cleanup.unref();
  const root = resolve('dist/client');
  if (existsSync(join(root, 'index.html'))) {
    await app.register(staticFiles, {
      root,
      setHeaders(reply, path) {
        reply.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Endpoint not found' });
      if (req.method !== 'GET' || /\.[a-z0-9]+(?:\?|$)/i.test(req.url))
        return reply.code(404).send('Not found');
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    clearInterval(cleanup);
    for (const c of clients) c.socket.close(1001, 'Server restarting');
    db.close();
  });
  return { app, service, db };
}
