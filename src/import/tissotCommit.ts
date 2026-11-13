/**
 * Tissot-Daten ins LK Board übernehmen – nach denselben Regeln wie alle anderen Quellen:
 *  - Startlisten laufen durch den normalen Prüf-Import (teamsToMatrix → Abgleich → Bestätigen).
 *  - Wertungsstände werden als neue Quellrevision gespeichert; unveränderte Daten erzeugen
 *    keine Revision (saveRanking/contentHash). Nichts wird still überschrieben.
 *  - Ausfälle (DNF/DNS/OTL/HD) setzen nur den Teilnehmerstatus; ein Fahrer wird nie
 *    automatisch wieder „aktiv“ gesetzt.
 *  - Fahrerprofile: nur leere Felder werden gefüllt; Schreibweise mit Akzenten nur, wenn
 *    der Name sonst identisch ist.
 */
import { db, alive, mutate, newRecord } from '../db/db';
import type { Edition, Participation, RaceSeries, Rider, Stage, StartStatus, Versioned } from '../domain/types';
import { nameKey, normalize, riderSearchTokens } from '../domain/text';
import { createRestorePoint } from '../backup/archive';
import { resolveRanking, saveRanking, type SaveRankingResult } from './pcsRankingCommit';
import {
  fetchStageRankings, getAthlete, getPalmares, getTeams, listStages, splitTissotName, stageFromTissot, statusesFromTeams, tissotDate,
  tissotFetcher, TISSOT_SOURCE, type JsonFetcher, type TtCompetition, type TtStage,
} from './tissot';
import { capitalizeNamePart } from './matching';
import { keyFactsFromPalmares } from '../domain/palmares';
import type { PalmaresEntry } from '../domain/types';

type F<T> = Omit<T, keyof Versioned>;

/** Neues Rennen samt Etappen aus Tissot anlegen. */
export async function createEditionFromTissot(comp: TtCompetition, year: number, stages: TtStage[]): Promise<string> {
  const oneDay = comp.type === 'SingleRace';
  const id = `${comp.code}${year}`;
  return mutate(['series', 'editions', 'stages'], async (w) => {
    const s = newRecord<F<RaceSeries>>({ name: comp.name.trim() }) as RaceSeries;
    await w.put('series', s);
    const e = newRecord<F<Edition>>({
      seriesId: s.id, name: `${comp.name.trim()} ${year}`, year, format: oneDay ? 'eintages' : 'etappen',
      startDate: comp.start, timezone: 'Europe/Paris', status: 'geplant', bibScope: 'rennen', dataOrigin: 'tissot',
      location: comp.location, tissot: { id, code: comp.code, year },
    }) as Edition;
    await w.put('editions', e);
    for (const st of stages) await w.put('stages', newRecord<F<Stage>>({ editionId: e.id, ...stageFromTissot(st, oneDay) }) as Stage);
    return e.id;
  });
}

/** Bestehendes Rennen verknüpfen; fehlende Etappen ergänzen, vorhandene nicht verändern. */
export async function linkEditionToTissot(editionId: string, comp: TtCompetition, year: number, stages: TtStage[]): Promise<number> {
  const ed = await db.editions.get(editionId);
  if (!ed) throw new Error('Rennen nicht gefunden');
  const existing = alive(await db.stages.where('editionId').equals(editionId).toArray());
  const oneDay = comp.type === 'SingleRace';
  const missing = stages.filter((s) => !existing.some((x) => x.order === s.number) && !(oneDay && existing.length === 1));
  await mutate(['editions', 'stages'], async (w) => {
    await w.put('editions', { ...ed, tissot: { id: `${comp.code}${year}`, code: comp.code, year } });
    for (const st of missing) await w.put('stages', newRecord<F<Stage>>({ editionId, ...stageFromTissot(st, oneDay) }) as Stage);
  });
  return missing.length;
}

/** Zu einer Tissot-Etappennummer gehörende Etappe im LK Board. */
export async function stageFor(editionId: string, number: number): Promise<Stage | undefined> {
  const stages = alive(await db.stages.where('editionId').equals(editionId).toArray());
  return stages.find((s) => s.order === number) ?? (stages.length === 1 ? stages[0] : undefined);
}

export interface SyncReport {
  stageLabel: string;
  items: { kind: string; title: string; result: SaveRankingResult; rows: number; unresolved: number }[];
  statusUpdates: number;
  at: string;
}

