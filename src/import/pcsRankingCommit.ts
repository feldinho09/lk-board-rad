/**
 * Kopierte PCS-Rangliste als Wertungsstand speichern.
 * - Fahrer werden über die Teilnehmer DIESES Rennens zugeordnet (Name, akzentunabhängig).
 *   Nicht eindeutig zuordenbare Zeilen bleiben mit Quellnamen erhalten (keine Fehlzuordnung).
 * - Jede inhaltlich neue Fassung wird eine neue Quellrevision; die bisherige bleibt erhalten.
 *   Unveränderte Daten erzeugen keine Revision (Abnahme Nr. 28).
 * - Etappenergebnis und Wertungen nach der Etappe sind getrennte Datensätze (Nr. 27).
 */
import { db, alive, mutate, newRecord, nowIso } from '../db/db';
import type { ClassificationKind, ClassificationRow, ClassificationStanding, Participation, Rider, StartStatus, Versioned } from '../domain/types';
import { nameKey } from '../domain/text';
import { splitFullName } from './matching';
import type { PcsRanking } from './pcsPaste';

export interface ResolvedRanking {
  rows: ClassificationRow[];
  unresolved: string[];
  outUpdates: { part: Participation; status: StartStatus }[];
}

/** Zeile einer Quelle (PCS kopiert oder Tissot Timing); uciId wird bevorzugt zugeordnet. */
export type SourceRow = PcsRanking['rows'][number] & { uciId?: string };

export async function resolveRanking(editionId: string, r: { kind: ClassificationKind; rows: SourceRow[] }): Promise<ResolvedRanking> {
  const parts = alive(await db.participations.where('editionId').equals(editionId).toArray());
  const riders = new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((x): x is Rider => !!x).map((x) => [x.id, x]));
  const byKey = new Map<string, Participation[]>();
  const byUci = new Map<string, Participation>();
  for (const p of parts) {
    const rd = riders.get(p.riderId);
    if (!rd) continue;
    const k = nameKey(rd.firstName, rd.lastName);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
    for (const e of rd.externalIds) if (e.ns === 'uci' && e.value) byUci.set(e.value, p);
  }
  const unresolved: string[] = [];
  const outUpdates: ResolvedRanking['outUpdates'] = [];
  const rows: ClassificationRow[] = r.rows.map((x) => {
    const row: ClassificationRow = {
      rank: x.rank, timeSec: x.timeSec ?? undefined, gapSec: x.gapSec, sameTimeAsPrevious: x.sameTimeAsPrevious,
      points: x.points, status: x.status as StartStatus | undefined, sourceValue: x.sourceValue, prevRank: x.prevRank,
    };
    // Mannschaftswertung – und Mannschaftszeitfahren, bei dem die Quelle Teams statt Fahrer führt
    if (r.kind === 'team' || (!x.name && !x.uciId && x.team)) { row.teamName = x.team; return row; }
    row.name = x.name;
    const sp = splitFullName(x.name ?? '');
    const viaUci = x.uciId ? byUci.get(x.uciId) : undefined;
    const hits = viaUci ? [viaUci] : byKey.get(nameKey(sp.first, sp.last)) ?? [];
    if (hits.length === 1) {
      row.riderId = hits[0].riderId;
      const st = x.status as StartStatus | undefined;
      if (st && ['DNF', 'DNS', 'OTL', 'DSQ', 'HD'].includes(st) && hits[0].status !== st) outUpdates.push({ part: hits[0], status: st });
    } else unresolved.push(`${x.name}${hits.length > 1 ? ' (mehrdeutig)' : ''}`);
    return row;
  });
  return { rows, unresolved, outUpdates };
}

async function hashRows(rows: ClassificationRow[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows.map((r) => [r.rank, r.status, r.name ?? r.teamName, r.sourceValue])));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SaveRankingResult = { outcome: 'gespeichert' | 'unveraendert'; revision: number; standing?: ClassificationStanding; statusUpdates: number };

export async function saveRanking(opts: {
  editionId: string; stageId: string; kind: ClassificationKind; unit: 'zeit' | 'punkte';
  resolved: ResolvedRanking; applyStatus: boolean; sourceLabel?: string;
}): Promise<SaveRankingResult> {
  const { editionId, stageId, kind, unit, resolved } = opts;
  const contentHash = await hashRows(resolved.rows);
  const existing = alive(await db.standings.where('[editionId+kind+stageId]').equals([editionId, kind, stageId]).toArray())
    .sort((a, b) => b.sourceRevision - a.sourceRevision);
  const latest = existing[0];
  const statusUpdates = opts.applyStatus ? resolved.outUpdates.filter((u) => u.status) : [];
  if (latest?.contentHash === contentHash) {
    if (statusUpdates.length) await mutate(['participations'], async (w) => { for (const u of statusUpdates) await w.put('participations', { ...u.part, status: u.status, statusStageId: stageId }); });
    return { outcome: 'unveraendert', revision: latest.sourceRevision, standing: latest, statusUpdates: statusUpdates.length };
  }
  const revision = (latest?.sourceRevision ?? 0) + 1;
  const standing = newRecord<Omit<ClassificationStanding, keyof Versioned>>({
    editionId, kind, stageId, isFinal: false, source: opts.sourceLabel ?? 'PCS (manuell kopiert)', fetchedAt: nowIso(),
    sourceRevision: revision, sourceStatus: 'unbekannt', coverage: 'vollstaendig', unit, rows: resolved.rows, contentHash,
  }) as ClassificationStanding;
  await mutate(['standings', 'participations'], async (w) => {
    await w.put('standings', standing);
    for (const u of statusUpdates) await w.put('participations', { ...u.part, status: u.status, statusStageId: stageId });
  });
  return { outcome: 'gespeichert', revision, standing, statusUpdates: statusUpdates.length };
}
