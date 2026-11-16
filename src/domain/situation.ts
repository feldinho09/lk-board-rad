/** LIVE-Rennsituation: Gruppen mit Abstand und Startnummern. */
import type { SituationGroup } from './types';
import { updateStage } from './center';
import { db } from '../db/db';


const gid = () => Math.random().toString(36).slice(2, 10);
export const newGroup = (label: string): SituationGroup => ({ id: gid(), label, bibs: [] });

/** „11 21, 22“ → [„11“, „21“, „22“] (doppelte entfernt) */
export const parseBibs = (v: string) => [...new Set(v.split(/[\s,;/+]+/).map((x) => x.trim()).filter((x) => /^\d{1,3}$/.test(x)))];

export async function saveSituation(stageId: string, groups: SituationGroup[]) {
  await updateStage(stageId, { situation: { groups, at: new Date().toISOString() } });
}

/** Startnummer in eine Gruppe verschieben (aus allen anderen entfernen). */
export function moveBib(groups: SituationGroup[], bib: string, toId: string): SituationGroup[] {
  return groups.map((g) => ({ ...g, bibs: g.id === toId ? [...new Set([...g.bibs, bib])] : g.bibs.filter((b) => b !== bib) }));
}

/** Gruppen auf dem aktuellen Stand der Datenbank ändern (keine veralteten Werte bei schnellen Eingaben). */
let chain: Promise<unknown> = Promise.resolve();
export function updateSituation(stageId: string, fn: (groups: SituationGroup[]) => SituationGroup[]): Promise<void> {
  const run = chain.then(async () => {
    const cur = await db.stages.get(stageId);
    await saveSituation(stageId, fn(cur?.situation?.groups ?? []));
  });
  chain = run.catch(() => undefined);
  return run;
}