/** Ausfälle aus der Tissot-Teamliste übernehmen (nur in Richtung „ausgeschieden“). */
async function applyStatuses(editionId: string, stageId: string, list: ReturnType<typeof statusesFromTeams>): Promise<number> {
  if (!list.length) return 0;
  const parts = alive(await db.participations.where('editionId').equals(editionId).toArray());
  const riders = new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((x): x is Rider => !!x).map((r) => [r.id, r]));
  const updates: { part: Participation; status: StartStatus }[] = [];
  for (const s of list) {
    const p = parts.find((x) => s.uciId && riders.get(x.riderId)?.externalIds.some((e) => e.ns === 'uci' && e.value === s.uciId))
      ?? parts.find((x) => x.bib === s.bib && !s.uciId);
    if (p && p.status !== s.status) updates.push({ part: p, status: s.status });
  }
  if (updates.length) await mutate(['participations'], async (w) => { for (const u of updates) await w.put('participations', { ...u.part, status: u.status, statusStageId: stageId }); });
  return updates.length;
}

/** Etappenergebnis und alle Gesamtstände einer Etappe holen und speichern. */
export async function syncTissotStage(editionId: string, tissotId: string, number: number, f: JsonFetcher = tissotFetcher): Promise<SyncReport> {
  const stage = await stageFor(editionId, number);
  if (!stage) throw new Error(`Im LK Board fehlt die Etappe ${number}. Bitte in „Rennen“ ergänzen oder das Rennen neu mit Tissot verknüpfen.`);
  const rankings = await fetchStageRankings(tissotId, number, f);
  const items: SyncReport['items'] = [];
  for (const rk of rankings) {
    const resolved = await resolveRanking(editionId, rk);
    const result = await saveRanking({ editionId, stageId: stage.id, kind: rk.kind, unit: rk.unit, resolved, applyStatus: false, sourceLabel: TISSOT_SOURCE });
    items.push({ kind: rk.kind, title: rk.title, result, rows: rk.rows.length, unresolved: resolved.unresolved.length });
  }
  const statusUpdates = await applyStatuses(editionId, stage.id, statusesFromTeams(await getTeams(tissotId, number, f)));
  return { stageLabel: stage.label, items, statusUpdates, at: new Date().toISOString() };
}

/** Etappen von Tissot laden (für Auswahl und automatische Aktualisierung). */
export const loadTissotStages = (tissotId: string, f: JsonFetcher = tissotFetcher) => listStages(tissotId, f);

// ---------------------------------------------------------------- Fahrerdaten

export interface EnrichOptions { birthDates: boolean; places: boolean; accents: boolean; nationality: boolean; palmares?: boolean; keyFacts?: boolean }
export interface EnrichResult { checked: number; updated: number; withoutUci: number; uciAdded: number; failed: string[] }

const sameName = (a: string, b: string) => normalize(a) === normalize(b);

/** Profilwerte aus Tissot – füllt nur LEERE Felder (Jahrgang → volles Datum ist erlaubt). */
export function applyAthlete(r: Rider, a: { firstName?: string; lastName?: string; birthdate?: string; birthplace?: string; nation?: string }, o: EnrichOptions, today = new Date().toISOString().slice(0, 10)): Rider {
  const next: Rider = { ...r };
  const bd = tissotDate(a.birthdate);
  if (o.birthDates && bd && (!r.birthDate || (r.birthDate.length === 4 && bd.startsWith(r.birthDate)))) next.birthDate = bd;
  if (o.places && a.birthplace && !r.birthPlace) next.birthPlace = a.birthplace.trim();
  if (o.nationality && a.nation && !r.nationality) next.nationality = a.nation;
  if (o.accents && a.firstName && a.lastName) {
    const last = a.lastName.trim().split(/\s+/).map((p, i) => capitalizeNamePart(p, i)).join(' ');
    const first = a.firstName.trim();
    if (sameName(first, r.firstName) && sameName(last, r.lastName) && (first !== r.firstName || last !== r.lastName)) {
      const display = r.displayName === `${r.firstName} ${r.lastName}` ? `${first} ${last}` : r.displayName;
      Object.assign(next, { firstName: first, lastName: last, displayName: display });
      next.aliases = r.aliases.includes(`${r.firstName} ${r.lastName}`) ? r.aliases : [...r.aliases, `${r.firstName} ${r.lastName}`];
      next.searchTokens = riderSearchTokens(first, last, display, next.aliases);
    }
  }
  const changed = (['birthDate', 'birthPlace', 'nationality', 'firstName', 'lastName'] as const).some((k) => next[k] !== r[k]);
  if (!changed) return r;
  const src = `Tissot Timing (abgerufen ${today})`;
  next.sources = r.sources ? (/Tissot Timing \(abgerufen [\d-]+\)/.test(r.sources) ? r.sources.replace(/Tissot Timing \(abgerufen [\d-]+\)/, src) : `${r.sources}; ${src}`) : src;
  return next;
}

