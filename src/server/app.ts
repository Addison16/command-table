import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z, ZodError } from 'zod';
import type { WebSocket } from 'ws';
import { idSchema, nameSchema, PROTOCOL, type RoomView } from '../shared/schema.js';
import { readConfig, type Config } from './config.js';
import { openDatabase } from './database.js';
import { csrfFor, hash, HttpError, RoomService, validCsrf } from './service.js';
import { cardLookup, CardLookupError, type CardLookupService } from './cards.js';
import { TrafficBudget } from './traffic.js';
import { Operations, errorKind } from './operations.js';

export async function buildApp(
  options: { config?: Config; filename?: string; now?: () => number; cards?: CardLookupService } = {},
) {
  const config = options.config ?? readConfig();
  const filename = options.filename ?? join(config.dataDir, 'mtg-util.sqlite');
  const db = openDatabase(filename);
  const service = new RoomService(db, config, options.now);
  const operations = new Operations(
    db,
    config,
    filename === ':memory:' ? undefined : dirname(filename),
    () => ({ sockets: clients.size, rooms: byRoom.size }),
  );
  const requestStarted = new WeakMap<FastifyRequest, number>();
  const execute = (session: string, input: unknown) => {
    const result = service.execute(session, input);
    operations.command(result.receipt.ok);
    return result;
  };
  const sessionBudget = new TrafficBudget(60, 30);
  const roomBudget = new TrafficBudget(160, 80);
  const allowCommand = (session: string, room: string) => {
    const now = service.now();
    if (!sessionBudget.allow(session, now) || !roomBudget.allow(room, now))
      throw new HttpError(429, 'Changes are arriving too quickly. Wait a moment while the table catches up.');
  };
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
    requestStarted.set(req, performance.now());
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
  app.addHook('onResponse', async (req, reply) => {
    operations.request(performance.now() - (requestStarted.get(req) ?? performance.now()), reply.statusCode);
  });
  app.addHook('onReady', async () => {
    await operations.start();
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof CardLookupError && err.retryAfter) reply.header('Retry-After', err.retryAfter);
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({ error: 'Invalid request. Check names, whole numbers, and the protocol version.' });
    const e = err as Error & { statusCode?: number };
    const code = e.statusCode && e.statusCode >= 400 && e.statusCode <= 599 ? e.statusCode : 500;
    if (code >= 500)
      console.error(
        JSON.stringify({
          event: 'request_failed',
          status: code,
          method: req.method,
          route: req.routeOptions.url,
          requestId: req.id,
          kind: errorKind(err),
        }),
      );
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
  // Card routes need no session and share one upstream queue. Keep each
  // client's combined budget below that queue's pace so nobody can hold it full.
  const cardBudget = app.createRateLimit({ max: 100, timeWindow: '1 minute' });
  const cardRoute = (max: number) => ({
    config: { rateLimit: { max, timeWindow: '1 minute' } },
    preHandler: async (req: FastifyRequest) => {
      const budget = await cardBudget(req);
      if (!budget.isAllowed && budget.isExceeded)
        throw new HttpError(429, 'Too many requests. Please wait a moment.');
    },
  });
  app.get('/api/cards/suggest', cardRoute(90), async (req) => cards.suggest(cardQuery.parse(req.query).q));
  app.get('/api/cards/resolve', cardRoute(30), async (req) => cards.resolve(cardQuery.parse(req.query).q));
  app.get('/api/cards/details', cardRoute(30), async (req) => cards.details(cardQuery.parse(req.query).q));
  app.get('/api/cards/rulings', cardRoute(30), async (req) =>
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
    const session = sessionHash(req),
      id = roomId(req);
    allowCommand(session, id);
    return execute(session, req.body);
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
    lastRevision?: number;
    lastPresence?: number;
  };
  const clients = new Set<Client>();
  const byRoom = new Map<string, Set<Client>>();
  const bySession = new Map<string, Set<Client>>();
  const byMember = new Map<string, Set<Client>>();
  const presenceVersion = new Map<string, number>();
  const broadcasts = new Map<string, ReturnType<typeof setTimeout>>();
  let closing = false;
  const addClient = (index: Map<string, Set<Client>>, id: string, client: Client) => {
    let group = index.get(id);
    if (!group) {
      group = new Set();
      index.set(id, group);
    }
    group.add(client);
  };
  const removeClient = (index: Map<string, Set<Client>>, id: string, client: Client) => {
    const group = index.get(id);
    group?.delete(client);
    if (!group?.size) index.delete(id);
  };
  const safeSend = (client: Client, data: Record<string, unknown> & { view?: RoomView }) => {
    if (client.socket.readyState !== 1) return;
    if (client.socket.bufferedAmount > 1_000_000) {
      client.socket.close(1013, 'Connection too slow; reconnect');
      return;
    }
    const metadata = JSON.stringify({ ...data, view: undefined });
    const encoded = data.view
      ? `${metadata.slice(0, -1)},"view":${service.serializeView(data.view)}}`
      : metadata;
    client.socket.send(encoded);
    if (data.view) {
      client.lastRevision = data.view.revision;
      client.lastPresence = presenceVersion.get(client.roomId) ?? 0;
    }
  };
  const broadcast = (id: string) => {
    const listeners = byRoom.get(id);
    if (!listeners?.size) return;
    let snapshot: ReturnType<RoomService['snapshot']>;
    try {
      snapshot = service.snapshot(id);
    } catch {
      for (const client of listeners) client.socket.close(4003, 'Room access ended');
      return;
    }
    for (const c of listeners) {
      if (c.lastRevision === snapshot.room.revision && c.lastPresence === (presenceVersion.get(id) ?? 0))
        continue;
      try {
        safeSend(c, { type: 'state', view: service.view(id, c.session, snapshot) });
      } catch {
        c.socket.close(4003, 'Room access ended');
      }
    }
  };
  const scheduleBroadcast = (id: string) => {
    if (closing || broadcasts.has(id)) return;
    const timer = setTimeout(() => {
      broadcasts.delete(id);
      broadcast(id);
    }, 16);
    timer.unref();
    broadcasts.set(id, timer);
  };
  service.onChange = scheduleBroadcast;
  service.presence = (id) => [...(byMember.get(id) ?? [])].some((c) => c.socket.readyState === 1);
  app.get(
    '/api/rooms/:roomId/live',
    {
      websocket: true,
      preValidation: async (req) => {
        if ((req.query as { protocol?: string }).protocol !== String(PROTOCOL))
          throw new HttpError(426, 'Update your app to reconnect.');
        const id = sessionHash(req);
        const room = roomId(req);
        service.view(room, id);
        if (
          clients.size >= config.maxConnections ||
          (byRoom.get(room)?.size ?? 0) >= config.maxRoomConnections
        )
          throw new HttpError(503, 'This table is busy. Close unused connections and reconnect in a moment.');
        if ((bySession.get(id)?.size ?? 0) >= 12)
          throw new HttpError(429, 'Close unused tabs before opening another room connection.');
      },
    },
    (socket, req) => {
      const session = sessionHash(req),
        id = roomId(req),
        member = service.member(id, session);
      // Recheck after asynchronous upgrade validation: simultaneous upgrades
      // must not race past the shared admission limits.
      if (
        clients.size >= config.maxConnections ||
        (byRoom.get(id)?.size ?? 0) >= config.maxRoomConnections ||
        (bySession.get(session)?.size ?? 0) >= 12
      ) {
        socket.close(1013, 'Connection limit reached; close unused tabs');
        return;
      }
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
      addClient(byRoom, id, client);
      addClient(bySession, session, client);
      addClient(byMember, member.id, client);
      presenceVersion.set(id, (presenceVersion.get(id) ?? 0) + 1);
      socket.on('message', (raw) => {
        if (closing) return;
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
          allowCommand(session, id);
          const result = execute(session, env);
          safeSend(client, { type: 'ack', ...result });
        } catch (e) {
          if (!(e instanceof HttpError) && !(e instanceof ZodError) && !(e instanceof SyntaxError)) {
            operations.fault();
            console.error(JSON.stringify({ event: 'socket_command_failed', kind: errorKind(e) }));
          }
          const error =
            e instanceof ZodError || e instanceof SyntaxError
              ? 'Invalid socket command.'
              : e instanceof HttpError
                ? e.message
                : 'This change could not be saved. Reconnect to check its result.';
          safeSend(client, { type: 'error', error });
          if (e instanceof HttpError && [401, 403].includes(e.statusCode))
            socket.close(4003, 'Authority ended');
          else if (e instanceof HttpError && e.statusCode === 429)
            socket.close(1013, 'Wait for the command budget to recover');
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
        removeClient(byRoom, id, client);
        removeClient(bySession, session, client);
        removeClient(byMember, member.id, client);
        if (!byRoom.has(id)) presenceVersion.delete(id);
        else {
          presenceVersion.set(id, (presenceVersion.get(id) ?? 0) + 1);
          scheduleBroadcast(id);
        }
      });
      safeSend(client, { type: 'ready', view: service.view(id, session) });
      scheduleBroadcast(id);
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
  const cleanup = setInterval(() => {
    try {
      service.cleanup();
    } catch (error) {
      operations.fault();
      console.error(JSON.stringify({ event: 'cleanup_failed', kind: errorKind(error) }));
    }
  }, 60000);
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
    closing = true;
    clearInterval(heartbeat);
    clearInterval(cleanup);
    for (const timer of broadcasts.values()) clearTimeout(timer);
    broadcasts.clear();
    for (const c of clients) c.socket.close(1001, 'Server restarting');
    await operations.stop();
    db.close();
  });
  return { app, service, db };
}
