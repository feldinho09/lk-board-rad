import Dexie, { type Table } from 'dexie';
import type {
  Rider, Team, RaceSeries, Edition, Stage, Participation, ClassificationStanding,
  Note, RaceEvent, RaceGroup, ImportRun, SavedMapping, ChangeOp, RestorePoint, Setting, Versioned,
} from '../domain/types';

export const SCHEMA_VERSION = 1;

export class LkDb extends Dexie {
  riders!: Table<Rider, string>;
  teams!: Table<Team, string>;
  series!: Table<RaceSeries, string>;
  editions!: Table<Edition, string>;
  stages!: Table<Stage, string>;
  participations!: Table<Participation, string>;
  standings!: Table<ClassificationStanding, string>;
  notes!: Table<Note, string>;
  events!: Table<RaceEvent, string>;
  groups!: Table<RaceGroup, string>;
  importRuns!: Table<ImportRun, string>;
  mappings!: Table<SavedMapping, string>;
  outbox!: Table<ChangeOp, string>;
  restorePoints!: Table<RestorePoint, string>;
  /** Gerätebezogene Einstellungen – nicht Teil des gemeinsamen Datenbestands */
  device!: Table<Setting, string>;

  constructor(name = 'lk-board-rad') {
    super(name);
    this.version(SCHEMA_VERSION).stores({
      riders: 'id, lastName, *searchTokens, *aliases, updatedAt',
      teams: 'id, name',
      series: 'id, name',
      editions: 'id, seriesId, year, status, startDate',
      stages: 'id, editionId, [editionId+order]',
      participations: 'id, editionId, riderId, [editionId+bib], [editionId+riderId]',
      standings: 'id, editionId, [editionId+kind+stageId]',
      notes: 'id, refId, editionId',
      events: 'id, editionId, at',
      groups: 'id, editionId',
      importRuns: 'id, editionId, createdAt',
      mappings: 'id, name',
      outbox: 'opId, synced, entity, at',
      restorePoints: 'id, createdAt',
      device: 'key',
    });
  }
}

/** Fachliche Tabellen, die gesichert und (später) synchronisiert werden. */
export const DATA_TABLES = [
  'riders', 'teams', 'series', 'editions', 'stages', 'participations', 'standings',
  'notes', 'events', 'groups', 'importRuns', 'mappings',
] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

export let db = new LkDb();

/** Nur für Tests: frische Datenbank unter anderem Namen. */
export function useDatabase(name: string): LkDb {
  db = new LkDb(name);
  return db;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

let deviceIdCache: string | null = null;
export async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const row = await db.device.get('deviceId');
  if (row) return (deviceIdCache = row.value as string);
  const id = uuid();
  await db.device.put({ key: 'deviceId', value: id });
  return (deviceIdCache = id);
}

export function resetDeviceIdCache(): void {
  deviceIdCache = null;
}

/** Erzeugt Basisfelder eines neuen Datensatzes. */
export function newRecord<T extends object>(fields: T): T & Versioned {
  const t = nowIso();
  return { id: uuid(), rev: 0, createdAt: t, updatedAt: t, ...fields } as T & Versioned;
}

// ---- Speicherstatus für die Oberfläche ----------------------------------------
export type SaveState =
  | { kind: 'ok'; at: string }
  | { kind: 'error'; at: string; message: string }
  | { kind: 'idle' };

type Listener = (s: SaveState) => void;
let saveState: SaveState = { kind: 'idle' };
const listeners = new Set<Listener>();
export function onSaveState(l: Listener): () => void {
  listeners.add(l);
  l(saveState);
  return () => listeners.delete(l);
}
function setSaveState(s: SaveState) {
  saveState = s;
  listeners.forEach((l) => l(s));
}
export function getSaveState(): SaveState {
  return saveState;
}

/**
 * Schreibzugriff: Datensätze speichern UND Versandaufträge in DERSELBEN
 * IndexedDB-Transaktion ablegen (Bauplan 12, Prinzip 1).
 * "Lokal gespeichert" wird erst nach erfolgreichem Commit gemeldet.
 */
export interface Writer {
  put<T extends Versioned>(table: DataTableName, rec: T): Promise<T>;
  remove(table: DataTableName, id: string): Promise<void>;
}

export async function mutate<R>(tables: DataTableName[], fn: (w: Writer) => Promise<R>): Promise<R> {
  const dev = await deviceId();
  const tbls = [...tables.map((t) => db.table(t)), db.outbox];
  try {
    const result = await db.transaction('rw', tbls, async () => {
      const w: Writer = {
        async put(table, rec) {
          const existing = (await db.table(table).get(rec.id)) as Versioned | undefined;
          const baseRev = existing?.rev ?? 0;
          const next = { ...rec, rev: baseRev + 1, updatedAt: nowIso() };
          if (!existing) next.createdAt = rec.createdAt ?? next.updatedAt;
          await db.table(table).put(next);
          await db.outbox.add({
            opId: uuid(), entity: table, entityId: rec.id, op: 'put', baseRev, rev: next.rev,
            at: next.updatedAt, deviceId: dev, synced: 0,
          });
          return next;
        },
        async remove(table, id) {
          const existing = (await db.table(table).get(id)) as Versioned | undefined;
          if (!existing) return;
          const next = { ...existing, deleted: true, rev: existing.rev + 1, updatedAt: nowIso() };
          await db.table(table).put(next);
          await db.outbox.add({
            opId: uuid(), entity: table, entityId: id, op: 'delete', baseRev: existing.rev, rev: next.rev,
            at: next.updatedAt, deviceId: dev, synced: 0,
          });
        },
      };
      return fn(w);
    });
    setSaveState({ kind: 'ok', at: nowIso() });
    return result;
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    setSaveState({ kind: 'error', at: nowIso(), message });
    throw err;
  }
}

export async function getDevice<T>(key: string, fallback: T): Promise<T> {
  const row = await db.device.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setDevice(key: string, value: unknown): Promise<void> {
  await db.device.put({ key, value });
}

export function alive<T extends Versioned>(rows: T[]): T[] {
  return rows.filter((r) => !r.deleted);
}