/** Palmarès ersetzen (Quelle Tissot); Schlüsselfakten nur vorschlagen, wenn noch keine erfasst sind. */
export function applyPalmares(r: Rider, p: PalmaresEntry[], keyFacts: boolean, today = new Date().toISOString().slice(0, 10)): Rider {
  const same = JSON.stringify(r.palmares ?? []) === JSON.stringify(p);
  const facts = keyFacts && !r.keyFacts.some((f) => f.trim()) ? keyFactsFromPalmares(p) : r.keyFacts;
  if (same && facts === r.keyFacts) return r;
  return { ...r, palmares: p, palmaresSource: `Tissot Timing (abgerufen ${today})`, keyFacts: facts };
}

export async function enrichRidersFromTissot(
  editionId: string, tissotId: string, o: EnrichOptions, onProgress: (done: number, total: number) => void = () => {}, f: JsonFetcher = tissotFetcher,
): Promise<EnrichResult> {
  const parts = alive(await db.participations.where('editionId').equals(editionId).toArray());
  let riders = (await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((x): x is Rider => !!x && !x.deleted);
  // Fahrer ohne UCI-ID über die Tissot-Startliste zuordnen: nur bei eindeutig gleichem Namen
  let uciAdded = 0;
  const lacking = riders.filter((r) => !r.externalIds.some((e) => e.ns === 'uci' && e.value));
  if (lacking.length) {
    const first = (await listStages(tissotId, f))[0];
    const members = first ? (await getTeams(tissotId, first.number, f)).flatMap((t) => t.members) : [];
    const byName = new Map<string, string[]>();
    for (const m of members) {
      if (!m.uciRiderId) continue;
      const n = splitTissotName(m.name);
      const k = nameKey(n.first, n.last);
      byName.set(k, [...(byName.get(k) ?? []), m.uciRiderId]);
    }
    const added: Rider[] = [];
    for (const r of lacking) {
      const hit = byName.get(nameKey(r.firstName, r.lastName));
      if (hit?.length === 1) added.push({ ...r, externalIds: [...r.externalIds, { ns: 'uci', value: hit[0] }] });
    }
    if (added.length) {
      await mutate(['riders'], async (w) => { for (const u of added) await w.put('riders', u); });
      uciAdded = added.length;
      const map = new Map(added.map((a) => [a.id, a]));
      riders = riders.map((r) => map.get(r.id) ?? r);
    }
  }
  const r = await enrichRidersByUci(riders, tissotId, o, onProgress, f);
  return { ...r, uciAdded };
}

/**
 * Fahrer mit UCI-ID bei Tissot nachschlagen. Ohne Wettbewerbs-Kennung (tissotId = null)
 * gibt es nur das Palmarès – die Fahrer-Infos verlangt Tissot im Kontext eines Rennens.
 */
export async function enrichRidersByUci(
  riders: Rider[], tissotId: string | null, o: EnrichOptions, onProgress: (done: number, total: number) => void = () => {}, f: JsonFetcher = tissotFetcher,
): Promise<Omit<EnrichResult, 'uciAdded'>> {
  const withUci = riders.filter((r) => r.externalIds.some((e) => e.ns === 'uci' && e.value));
  const updates: Rider[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const r of withUci) {
    const uci = r.externalIds.find((e) => e.ns === 'uci')!.value;
    try {
      let next = r;
      if (o.birthDates || o.places || o.accents || o.nationality) {
        const a = tissotId ? await getAthlete(uci, tissotId, f) : null;
        if (a) next = applyAthlete(next, a, o);
        else if (tissotId) failed.push(`${r.displayName} (nicht gefunden)`);
      }
      if (o.palmares) {
        const p = await getPalmares(uci, f);
        if (p) next = applyPalmares(next, p, !!o.keyFacts);
      }
      if (next !== r) updates.push(next);
    } catch (e) {
      failed.push(`${r.displayName} (${e instanceof Error ? e.message : String(e)})`);
      if (failed.length >= 5 && done < 5) break; // Quelle offensichtlich nicht erreichbar
    }
    onProgress(++done, withUci.length);
  }
  if (updates.length) {
    await createRestorePoint(`Vor Tissot-Ergänzung (${updates.length} Fahrer)`);
    await mutate(['riders'], async (w) => { for (const u of updates) await w.put('riders', u); });
  }
  return { checked: done, updated: updates.length, withoutUci: riders.length - withUci.length, failed };
}

