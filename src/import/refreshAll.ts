/**
 * „Alle aktualisieren“: holt für alle erfassten Fahrer den neuesten Stand aus den Quellen,
 * die automatisch abgefragt werden dürfen – Tissot Timing und Wikipedia/Wikidata.
 * ProCyclingStats ist bewusst nicht dabei (Nutzungsbedingungen; nur kopierte Seiten).
 *
 * Regeln wie bei den Einzelfunktionen: nur leere Felder füllen (Palmarès wird ersetzt),
 * Wikipedia nur bei eindeutiger Zuordnung ohne Widerspruch, Wiederherstellungspunkt vorab.
 */
import { db, alive, mutate, getDevice, setDevice } from '../db/db';
import type { Rider } from '../domain/types';
import { createRestorePoint } from '../backup/archive';
import { applyLookup, lookupChanged, lookupRiders, type Fetcher } from './wikidata';
import { enrichRidersByUci, enrichRidersFromTissot } from './tissotCommit';
import { tissotFetcher, type JsonFetcher } from './tissot';

export interface RefreshOptions { tissot: boolean; wikipedia: boolean }
export interface RefreshReport {
  riders: number;
  tissot?: { profiles: number; palmares: number; withoutUci: number; failed: string[] };
  wikipedia?: { updated: number; unclear: string[]; notFound: number; failed: string[]; checked: number; skippedRecent: number; remaining: number };
  errors: string[];
  at: string;
}

/** Höchstens so viele Wikipedia-Abfragen pro Klick (schont Wikipedia, begrenzt die Dauer) */
export const WIKI_BATCH = 1000;
/** Ein Fahrer wird frühestens nach so vielen Tagen erneut bei Wikipedia nachgeschlagen */
export const WIKI_RECHECK_DAYS = 30;
const WIKI_CHECKED = 'wikiChecked';

const hasText = (h?: string) => !!(h ?? '').replace(/<[^>]*>|&nbsp;/g, '').trim();
/** Fehlt etwas, das Wikipedia liefern könnte? */
export const wikiMissing = (r: Rider) => !r.nationality || !r.birthDate || r.birthDate.length === 4 || !hasText(r.bio) || !r.heightCm || !r.weightKg;

export async function refreshAllRiders(
  o: RefreshOptions,
  onProgress: (phase: string, done: number, total: number) => void = () => {},
  f: { tissot?: JsonFetcher; wiki?: Fetcher } = {},
): Promise<RefreshReport> {
  const all = () => db.riders.toArray().then((rs) => alive(rs).filter((r) => !r.mergedInto && !r.archived));
  const riders = await all();
  const report: RefreshReport = { riders: riders.length, errors: [], at: new Date().toISOString() };
  if (!riders.length) return report;
  await createRestorePoint(`Vor „Alle aktualisieren“ (${riders.length} Fahrer)`);

  if (o.tissot) {
    try {
      let profiles = 0;
      const failed: string[] = [];
      // Fahrer-Infos (Geburtsdatum, -ort, Schreibweise) gibt es bei Tissot nur im Rennkontext
      const linked = alive(await db.editions.toArray()).filter((e) => e.tissot);
      for (const [i, e] of linked.entries()) {
        onProgress(`Tissot: Fahrerdaten ${e.name}`, i, linked.length);
        const r = await enrichRidersFromTissot(e.id, e.tissot!.id, { birthDates: true, places: true, accents: true, nationality: true }, undefined, f.tissot ?? tissotFetcher);
        profiles += r.updated;
        failed.push(...r.failed);
      }
      const fresh = await all();
      const pal = await enrichRidersByUci(fresh, null, { birthDates: false, places: false, accents: false, nationality: false, palmares: true, keyFacts: true },
        (d, t) => onProgress('Tissot: Palmarès', d, t), f.tissot ?? tissotFetcher);
      report.tissot = { profiles, palmares: pal.updated, withoutUci: pal.withoutUci, failed: [...failed, ...pal.failed] };
    } catch (e) { report.errors.push(`Tissot: ${e instanceof Error ? e.message : String(e)}`); }
  }

  if (o.wikipedia) {
    try {
      const fresh = await all();
      // Nur wo etwas fehlt und nicht in den letzten 30 Tagen geprüft; Fahrer aus Rennen zuerst
      const checkedAt = await getDevice<Record<string, string>>(WIKI_CHECKED, {});
      const cutoff = new Date(Date.now() - WIKI_RECHECK_DAYS * 86400_000).toISOString().slice(0, 10);
      const inRaces = new Set(alive(await db.participations.toArray()).map((p) => p.riderId));
      const missing = fresh.filter(wikiMissing);
      const due = missing.filter((r) => !(checkedAt[r.id] && checkedAt[r.id] >= cutoff))
        .sort((a, b) => Number(inRaces.has(b.id)) - Number(inRaces.has(a.id)));
      const batch = due.slice(0, WIKI_BATCH);
      const res = batch.length ? await lookupRiders(batch, { extras: true, onProgress: (d, t) => onProgress('Wikipedia', d, t), ...(f.wiki ? { fetcher: f.wiki } : {}) }) : [];
      const today = new Date().toISOString().slice(0, 10);
      const nextChecked = { ...checkedAt };
      for (const r of res) if (r.status !== 'fehler') nextChecked[r.riderId] = today;
      await setDevice(WIKI_CHECKED, nextChecked);
      const byId = new Map(fresh.map((r) => [r.id, r]));
      const updates: Rider[] = [];
      const unclear: string[] = [];
      let notFound = 0;
      const failed: string[] = [];
      for (const r of res) {
        const rider = byId.get(r.riderId);
        if (!rider) continue;
        if (r.status === 'sicher' && r.chosen && r.conflicts.length === 0) {
          const next = applyLookup(rider, r.chosen, false, undefined, { bio: true, physical: true });
          if (lookupChanged(rider, next)) updates.push(next);
        } else if (r.status === 'nicht_gefunden') notFound++;
        else if (r.status === 'fehler') failed.push(r.riderName);
        else unclear.push(r.riderName);
      }
      if (updates.length) await mutate(['riders'], async (w) => { for (const u of updates) await w.put('riders', u); });
      report.wikipedia = { updated: updates.length, unclear, notFound, failed, checked: batch.length, skippedRecent: missing.length - due.length, remaining: due.length - batch.length };
    } catch (e) { report.errors.push(`Wikipedia: ${e instanceof Error ? e.message : String(e)}`); }
  }
  report.at = new Date().toISOString();
  return report;
}
