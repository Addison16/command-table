import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const image = process.argv[2] ?? 'mtg-util:local';
const name = `mtg-util-smoke-${randomUUID().slice(0, 8)}`,
  volume = `${name}-data`;
const portFinder = createServer();
await new Promise((resolve) => portFinder.listen(0, '127.0.0.1', resolve));
const port = portFinder.address().port;
await new Promise((resolve) => portFinder.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const emulator = process.env.SMOKE_QEMU;
const nodeCommand = emulator ? [emulator, '/usr/local/bin/node'] : ['node'];
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {
      /* Startup is still in progress. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Container failed to become ready.');
}
const start = () =>
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--init',
    '-p',
    `127.0.0.1:${port}:8080`,
    '-e',
    `PUBLIC_ORIGIN=${origin}`,
    '-e',
    'ALLOW_INSECURE_HTTP=true',
    '-v',
    `${volume}:/data`,
    image,
  );
async function request(path, auth, body) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      'x-mtg-client': '1',
      'Content-Type': 'application/json',
      ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, 200, `Unexpected status for ${path.replace(/[a-f\d-]{36}/g, ':roomId')}`);
  return { response, body: await response.json() };
}
async function guest() {
  const r = await request('/session', undefined, { reset: false });
  return { cookie: r.response.headers.getSetCookie()[0].split(';')[0], csrf: r.body.csrf };
}
let running = false;
try {
  docker('volume', 'create', volume);
  start();
  running = true;
  await ready();
  assert.notEqual(docker('exec', name, ...nodeCommand, '-p', 'process.getuid()'), '0');
  const architecture = docker('exec', name, ...nodeCommand, '-p', 'process.arch');
  const game = JSON.parse(
    docker(
      'exec',
      name,
      ...nodeCommand,
      '--input-type=module',
      '-e',
      "import{createGame,defaultSetup}from'./dist/server/shared/game.js';import{randomUUID}from'node:crypto';process.stdout.write(JSON.stringify(createGame(defaultSetup(),randomUUID,Date.now())))",
    ),
  );
  const host = await guest(),
    player = await guest();
  let room = (await request('/rooms', host, { game, name: 'Host' })).body;
  assert.equal(room.me.seatId, room.seats[0].id);
  const pending = (await request('/join', player, { code: room.code, name: 'Player' })).body;
  assert.equal(pending.game, undefined);
  const envelope = (command, view = room) => ({
    protocolVersion: 1,
    roomId: room.id,
    gameId: view.gameId,
    operationId: randomUUID(),
    baseRevision: view.revision,
    command,
  });
  room = (await request(`/rooms/${room.id}`, host)).body;
  const approval = (
    await request(
      `/rooms/${room.id}/command`,
      host,
      envelope({ type: 'approve', memberId: pending.me.id, playerId: room.seats[1].id, replace: false }),
    )
  ).body;
  assert.equal(approval.receipt.ok, true);
  room = approval.view;
  const op = envelope({ type: 'adjust', playerId: room.seats[1].id, field: 'life', delta: -1 });
  const changed = (await request(`/rooms/${room.id}/command`, player, op)).body;
  assert.equal(changed.receipt.ok, true);
  assert.equal(changed.view.game.players[room.seats[1].id].life, 39);
  for (const [actor, target] of [
    [host, room.seats[1].id],
    [player, room.seats[0].id],
  ]) {
    const denied = (
      await request(
        `/rooms/${room.id}/command`,
        actor,
        envelope({ type: 'adjust', playerId: target, field: 'life', delta: -1 }, changed.view),
      )
    ).body;
    assert.equal(denied.receipt.ok, false);
    assert.deepEqual(denied.view.game, changed.view.game);
  }
  assert.deepEqual((await request(`/rooms/${room.id}/command`, player, op)).body.receipt, changed.receipt);
  const assets = await fetch(origin);
  assert.equal(assets.status, 200);
  assert.match(await assets.text(), /Command Table/);
  docker('exec', name, ...nodeCommand, 'scripts/backup.mjs', '/data/verified-backup.sqlite');
  docker('stop', '--time', '5', name);
  docker('rm', name);
  running = false;
  start();
  running = true;
  await ready();
  const restored = (await request(`/rooms/${room.id}`, player)).body;
  assert.equal(restored.me.seatId, room.seats[1].id);
  assert.equal(restored.game.players[restored.me.seatId].life, 39);
  assert.deepEqual((await request(`/rooms/${room.id}/command`, player, op)).body.receipt, changed.receipt);
  const newer = (
    await request(
      `/rooms/${room.id}/command`,
      player,
      envelope({ type: 'adjust', playerId: restored.me.seatId, field: 'life', delta: -3 }, restored),
    )
  ).body;
  assert.equal(newer.view.game.players[restored.me.seatId].life, 36);
  docker('stop', '--time', '5', name);
  docker('rm', name);
  running = false;
  docker(
    'run',
    '--rm',
    '-v',
    `${volume}:/data`,
    '--entrypoint',
    emulator ?? 'node',
    image,
    ...(emulator ? ['/usr/local/bin/node'] : []),
    '-e',
    "const fs=require('node:fs');for(const p of ['/data/mtg-util.sqlite-wal','/data/mtg-util.sqlite-shm'])if(fs.existsSync(p))fs.unlinkSync(p);fs.copyFileSync('/data/verified-backup.sqlite','/data/mtg-util.sqlite');",
  );
  start();
  running = true;
  await ready();
  assert.equal((await request(`/rooms/${room.id}`, player)).body.game.players[restored.me.seatId].life, 39);
  assert.deepEqual((await request(`/rooms/${room.id}/command`, player, op)).body.receipt, changed.receipt);
  console.info(
    `PASS (${architecture}): non-root startup, native SQLite, health, assets, create/join/approve/update, duplicate receipt, container recreation, memberships, verified backup and restore.`,
  );
} finally {
  if (running) {
    try {
      docker('rm', '-f', name);
    } catch {
      /* Preserve the original failure. */
    }
  }
  try {
    docker('volume', 'rm', volume);
  } catch {
    /* A failed cleanup does not expose credentials. */
  }
}
