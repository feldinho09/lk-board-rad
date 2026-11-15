/**
 * Geographisches speichern: Strecke (GPX) und Punkte je Etappe.
 */
import { db, alive, mutate, newRecord, getDevice, setDevice } from '../db/db';
import type { GeoPoint, Route, Stage, Versioned } from './types';
import { mergeFound, type FoundPlace } from './geo';

type New<T> = Omit<T, keyof Versioned>;

export const stageRoute = async (raceId: string, stageNumber: number) =>
  alive(await db.routes.where('[raceId+stageNumber]').equals([raceId, stageNumber]).toArray())[0];

export const stagePoints = async (raceId: string, stageNumber: number) =>
  alive(await db.geo.where('[raceId+stageNumber]').equals([raceId, stageNumber]).toArray()).sort((a, b) => a.km - b.km);

/** Strecke setzen (ersetzt eine frühere). Übernimmt die Länge in die Etappe, wenn dort leer. */
export async function saveRoute(stage: Stage, parsed: { points: Route['points']; lengthKm: number }, fileName?: string): Promise<Route> {
  const old = await stageRoute(stage.raceId, stage.number);
  const r = newRecord<New<Route>>({ raceId: stage.raceId, stageNumber: stage.number, points: parsed.points, lengthKm: parsed.lengthKm, fileName, wikiLang: old?.wikiLang }) as Route;
  return mutate(['routes', 'stages'], async (w) => {
    if (old) await w.remove('routes', old.id);
    if (!stage.distanceKm) await w.put('stages', { ...stage, distanceKm: parsed.lengthKm });
    return w.put('routes', r);
  });
}

export async function removeRoute(raceId: string, stageNumber: number) {
  const r = await stageRoute(raceId, stageNumber);
  if (r) await mutate(['routes'], (w) => w.remove('routes', r.id));
}

/** Wikipedia-Funde übernehmen: Neues hinzufügen, Bekanntes nur ergänzen; ausgeblendete bleiben aus. */
export async function addFound(raceId: string, stageNumber: number, found: FoundPlace[], lang: string): Promise<{ added: number; updated: number }> {
  const existing = alive(await db.geo.where('[raceId+stageNumber]').equals([raceId, stageNumber]).toArray());
  const { add, update } = mergeFound(existing, found);
  await mutate(['geo'], async (w) => {
    for (const x of add) {
      await w.put('geo', newRecord<New<GeoPoint>>({
        raceId, stageNumber, kind: x.kind, name: x.name, km: x.km, offsetM: x.offsetM, lat: x.lat, lon: x.lon,
        wikiLang: lang, wikiTitle: x.wikiTitle, description: x.description, summary: x.summary, source: 'wikipedia',
      }) as GeoPoint);
    }
    for (const u of update) {
      const cur = existing.find((e) => e.id === u.id)!;
      await w.put('geo', { ...cur, ...u.patch });
    }
  });
  return { added: add.length, updated: update.length };
}

export async function addPoint(raceId: string, stageNumber: number, fields: Partial<New<GeoPoint>> & { name: string; km: number }): Promise<GeoPoint> {
  const p = newRecord<New<GeoPoint>>({ raceId, stageNumber, kind: 'sonstiges', source: 'eigen', ...fields }) as GeoPoint;
  return mutate(['geo'], (w) => w.put('geo', p));
}

export async function updatePoint(id: string, patch: Partial<New<GeoPoint>>) {
  return mutate(['geo'], async (w) => {
    const cur = await db.geo.get(id);
    if (!cur) throw new Error('Punkt nicht gefunden');
    return w.put('geo', { ...cur, ...patch });
  });
}

/** Eigene Punkte werden gelöscht, Wikipedia-Funde nur ausgeblendet (sonst kämen sie beim nächsten Abruf wieder). */
export async function removePoint(p: GeoPoint) {
  if (p.source === 'wikipedia') await updatePoint(p.id, { hidden: true });
  else await mutate(['geo'], (w) => w.remove('geo', p.id));
}

/** LIVE: km to go um delta verstellen (Taste + / −). */
let nudgeChain: Promise<unknown> = Promise.resolve();
export function nudgeKmToGo(raceId: string, stage: Stage, delta: number): Promise<void> {
  // nacheinander, damit schnelles Tippen keine Schritte verliert
  const run = nudgeChain.then(() => doNudge(raceId, stage, delta));
  nudgeChain = run.catch(() => undefined);
  return run;
}
async function doNudge(raceId: string, stage: Stage, delta: number) {
  const key = `kmToGo:${raceId}:${stage.number}`;
  const length = (await stageRoute(raceId, stage.number))?.lengthKm ?? stage.distanceKm ?? 999;
  const cur = (await getDevice<number | undefined>(key, undefined)) ?? length;
  await setDevice(key, Math.max(0, Math.min(length, Math.round((cur + delta) * 10) / 10)));
}
