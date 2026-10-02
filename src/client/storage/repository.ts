import { openDB, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import {
  gameSchema,
  setupSchema,
  recentRoomSchema,
  type RecentRoom,
  type Game,
  type Envelope,
  type RoomView,
} from '../../shared/schema.js';
import { newId } from '../../shared/random.js';
import { recoveryDeadline, reduceGame, type Context } from '../../shared/game.js';
import {
  accentColors,
  colorThemes,
  defaultAppearance,
  tableFinishes,
} from '../features/appearancePresets.js';

const preferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationId: z.string().uuid(),
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    colorTheme: z.enum(colorThemes.map((option) => option.id)).default(defaultAppearance.colorTheme),
    accentColor: z.enum(accentColors.map((option) => option.id)).default(defaultAppearance.accentColor),
    tableFinish: z.enum(tableFinishes.map((option) => option.id)).default(defaultAppearance.tableFinish),
    effects: z.enum(['full', 'reduced', 'off']),
    audio: z.boolean(),
    haptics: z.boolean(),
    wake: z.boolean(),
    rotations: z.record(z.string(), z.boolean()),
    tableLayout: z.enum(['upright', 'shared']).default('upright'),
    autoTableLayout: z.boolean().default(true),
    rotationDefaultsVersion: z.literal(1).optional(),
    lastMode: z.enum(['local', 'room']).nullable(),
    roomId: z.string().nullable(),
    displayName: z.string().max(40),
    view: z.enum(['table', 'mine']),
    mySeat: z.string().nullable(),
    setup: setupSchema.optional(),
  })
  .transform((profile) => ({
    ...profile,
    // Adopt device rotation for existing browsers once. Subsequent manual choices
    // save this marker with the profile and continue to survive reloads.
    autoTableLayout: profile.rotationDefaultsVersion === 1 ? profile.autoTableLayout : true,
    rotationDefaultsVersion: 1 as const,
  }));
