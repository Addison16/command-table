import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Config } from './config.js';

type BackupStatus = {
  lastVerifiedAt: number | null;
  filename?: string;
  bytes?: number;
  sha256?: string;
  lastFailureAt?: number;
  copyVerifiedAt?: number;
  copyFailureAt?: number;
};
const scheduledName = /^scheduled-[\dTZ-]+-[a-f\d]{8}\.sqlite$/;
export function errorKind(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' &&
    ['SQLITE_BUSY', 'SQLITE_FULL', 'SQLITE_CORRUPT', 'SQLITE_IOERR', 'EACCES', 'ENOSPC'].includes(code)
    ? code
    : 'internal';
}
async function atomicJson(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function checksum(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
export function verifyBackup(filename: string) {
  const copy = new Database(filename, { fileMustExist: true });
  try {
    // A portable backup must be self-contained, without WAL/SHM sidecars.
    copy.pragma('journal_mode = DELETE');
    if (
      copy.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (copy.pragma('foreign_key_check') as unknown[]).length
    )
      throw new Error('Backup verification failed');
  } finally {
    copy.close();
  }
}

/** Private aggregate diagnostics. Never store URLs, cookies, identities or game payloads. */
export class Operations {
  private delay = monitorEventLoopDelay({ resolution: 20 });
  private durations: number[] = [];
  private requests = 0;
  private errors = 0;
  private commands = 0;
  private rejected = 0;
  private startedAt = Date.now();
  private backup: BackupStatus = { lastVerifiedAt: null };
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private db: Database.Database,
    private config: Config,
    private directory?: string,
    private connections: () => { sockets: number; rooms: number } = () => ({ sockets: 0, rooms: 0 }),
  ) {}
  request(duration: number, status: number) {
    this.requests++;
    if (status >= 500) this.errors++;
    this.durations.push(duration);
    if (this.durations.length > 256) this.durations.shift();
  }
  command(ok: boolean) {
    this.commands++;
    if (!ok) this.rejected++;
  }
  fault() {
    this.errors++;
  }
  private async bytes(filename: string) {
    try {
      return (await stat(filename)).size;
    } catch {
      return 0;
    }
  }
  async snapshot() {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const elapsed = this.delay.percentile(95) / 1e6;
    let diskFreeBytes: number | null = null;
    if (this.directory) {
      try {
        const disk = await statfs(this.directory);
        diskFreeBytes = disk.bavail * disk.bsize;
      } catch {
        /* Report unavailable. */
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      requests: this.requests,
      errors: this.errors,
      commands: this.commands,
      rejectedCommands: this.rejected,
      requestP95Ms: Math.round((sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0) * 100) / 100,
      eventLoopP95Ms: Number.isFinite(elapsed) ? Math.round(elapsed * 100) / 100 : 0,
      connections: this.connections(),
      storage: {
        databaseBytes: this.directory ? await this.bytes(this.db.name) : 0,
        walBytes: this.directory ? await this.bytes(`${this.db.name}-wal`) : 0,
        diskFreeBytes,
      },
      backups: {
        ...this.backup,
        ageHours:
          this.backup.lastVerifiedAt === null
            ? null
            : Math.round(((Date.now() - this.backup.lastVerifiedAt) / 3_600_000) * 100) / 100,
        intervalHours: this.config.backupIntervalHours,
        keep: this.config.backupKeep,
        copyConfigured: !!this.config.backupCopyDir,
      },
    };
  }
  async start() {
    if (!this.directory || this.stopped || this.timer) return;
    this.delay.enable();
    try {
      const saved = JSON.parse(
        await readFile(join(this.directory, 'backup-status.json'), 'utf8'),
      ) as BackupStatus;
      if (
        typeof saved.lastVerifiedAt === 'number' &&
        saved.filename &&
        scheduledName.test(saved.filename) &&
        (await this.bytes(join(this.directory, 'backups', saved.filename)))
      )
        this.backup = saved;
    } catch {
      /* First run or missing backup: create a new verified copy. */
    }
    if (this.stopped) return;
    this.timer = setInterval(() => {
      void this.maintain();
    }, 30_000);
    this.timer.unref();
    void this.maintain();
  }
  maintain() {
    if (!this.directory || this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    if (!this.directory) return;
    try {
      if (
        !this.backup.lastVerifiedAt ||
        Date.now() - this.backup.lastVerifiedAt >= this.config.backupIntervalHours * 3_600_000
      ) {
        try {
          await this.saveBackup();
        } catch (error) {
          this.backup.lastFailureAt = Date.now();
          console.error(JSON.stringify({ event: 'backup_failed', kind: errorKind(error) }));
          await atomicJson(join(this.directory, 'backup-status.json'), this.backup);
        }
      }
      await atomicJson(join(this.directory, 'operations.json'), await this.snapshot());
      this.delay.reset();
    } catch (error) {
      console.error(JSON.stringify({ event: 'diagnostics_failed', kind: errorKind(error) }));
    }
  }
  private async saveBackup() {
    const directory = join(this.directory!, 'backups');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = `scheduled-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`;
    const destination = join(directory, filename),
      temporary = destination + '.pending';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      await handle.close();
      await this.db.backup(temporary);
      verifyBackup(temporary);
      const digest = await checksum(temporary);
      await rename(temporary, destination);
      this.backup = {
        ...this.backup,
        lastVerifiedAt: Date.now(),
        filename,
        bytes: await this.bytes(destination),
        sha256: digest,
      };
      if (this.config.backupCopyDir) {
        const copied = join(this.config.backupCopyDir, filename),
          copying = copied + `.${randomUUID()}.pending`;
        try {
          await mkdir(this.config.backupCopyDir, { recursive: true, mode: 0o700 });
          await copyFile(destination, copying);
          await chmod(copying, 0o600);
          verifyBackup(copying);
          if ((await checksum(copying)) !== digest) throw new Error('Backup copy verification failed');
          await rename(copying, copied);
          this.backup.copyVerifiedAt = Date.now();
          await this.rotate(this.config.backupCopyDir);
        } catch (error) {
          this.backup.copyFailureAt = Date.now();
          console.error(JSON.stringify({ event: 'backup_copy_failed', kind: errorKind(error) }));
        } finally {
          await rm(copying, { force: true });
        }
      }
      await atomicJson(join(this.directory!, 'backup-status.json'), this.backup);
      await this.rotate(directory);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async rotate(directory: string) {
    const files = (await readdir(directory))
      .filter((name) => scheduledName.test(name))
      .sort()
      .reverse();
    for (const file of files.slice(this.config.backupKeep)) await rm(join(directory, file));
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
    this.delay.disable();
  }
}
