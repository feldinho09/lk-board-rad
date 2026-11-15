/**
 * Klassemente und Rennsituation: eingefügte Ranglisten (z. B. von PCS kopiert) lesen,
 * Fahrer über Namen bzw. Startnummer der Startliste zuordnen. Kein Abruf.
 */
import { db } from '../db/db';
import type { Entry, Stage, StandingKind, StandingRow, SituationGroup } from './types';
import { STANDING_KINDS } from './types';
import { normalize } from './text';
import { updateStage } from './center';

const TIME = /^[+-]?\d{1,3}:\d{2}(:\d{2})?$|^[+-]?\d{1,2}[''′]\d{2}[""″]?$|^,,$|^s\.t\.?$|^st$/i;
const INT = /^\d{1,4}$/;

/** Eine kopierte Rangliste lesen: Rang zuerst, Fahrer per Name (Startliste) erkannt, Wert = letzte Zeit/Zahl. */
export function parseStanding(text: string, entries: Entry[]): StandingRow[] {
  const keyed = entries.map((e) => ({ e, words: normalize(e.name).split(' ').filter((w) => w.length > 1) }));
  const out: StandingRow[] = [];
  let lastTime: string | undefined;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(\d{1,3})[.)]?(\s|\t|$)/);
    if (!m) continue;
    const rank = Number(m[1]);
    const rest = line.slice(m[0].length);
    const n = ` ${normalize(rest)} `;
    // bester Treffer: alle Namensteile kommen vor; bei mehreren der längste Name
    const hits = keyed.filter((k) => k.words.length && k.words.every((w) => n.includes(` ${w} `)));
    const hit = hits.sort((a, b) => b.words.join('').length - a.words.join('').length)[0]?.e;
    const tokens = rest.split(/\s+|\t/).filter(Boolean);
    let value: string | undefined;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (TIME.test(t)) { value = t; break; }
      if (INT.test(t) && (!hit?.bib || t !== hit.bib)) { value = t; break; }
    }
    if (value === ',,' || /^s\.?t\.?$/i.test(value ?? '')) value = lastTime ?? 's.t.';
    else if (value && TIME.test(value)) lastTime = value;
    let name = hit?.name;
    if (!name) {
      // ohne Startlisten-Treffer: Text ohne Zahlen und Zeiten
      name = tokens.filter((t) => !TIME.test(t) && !INT.test(t)).join(' ').trim();
      if (!name) continue;
    }
    if (out.some((r) => r.rank === rank && r.name === name)) continue;
    out.push({ rank, name, bib: hit?.bib, team: hit?.team, value });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export async function saveStanding(stage: Stage, kind: StandingKind, rows: StandingRow[]) {
  const cur = (await db.stages.get(stage.id)) ?? stage;
  const standings = { ...(cur.standings ?? {}) };
  if (rows.length) standings[kind] = rows; else delete standings[kind];
  await updateStage(stage.id, { standings });
}

/** Neueste Klassemente bis und mit dieser Etappe (für LIVE: Stand vor/nach der Etappe). */
export function latestStandings(stages: Stage[], upTo: number): { stage: Stage; kind: StandingKind; rows: StandingRow[] }[] {
  const res: { stage: Stage; kind: StandingKind; rows: StandingRow[] }[] = [];
  for (const k of STANDING_KINDS) {
    const st = [...stages].filter((s) => s.number <= upTo && s.standings?.[k.key]?.length).sort((a, b) => b.number - a.number)[0];
    if (st) res.push({ stage: st, kind: k.key, rows: st.standings![k.key]! });
  }
  return res;
}

/** Platzierungen eines Fahrers in den aktuellen Klassementen. */
export function riderRanks(latest: ReturnType<typeof latestStandings>, entry: Entry): { kind: StandingKind; rank: number; value?: string; stageNumber: number }[] {
  return latest.flatMap((l) => {
    const r = l.rows.find((x) => (entry.bib && x.bib === entry.bib) || x.name === entry.name);
    return r ? [{ kind: l.kind, rank: r.rank, value: r.value, stageNumber: l.stage.number }] : [];
  });
}

// ------------------------------------------------------------------ Rennsituation

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