export type Profile = z.infer<typeof preferencesSchema>;
export const initialProfile = (): Profile => ({
  schemaVersion: 1,
  installationId: newId(),
  ...defaultAppearance,
  effects: 'full',
  audio: false,
  haptics: false,
  wake: false,
  rotations: {},
  tableLayout: 'upright',
  autoTableLayout: true,
  rotationDefaultsVersion: 1,
  lastMode: null,
  roomId: null,
  displayName: '',
  view: 'table',
  mySeat: null,
});
export class ConflictError extends Error {}
type Stored = { game: Game; owner: string; until: number };
export class Repository {
  db?: IDBPDatabase;
  memory = false;
  warning = '';
  corrupt: unknown;
  private fallback = new Map<string, unknown>();
  constructor(
    public tabId: string,
    public databaseName = 'mtg-util',
  ) {}
  async open() {
    try {
      this.db = await openDB(this.databaseName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
        },
        blocked: () => {
          this.warning = 'Close older Command Table tabs to finish the storage update.';
        },
      });
    } catch {
      this.memory = true;
      this.warning = 'Changes aren’t being saved. Browser storage is unavailable. Export before leaving.';
    }
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.memory ? (this.fallback.get(key) as T | undefined) : this.db!.get('records', key);
  }
  async put(key: string, value: unknown) {
    if (this.memory) this.fallback.set(key, structuredClone(value));
    else await this.db!.put('records', value, key);
  }
  async profile(): Promise<Profile> {
    const stored = await this.get('profile');
    if (!stored) {
      const p = initialProfile();
      await this.put('profile', p);
      return p;
    }
    const result = preferencesSchema.safeParse(stored);
    if (!result.success)
      throw new Error(
        'Saved preferences are unreadable or from a newer version. Export recovery data before resetting.',
      );
    return result.data;
  }
  async active(): Promise<{ game?: Game; readOnly: boolean }> {
    const stored = await this.get<Stored>('active');
    if (!stored) return { readOnly: false };
    const parsed = gameSchema.safeParse(stored.game);
    if (!parsed.success) {
      this.corrupt = stored;
      throw new Error(
        'This saved game is damaged or needs a newer app. Its data has been preserved. Export recovery data or restore the previous checkpoint.',
      );
    }
    return { game: parsed.data, readOnly: stored.owner !== this.tabId && stored.until > Date.now() };
  }
  async commit(
    game: Game,
    expected?: Game,
    replace = false,
    takeover = false,
    resumeId?: string,
    reopen?: Context,
  ) {
    if (this.corrupt && !replace) throw new Error('Resolve saved-data recovery before saving a new game');
    const now = Date.now();
    const tx = this.memory ? undefined : this.db!.transaction('records', 'readwrite');
    // A failed request can reject before we reach the final completion await.
    // Observe that rejection now; awaiting the original promise still throws.
    void tx?.done.catch(() => {});
    const records = tx?.store ?? {
      get: (key: string) => this.get(key),
      put: (value: unknown, key: string) => this.put(key, value),
    };
    const old = (await records.get('active')) as Stored | undefined;
    const standby = ((await records.get('standby')) as Game[] | undefined) ?? [];
    if (resumeId) {
      const unfinished = (await records.get('unfinished')) as Game[] | undefined;
      const archive = (await records.get('archive')) as Game[] | undefined;
      const saved = [old?.game, ...standby, ...(unfinished ?? []), ...(archive ?? [])].find(
        (g) => g?.id === resumeId,
      );
      if (!saved) {
        tx?.abort();
        await tx?.done.catch(() => {});
        throw new Error('This saved game is no longer available.');
      }
      game = gameSchema.parse(saved);
      if (reopen) {
        try {
          game = reduceGame(game, { type: 'reopen' }, { ...reopen, now });
        } catch (error) {
          tx?.abort();
          await tx?.done.catch(() => {});
          throw error;
        }
      }
    }
    if (!takeover && old && old.owner !== this.tabId && old.until > now) {
      tx?.abort();
      await tx?.done.catch(() => {});
      throw new ConflictError('Another tab is editing this game. Take over here to continue.');
    }
    if (
      !replace &&
      expected &&
      (!old || old.game.id !== expected.id || old.game.revision !== expected.revision)
    ) {
      tx?.abort();
      await tx?.done.catch(() => {});
      throw new ConflictError(
        'Another tab saved a newer game. The committed game has been reloaded; your change was not applied.',
      );
    }
    if (old && gameSchema.safeParse(old.game).success) {
      await records.put(old.game, 'checkpoint');
      if (replace || old.game.id !== game.id) {
        const archive = ((await records.get('archive')) as Game[] | undefined) ?? [];
        const rematch = !replace && old.game.id !== game.id;
        const snapshot = rematch ? { ...old.game, status: 'ended' as const } : old.game;
        await records.put(
          [snapshot, ...archive.filter((g) => g.id !== old.game.id && g.id !== game.id)].slice(0, 10),
          'archive',
        );
        const unfinished = ((await records.get('unfinished')) as Game[] | undefined) ?? archive;
        await records.put(
          [
            ...(snapshot.status === 'active' ? [snapshot] : []),
            ...unfinished.filter((g) => g.id !== old.game.id && g.id !== game.id && g.status === 'active'),
          ].slice(0, 10),
          'unfinished',
        );
      }
    }
    await records.put({ game: structuredClone(game), owner: this.tabId, until: now + 18000 }, 'active');
    await records.put(
      [
        ...((recoveryDeadline(game) ?? 0) > now ? [game] : []),
        ...standby.filter((g) => g.id !== game.id && (recoveryDeadline(g) ?? 0) > now),
      ].slice(0, 10),
      'standby',
    );
    await tx?.done;
    this.corrupt = undefined;
  }
  async lease() {
    if (!this.db) return;
    const tx = this.db.transaction('records', 'readwrite');
    const stored = (await tx.store.get('active')) as Stored | undefined;
    if (stored?.owner === this.tabId) {
      stored.until = Date.now() + 18000;
      await tx.store.put(stored, 'active');
    }
    await tx.done;
  }
  async archive() {
    return ((await this.get<Game[]>('archive')) ?? []).filter((g) => gameSchema.safeParse(g).success);
  }
  async deleteArchive(id: string) {
    const tx = this.memory ? undefined : this.db!.transaction('records', 'readwrite');
    const records = tx?.store ?? {
      get: (key: string) => this.get(key),
      put: (value: unknown, key: string) => this.put(key, value),
    };
    // Updating both indexes in one transaction prevents another tab's save or
    // deletion from being replaced by the list read before that change.
    for (const key of ['archive', 'unfinished']) {
      const games = ((await records.get(key)) as Game[] | undefined) ?? [];
      await records.put(
        games.filter((g) => g.id !== id),
        key,
      );
    }
    await tx?.done;
  }
  async recentLocal() {
    const stored = await this.get<Stored>('active');
    const unfinished = (await this.get<Game[]>('unfinished')) ?? [];
    const all = [...(stored ? [stored.game] : []), ...unfinished, ...(await this.archive())];
    const seen = new Set<string>();
    return all
      .filter((g) => {
        if (!gameSchema.safeParse(g).success || seen.has(g.id)) return false;
        seen.add(g.id);
        return g.status === 'active';
      })
      .slice(0, 10)
      .map((g) => gameSchema.parse(g));
  }
  async recentEnded() {
    return ((await this.get<Game[]>('standby')) ?? [])
      .filter((g) => gameSchema.safeParse(g).success && (recoveryDeadline(g) ?? 0) > Date.now())
      .slice(0, 10)
      .map((g) => gameSchema.parse(g));
  }
  async reopenSaved(id: string, context: Context) {
    const saved = (await this.recentEnded()).find((g) => g.id === id);
    if (!saved) throw new Error('This game’s 24-hour recovery window has ended.');
    // Select and reopen the freshest snapshot in the same transaction that
    // checks the editor lease and saves the outgoing game.
    await this.commit(saved, undefined, true, false, id, context);
    return this.active();
  }
  async resumeSaved(id: string) {
    const current = await this.active();
    if (current.game?.id === id) return current;
    const saved =
      (await this.recentEnded()).find((g) => g.id === id) ??
      ((await this.get<Game[]>('unfinished')) ?? []).find((g) => g.id === id) ??
      (await this.archive()).find((g) => g.id === id);
    if (!saved || (saved.status !== 'active' && (recoveryDeadline(saved) ?? 0) <= Date.now()))
      throw new Error('This saved game is no longer available.');
    // commit checks the current editor lease in the replacement transaction.
    await this.commit(saved, undefined, true, false, id);
    return this.active();
  }
  async checkpoint() {
    const value = await this.get('checkpoint');
    return value ? gameSchema.parse(value) : undefined;
  }
  async saveRoom(view: RoomView) {
    const tx = this.memory ? undefined : this.db!.transaction('records', 'readwrite');
    const records = tx?.store ?? {
      get: (key: string) => this.get(key),
      put: (value: unknown, key: string) => this.put(key, value),
    };
    const previous = (await records.get(`room:${view.id}`)) as RoomView | undefined;
    if (
      previous &&
      (previous.revision > view.revision ||
        (previous.revision === view.revision && previous.serverTime > view.serverTime))
    ) {
      await tx?.done;
      return;
    }
    const parsed = recentRoomSchema.array().safeParse((await records.get('recentRooms')) ?? []);
    const recent = parsed.success
      ? parsed.data.filter(
          (room) =>
            room.expiresAt > view.serverTime &&
            (room.status === 'active' || (room.recoverUntil ?? 0) > view.serverTime),
        )
      : [];
    const item: RecentRoom = {
      id: view.id,
      gameId: view.gameId,
      names: view.seats.map((s) => s.name),
      preset: view.game?.settings.preset ?? 'Shared room',
      updatedAt: Date.now(),
      expiresAt: view.expiresAt,
      approved: view.me.status === 'approved',
      status: view.game?.status ?? 'active',
      recoverUntil: view.game ? recoveryDeadline(view.game) : null,
      canReopen: view.hostId === view.me.id,
    };
    await records.put(view, `room:${view.id}`);
    await records.put(
      [
        ...(item.status === 'ended' && (item.recoverUntil ?? 0) <= view.serverTime ? [] : [item]),
        ...recent.filter((r) => r.id !== view.id),
      ].slice(0, 10),
      'recentRooms',
    );
    await tx?.done;
  }
  async recentRooms(): Promise<RecentRoom[]> {
    const result = recentRoomSchema.array().safeParse((await this.get('recentRooms')) ?? []);
    return result.success
      ? result.data
          .filter(
            (r) => r.expiresAt > Date.now() && (r.status === 'active' || (r.recoverUntil ?? 0) > Date.now()),
          )
          .slice(0, 10)
      : [];
  }
  async pending(roomId: string): Promise<Envelope[]> {
    return (await this.get<Envelope[]>(`pending:${roomId}`)) ?? [];
  }
  async savePending(roomId: string, envelopes: Envelope[]) {
    if (envelopes.length > 80)
      throw new Error('Too many unconfirmed changes. Wait for the connection to catch up.');
    await this.put(`pending:${roomId}`, envelopes);
  }
}
export function parseImport(text: string): Game {
  if (new TextEncoder().encode(text).length > 2_000_000)
    throw new Error('Backup is too large (maximum 2 MB)');
  const data = JSON.parse(text) as { format?: unknown; version?: unknown; game?: unknown };
  if (data.format !== 'mtg-util-game' || data.version !== 1)
    throw new Error('Unsupported backup format/version. Use a Command Table game export.');
  return gameSchema.parse(data.game);
}
export function gameExport(game: Game) {
  return JSON.stringify({ format: 'mtg-util-game', version: 1, game }, null, 2);
}
