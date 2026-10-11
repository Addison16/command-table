import { resolve } from 'node:path';
export type Config = {
  port: number;
  dataDir: string;
  publicOrigin: string;
  secure: boolean;
  roomTtlDays: number;
  sessionTtlDays: number;
  trustProxy: number;
  production: boolean;
  maxConnections: number;
  maxRoomConnections: number;
  receiptLimit: number;
  retryRevisionWindow: number;
  backupIntervalHours: number;
  backupKeep: number;
  backupCopyDir?: string;
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.PUBLIC_ORIGIN ?? 'http://localhost:8080');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('PUBLIC_ORIGIN must be a plain http(s) origin with no path, credentials or query.');
  const insecure = env.ALLOW_INSECURE_HTTP === 'true';
  if (origin.protocol === 'http:' && !insecure)
    throw new Error(
      'HTTP requires ALLOW_INSECURE_HTTP=true for deliberate local/LAN use. Use HTTPS for public deployments.',
    );
  if (origin.protocol === 'https:' && insecure)
    throw new Error('Set ALLOW_INSECURE_HTTP=false when PUBLIC_ORIGIN uses HTTPS.');
  const integer = (value: string | undefined, fallback: number, max: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('Invalid port or retention configuration');
    return n;
  };
  const trustProxy = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5)
    throw new Error('TRUST_PROXY_HOPS must be 0–5');
  return {
    port: integer(env.PORT, 8080, 65535),
    dataDir: resolve(env.DATA_DIR ?? '.mtg-data'),
    publicOrigin: origin.origin,
    secure: origin.protocol === 'https:',
    roomTtlDays: integer(env.ROOM_TTL_DAYS, 30, 3650),
    sessionTtlDays: integer(env.SESSION_TTL_DAYS, 90, 3650),
    trustProxy,
    production,
    maxConnections: integer(env.MAX_CONNECTIONS, 512, 10000),
    maxRoomConnections: integer(env.MAX_ROOM_CONNECTIONS, 64, 1000),
    receiptLimit: integer(env.ROOM_RECEIPT_LIMIT, 20_000, 1_000_000),
    retryRevisionWindow: integer(env.RETRY_REVISION_WINDOW, 10_000, 1_000_000),
    backupIntervalHours: integer(env.BACKUP_INTERVAL_HOURS, 24, 8760),
    backupKeep: integer(env.BACKUP_KEEP, 14, 365),
    ...(env.BACKUP_COPY_DIR ? { backupCopyDir: resolve(env.BACKUP_COPY_DIR) } : {}),
  };
}
