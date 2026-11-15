import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, setDevice } from '../db/db';
import type { Race, Stage } from '../domain/types';

/** Hash-Routen: #live, #fahrer, #fahrer-<id>, #rennen, #rennen-<id>, #themen, #themen-<id>, #pdf, #sicherung */
export function useRoute(): { view: string; id?: string } {
  const read = () => {
    const h = location.hash.replace(/^#/, '') || 'live';
    const m = h.match(/^([a-z]+)(?:-(.+))?$/);
    return { view: m?.[1] ?? 'live', id: m?.[2] };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (hash: string) => { location.hash = hash; };

/** Gewähltes Rennen und Etappe (pro Gerät gespeichert, gilt für LIVE und PDF). */
export function useCurrent(): { race?: Race; stage?: Stage; stages: Stage[]; races: Race[]; setRace: (id: string) => void; setStage: (n: number) => void; ready: boolean } {
  const data = useLiveQuery(async () => {
    const races = alive(await db.races.toArray()).sort((a, b) => (b.startDate ?? String(b.year)).localeCompare(a.startDate ?? String(a.year)));
    const raceId = (await db.device.get('currentRace'))?.value as string | undefined;
    const race = races.find((r) => r.id === raceId) ?? races[0];
    const stages = race ? alive(await db.stages.where('raceId').equals(race.id).toArray()).sort((a, b) => a.number - b.number) : [];
    const stageNo = (await db.device.get(`currentStage:${race?.id}`))?.value as number | undefined;
    const today = new Date().toISOString().slice(0, 10);
    const stage = stages.find((s) => s.number === stageNo) ?? stages.find((s) => s.date === today) ?? stages[0];
    return { races, race, stages, stage };
  }, []);
  return {
    races: data?.races ?? [],
    race: data?.race,
    stages: data?.stages ?? [],
    stage: data?.stage,
    ready: !!data,
    setRace: (id) => void setDevice('currentRace', id),
    setStage: (n) => { if (data?.race) void setDevice(`currentStage:${data.race.id}`, n); },
  };
}

export const stageLabel = (s: Pick<Stage, 'number'>, kind?: Race['kind']) => (kind === 'eintages' ? 'Rennen' : s.number === 0 ? 'Prolog' : `Etappe ${s.number}`);

export const PROFILE_LABEL: Record<NonNullable<Stage['profile']>, string> = {
  flach: 'Flach', huegelig: 'Hügelig', bergankunft: 'Bergankunft', berg: 'Bergetappe', ezf: 'Einzelzeitfahren', mzf: 'Mannschaftszeitfahren', kopfsteinpflaster: 'Kopfsteinpflaster', sonstiges: 'Sonstiges',
};

export function fmtDate(iso?: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', year: 'numeric' }): string {
  if (!iso) return '';
  if (/^\d{4}$/.test(iso)) return iso;
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-CH', opts);
}
