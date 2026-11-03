/**
 * Sicherungsformat (Bauplan Abschnitt 13):
 *   lk-board-backup.zip
 *     manifest.json  – Format, Version, Zeit, Zählungen, SHA-256 je Datei
 *     data.json      – alle fachlichen Tabellen (konsistenter Snapshot aus EINER Lesetransaktion)
 *     csv/*.csv      – offen lesbare Tabellen (Fahrer, Teilnahmen) mit Formel-Schutz
 * Gerätebezogene Einstellungen, Sync-Warteschlange und Wiederherstellungspunkte sind
 * NICHT enthalten (keine Zugangsdaten in allgemeinen Exporten).
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { db, DATA_TABLES, SCHEMA_VERSION, nowIso, uuid, type DataTableName } from '../db/db';
import type { RestorePoint } from '../domain/types';

export const FORMAT = 'lk-board-rad-backup';
export const FORMAT_VERSION = 1;

export interface Manifest {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  counts: Record<string, number>;
  files: Record<string, { sha256: string; bytes: number }>;
  note?: string;
}

export type DataSnapshot = Record<DataTableName, Record<string, unknown>[]>;

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Konsistenter Snapshot: alle Tabellen in einer einzigen Lesetransaktion. */
export async function readSnapshot(): Promise<DataSnapshot> {
  const tables = DATA_TABLES.map((t) => db.table(t));
  return db.transaction('r', tables, async () => {
    const out = {} as DataSnapshot;
    for (const t of DATA_TABLES) out[t] = await db.table(t).toArray();
    return out;
  });
}

/** CSV-Zelle gegen Formel-Interpretation schützen (=, +, -, @, Tab, CR). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(';'))].join('\r\n');
}

export async function buildArchive(snapshot?: DataSnapshot, note?: string): Promise<{ bytes: Uint8Array; manifest: Manifest }> {
  const data = snapshot ?? (await readSnapshot());
  const dataBytes = strToU8(JSON.stringify(data));
  const riders = data.riders.filter((r) => !r.deleted);
  const parts = data.participations.filter((r) => !r.deleted);
  const ridersCsv = strToU8(toCsv(riders, ['id', 'firstName', 'lastName', 'displayName', 'nationality', 'birthDate', 'pronunciation', 'riderType', 'aliases', 'tags']));
  const partsCsv = strToU8(toCsv(parts, ['id', 'editionId', 'riderId', 'bib', 'category', 'teamName', 'status', 'favorite']));
  const files: Record<string, Uint8Array> = {
    'data.json': dataBytes,
    'csv/fahrer.csv': ridersCsv,
    'csv/teilnahmen.csv': partsCsv,
  };
  const manifest: Manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(),
    appVersion: '0.1.0',
    counts: Object.fromEntries(DATA_TABLES.map((t) => [t, data[t].length])),
    files: {},
    note,
  };
  for (const [name, bytes] of Object.entries(files)) manifest.files[name] = { sha256: await sha256(bytes), bytes: bytes.length };
  const zip = zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) }, { level: 6 });
  return { bytes: zip, manifest };
}

export interface VerifiedArchive {
  manifest: Manifest;
  data: DataSnapshot;
  warnings: string[];
}

/**
 * Prüft ein Archiv vollständig in einem separaten Arbeitsbereich (Speicher),
 * BEVOR irgendetwas am aktuellen Bestand geändert wird.
 */
