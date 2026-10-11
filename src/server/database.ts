import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 3) {
    db.close();
    throw new Error('Database schema is newer than this server. Restore the newer application version.');
  }
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE rooms (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, game TEXT NOT NULL, host_id TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, everyone_edits INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, undo_room_revision INTEGER);
      CREATE TABLE members (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE, name TEXT NOT NULL, seat_id TEXT, requested_seat TEXT, status TEXT NOT NULL, UNIQUE(room_id, session_hash));
      CREATE UNIQUE INDEX one_guest_per_seat ON members(room_id, seat_id) WHERE seat_id IS NOT NULL AND status = 'approved';
      CREATE INDEX members_by_session ON members(session_hash);
      CREATE TABLE receipts (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, game_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(room_id, actor_id, operation_id));
      CREATE TABLE events (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, revision INTEGER NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, summary TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(room_id, revision));
      CREATE TABLE snapshots (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, game_id TEXT NOT NULL, game TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX rooms_expiry ON rooms(expires_at);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      PRAGMA user_version = 1;
    `);
    })();
  if (version < 2)
    db.transaction(() => {
      db.exec('ALTER TABLE members ADD COLUMN seat_profile TEXT; PRAGMA user_version = 2;');
    })();
  if (version < 3)
    db.transaction(() => {
      db.exec(`
        ALTER TABLE rooms ADD COLUMN retry_floor_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE rooms ADD COLUMN receipt_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE receipts ADD COLUMN base_revision INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX receipts_retention ON receipts(room_id, base_revision);
        CREATE INDEX snapshots_by_room ON snapshots(room_id);
        UPDATE rooms SET receipt_count=(SELECT count(*) FROM receipts WHERE room_id=rooms.id);
        PRAGMA user_version = 3;
      `);
    })();
  return db;
}
