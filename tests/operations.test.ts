import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/server/database.js';
import { readConfig } from '../src/server/config.js';
import { Operations, errorKind, verifyBackup } from '../src/server/operations.js';
afterEach(() => vi.restoreAllMocks());
describe('private operations and verified backups', () => {
  it('creates restorable backups, verifies a separate copy, rotates only scheduled files, and reports aggregates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mtg-operations-'));
    const db = openDatabase(join(dir, 'mtg-util.sqlite'));
    const config = readConfig({
      PUBLIC_ORIGIN: 'http://localhost:8080',
      ALLOW_INSECURE_HTTP: 'true',
      DATA_DIR: dir,
      BACKUP_KEEP: '2',
      BACKUP_COPY_DIR: join(dir, 'second-disk'),
    });
    const ops = new Operations(db, config, dir, () => ({ sockets: 3, rooms: 1 }));
    try {
      db.prepare('INSERT INTO sessions (hash,expires_at) VALUES (?,?)').run(
        'private-session',
        Date.now() + 1000,
      );
      ops.request(12, 200);
      ops.request(20, 500);
      ops.command(true);
      ops.command(false);
      await ops.start();
      await ops.maintain();
      let snapshot = await ops.snapshot();
      expect(snapshot).toMatchObject({
        requests: 2,
        errors: 1,
        commands: 2,
        rejectedCommands: 1,
        requestP95Ms: 20,
        connections: { sockets: 3, rooms: 1 },
        backups: { copyConfigured: true },
      });
      expect(snapshot.backups.sha256).toMatch(/^[a-f\d]{64}$/);
      expect(snapshot.backups.copyVerifiedAt).toBeGreaterThan(0);
      expect((await stat(join(dir, 'operations.json'))).mode & 0o777).toBe(0o600);
      const copy = new Database(join(dir, 'backups', snapshot.backups.filename!), { readonly: true });
      try {
        expect(copy.prepare('SELECT hash FROM sessions').pluck().get()).toBe('private-session');
      } finally {
        copy.close();
      }
      await writeFile(join(dir, 'backups', 'manual-backup.sqlite'), 'preserve me');
      const now = Date.now(),
        clock = vi.spyOn(Date, 'now');
      for (let day = 1; day <= 3; day++) {
        clock.mockReturnValue(now + day * 86_400_000);
        await ops.maintain();
      }
      const files = await readdir(join(dir, 'backups'));
      expect(files.filter((name) => name.startsWith('scheduled-'))).toHaveLength(2);
      expect(files).toContain('manual-backup.sqlite');
      expect(await readdir(config.backupCopyDir!)).toHaveLength(2);
      snapshot = await ops.snapshot();
      expect(snapshot.backups.ageHours).toBe(0);
      expect(await readFile(join(dir, 'operations.json'), 'utf8')).not.toContain('private-session');
      verifyBackup(join(dir, 'backups', snapshot.backups.filename!));
    } finally {
      await ops.stop();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rejects structurally invalid backups and sanitizes diagnostic errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mtg-invalid-backup-'));
    const filename = join(dir, 'invalid.sqlite'),
      db = new Database(filename);
    try {
      db.pragma('foreign_keys = OFF');
      db.exec(
        'CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (99);',
      );
      db.close();
      expect(() => verifyBackup(filename)).toThrow(/verification/i);
      expect(errorKind({ code: 'SQLITE_FULL', message: 'secret payload' })).toBe('SQLITE_FULL');
      expect(errorKind({ code: 'secret payload' })).toBe('internal');
    } finally {
      if (db.open) db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