export async function verifyArchive(bytes: Uint8Array): Promise<VerifiedArchive> {
  if (bytes.length > 500 * 1024 * 1024) throw new Error('Archiv größer als 500 MB – abgelehnt.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.includes('..') || f.name.startsWith('/')) throw new Error(`Unzulässiger Pfad im Archiv: ${f.name}`);
        return true;
      },
    });
  } catch (e) {
    throw new Error('Archiv ist beschädigt oder kein ZIP: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (!files['manifest.json']) throw new Error('manifest.json fehlt – keine LK-Board-Sicherung.');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest;
  if (manifest.format !== FORMAT) throw new Error(`Unbekanntes Format: ${manifest.format}`);
  if (manifest.formatVersion > FORMAT_VERSION) throw new Error(`Formatversion ${manifest.formatVersion} ist neuer als diese App (${FORMAT_VERSION}). Bitte App aktualisieren.`);
  for (const [name, meta] of Object.entries(manifest.files)) {
    const f = files[name];
    if (!f) throw new Error(`Datei fehlt im Archiv: ${name}`);
    const h = await sha256(f);
    if (h !== meta.sha256) throw new Error(`Prüfsumme stimmt nicht: ${name} (Archiv beschädigt)`);
  }
  const data = JSON.parse(strFromU8(files['data.json'])) as DataSnapshot;
  for (const t of DATA_TABLES) if (!Array.isArray(data[t])) data[t] = [];
  const warnings = checkReferences(data);
  return { manifest, data, warnings };
}

/** Referenzielle Integrität prüfen. Harte Fehler werfen, weiche als Warnung liefern. */
export function checkReferences(d: DataSnapshot): string[] {
  const ids = (t: DataTableName) => new Set(d[t].map((r) => r.id as string));
  const riders = ids('riders');
  const editions = ids('editions');
  const stages = ids('stages');
  const errors: string[] = [];
  for (const p of d.participations) {
    if (!riders.has(p.riderId as string)) errors.push(`Teilnahme ${String(p.id).slice(0, 8)} verweist auf fehlenden Fahrer`);
    if (!editions.has(p.editionId as string)) errors.push(`Teilnahme ${String(p.id).slice(0, 8)} verweist auf fehlendes Rennen`);
  }
  for (const s of d.stages) if (!editions.has(s.editionId as string)) errors.push(`Etappe ${s.label} ohne Rennen`);
  for (const s of d.standings) if (!stages.has(s.stageId as string)) errors.push(`Wertungsstand ohne Etappe`);
  if (errors.length) throw new Error('Referenzfehler im Archiv:\n' + errors.slice(0, 10).join('\n'));
  return [];
}

/**
 * Vollständige Wiederherstellung: vorher Wiederherstellungspunkt des aktuellen
 * Bestands, dann atomarer Austausch in EINER Transaktion.
 * Sync-Warteschlange wird geleert und Sync gilt als pausiert (Bauplan 13).
 */
export async function restoreFull(v: VerifiedArchive): Promise<void> {
  await createRestorePoint('Vor Wiederherstellung');
  const tables = [...DATA_TABLES.map((t) => db.table(t)), db.outbox, db.device];
  await db.transaction('rw', tables, async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      if (v.data[t].length) await db.table(t).bulkPut(v.data[t]);
    }
    await db.outbox.clear();
    await db.device.put({ key: 'syncPaused', value: { reason: 'Nach Wiederherstellung', at: nowIso() } });
    await db.device.put({ key: 'deviceId', value: uuid() }); // neue Geräteidentität
  });
}

const MAX_RESTORE_POINTS = 20;

export async function createRestorePoint(reason: string): Promise<RestorePoint> {
  const { bytes } = await buildArchive(undefined, reason);
  const rp: RestorePoint = { id: uuid(), createdAt: nowIso(), reason, sizeBytes: bytes.length, data: bytes };
  await db.restorePoints.add(rp);
  // Erst nach erfolgreicher neuer Sicherung alte bereinigen; geschützte bleiben
  const all = await db.restorePoints.orderBy('createdAt').toArray();
  const removable = all.filter((r) => !r.protected);
  const excess = removable.length - MAX_RESTORE_POINTS;
  if (excess > 0) await db.restorePoints.bulkDelete(removable.slice(0, excess).map((r) => r.id));
  return rp;
}

export function backupFileName(prefix = 'lk-board-sicherung'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
