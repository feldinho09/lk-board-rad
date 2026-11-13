/**
 * Palmarès auswerten: wichtigste Erfolge als kurze deutsche Schlüsselfakten.
 * Reine Funktionen, keine Datenbank. Bewertet nur Siege (Platz 1); Reihenfolge nach
 * Bedeutung (Grand-Tour-Gesamtsieg, WM, Monumente, …) und dann nach Aktualität.
 */
import type { PalmaresEntry } from './types';

const GRAND_TOURS: [RegExp, string][] = [
  [/^tour de france$/i, 'Tour de France'],
  [/giro d'?italia/i, 'Giro d’Italia'],
  [/vuelta (ciclista )?a españa/i, 'Vuelta'],
];
const MONUMENTS: [RegExp, string][] = [
  [/milano.?san ?remo/i, 'Mailand–Sanremo'],
  [/ronde van vlaanderen|tour des flandres|tour of flanders/i, 'Flandern-Rundfahrt'],
  [/^paris.?roubaix$/i, 'Paris–Roubaix'],
  [/li[eè]ge.?bastogne.?li[eè]ge/i, 'Lüttich–Bastogne–Lüttich'],
  [/il lombardia|giro di lombardia/i, 'Lombardei-Rundfahrt'],
];

/** Rundfahrten der WorldTour – Gesamtsieg wiegt mehr als bei kleineren Rundfahrten */
const WT_STAGE_RACES = /paris.?nice|tirreno|dauphin|auvergne|tour de suisse|romandie|catalunya|pa[iy]s vasco|itzulia|uae tour|tour down under|tour de pologne|benelux|renewi|guangxi|deutschland tour/i;

const isWomenOrJunior = (s: string) => /\b(WE|WJ|MJ|WU|MU|U-?23|juniors?)\b/i.test(s);

/** Jahreszahlen kompakt: 2021, 2022, 2023, 2025 → „2021–2023, 2025“ */
export function yearsText(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(j - i >= 2 ? `${ys[i]}–${ys[j]}` : ys.slice(i, j + 1).join(', '));
    i = j;
  }
  return out.join(', ');
}

const stageCount = (d?: string) => {
  const m = d?.match(/^Stages?\s+(.+)$/i);
  return m ? m[1].split(/[,&]|\band\b/).filter((x) => x.trim()).length : 0;
};

interface Fact { score: number; latest: number; text: string }

/** Bis zu `max` Schlüsselfakten aus dem Palmarès (nur Siege). */
export function keyFactsFromPalmares(p: PalmaresEntry[], max = 3): string[] {
  const wins = p.filter((e) => e.rank === 1);
  const facts: Fact[] = [];
  const group = (pred: (e: PalmaresEntry) => boolean) => wins.filter(pred);

  for (const [re, name] of GRAND_TOURS) {
    const gc = group((e) => re.test(e.race) && /general/i.test(e.detail ?? '') && !isWomenOrJunior(e.race));
    if (gc.length) facts.push({ score: 100, latest: Math.max(...gc.map((e) => e.year)), text: `Gesamtsieg ${name} ${yearsText(gc.map((e) => e.year))}` });
    const st = group((e) => re.test(e.race) && /^stage/i.test(e.detail ?? ''));
    const n = st.reduce((a, e) => a + stageCount(e.detail), 0);
    if (n) facts.push({ score: 70 + Math.min(n, 20), latest: Math.max(...st.map((e) => e.year)), text: `${n} ${n === 1 ? 'Etappensieg' : 'Etappensiege'} ${name}` });
  }
  const wc = group((e) => /world championships/i.test(e.race) && /road race/i.test(e.race) && !/\b(MJ|WJ|U-?23|MU|WU)\b/.test(e.race));
  if (wc.length) facts.push({ score: 95, latest: Math.max(...wc.map((e) => e.year)), text: `Weltmeister Strasse ${yearsText(wc.map((e) => e.year))}` });
  const wcItt = group((e) => /world championships/i.test(e.race) && /\bITT\b|time trial/i.test(e.race) && !/\b(MJ|WJ|U-?23|MU|WU)\b/.test(e.race));
  if (wcItt.length) facts.push({ score: 88, latest: Math.max(...wcItt.map((e) => e.year)), text: `Weltmeister Zeitfahren ${yearsText(wcItt.map((e) => e.year))}` });
  const olympic = group((e) => /olympic/i.test(e.race));
  if (olympic.length) facts.push({ score: 96, latest: Math.max(...olympic.map((e) => e.year)), text: `Olympiasieg ${yearsText(olympic.map((e) => e.year))}` });
  for (const [re, name] of MONUMENTS) {
    const m = group((e) => re.test(e.race) && !e.detail && !isWomenOrJunior(e.race));
    if (m.length) facts.push({ score: 85, latest: Math.max(...m.map((e) => e.year)), text: `Sieg ${name} ${yearsText(m.map((e) => e.year))}` });
  }
  // Übrige Gesamtsiege von Rundfahrten (ohne Nachwuchs-/Junioren-Rennen)
  const known = (race: string) => [...GRAND_TOURS, ...MONUMENTS].some(([re]) => re.test(race));
  const otherGc = new Map<string, number[]>();
  for (const e of group((e) => /general/i.test(e.detail ?? '') && !known(e.race) && !isWomenOrJunior(e.race) && !/avenir|u-?23|juniors?/i.test(e.race))) {
    otherGc.set(e.race, [...(otherGc.get(e.race) ?? []), e.year]);
  }
  for (const [race, ys] of otherGc) facts.push({ score: WT_STAGE_RACES.test(race) ? 75 : 45, latest: Math.max(...ys), text: `Gesamtsieg ${race.trim()} ${yearsText(ys)}` });

  return facts.sort((a, b) => b.score - a.score || b.latest - a.latest).slice(0, max).map((f) => f.text);
}

/** Kurzübersicht: Siege gesamt und je Jahr (für die Fahrerkarte). */
export function palmaresSummary(p: PalmaresEntry[]): { wins: number; podiums: number } {
  // Nebenwertungen (Punkte, Berg, Nachwuchs …) zählen nicht als Sieg
  const real = p.filter((e) => !e.detail || /general|^stage/i.test(e.detail));
  const count = (e: PalmaresEntry) => Math.max(1, stageCount(e.detail));
  return {
    wins: real.filter((e) => e.rank === 1).reduce((a, e) => a + count(e), 0),
    podiums: real.filter((e) => e.rank <= 3).reduce((a, e) => a + count(e), 0),
  };
}
