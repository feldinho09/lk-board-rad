import Dexie, { type Table } from 'dexie';
import type { Entry, GeoPoint, Race, RestorePoint, Rider, Route, RundownRow, Setting, Stage, Topic, Versioned } from '../domain/types';

/**
 * Lokaler Datenspeicher (IndexedDB) des Rad Command Centers.
 * Eigener Name, damit die Daten des früheren LK Boards im Browser unberührt bleiben.
 */
export const DB_NAME = 'rad-command-center';
export const SCHEMA_VERSION = 2;

export class CenterDb extends Dexie {
  riders!: Table<Rider, string>;
  races!: Table<Race, string>;
  stages!: Table<Stage, string>;
  entries!: Table<Entry, string>;
  topics!: Table<Topic, string>;
  routes!: Table<Route, string>;
  geo!: Table<GeoPoint, string>;
  rundown!: Table<RundownRow, string>;
  restorePoints!: Table<RestorePoint, string>;
  /** Geräteeinstellungen (Ansicht, gewähltes Rennen …) – nicht Teil der Sicherung */
  device!: Table<Setting, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(SCHEMA_VERSION).stores({
      riders: 'id, lastName, searchKey, updatedAt',
      races: 'id, year, startDate',
      stages: 'id, raceId, [raceId+number]',
      entries: 'id, raceId, riderId, [raceId+bib]',
      topics: 'id, kind, raceId, *riderIds, updatedAt',
      restorePoints: 'id, createdAt',
      device: 'key',
    });
    // v2: Geographisches (Strecke, Punkte) und SRF-Programm
    this.version(2).stores({
      routes: 'id, [raceId+stageNumber]',
      geo: 'id, [raceId+stageNumber], raceId',
      rundown: 'id, [raceId+stageNumber], raceId',
    });
  }
}

/** Fachliche Tabellen – werden gesichert und wiederhergestellt. */
export const DATA_TABLES = ['riders', 'races', 'stages', 'entries', 'topics', 'routes', 'geo', 'rundown'] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

export let db = new CenterDb();

/** Nur für Tests: frische Datenbank unter anderem Namen. */
export function useDatabase(name: string): CenterDb {
  db = new CenterDb(name);
  return db;
}

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function newRecord<T extends object>(fields: T): T & Versioned {
  const t = nowIso();
  return { id: uuid(), rev: 0, createdAt: t, updatedAt: t, ...fields } as T & Versioned;
}

export const alive = <T extends Versioned>(rows: T[]): T[] => rows.filter((r) => !r.deleted);

// ---- Speicherstatus für die Oberfläche ---------------------------------------
export type SaveState = { kind: 'ok'; at: string } | { kind: 'error'; at: string; message: string } | { kind: 'idle' };
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

export interface Writer {
  put<T extends Versioned>(table: DataTableName, rec: T): Promise<T>;
  /** Löschmarkierung statt hartem Löschen (Wiederherstellung über Sicherungen möglich) */
  remove(table: DataTableName, id: string): Promise<void>;
}

/**
 * Jeder Schreibvorgang läuft in EINER Transaktion; „Gespeichert“ wird erst nach dem
 * erfolgreichen Abschluss gemeldet, ein Fehler bleibt sichtbar.
 */
export async function mutate<R>(tables: DataTableName[], fn: (w: Writer) => Promise<R>): Promise<R> {
  try {
    const result = await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
      const w: Writer = {
        async put(table, rec) {
          const existing = (await db.table(table).get(rec.id)) as Versioned | undefined;
          const next = { ...rec, rev: (existing?.rev ?? 0) + 1, updatedAt: nowIso() };
          if (!existing) next.createdAt = rec.createdAt ?? next.updatedAt;
          await db.table(table).put(next);
          return next;
        },
        async remove(table, id) {
          const existing = (await db.table(table).get(id)) as Versioned | undefined;
          if (existing) await db.table(table).put({ ...existing, deleted: true, rev: existing.rev + 1, updatedAt: nowIso() });
        },
      };
      return fn(w);
    });
    setSaveState({ kind: 'ok', at: nowIso() });
    return result;
  } catch (err) {
    setSaveState({ kind: 'error', at: nowIso(), message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
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
