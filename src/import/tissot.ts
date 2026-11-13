/**
 * Automatischer Abruf von Tissot Timing (offizielle Zeitnahme der ASO-Rennen, Tour de Suisse,
 * Tour de Romandie u. a.). Laut Auskunft des Nutzers ist der automatische Abruf dort erlaubt
 * (siehe docs/ARCHITEKTUR.md, Abschnitt „Tissot Timing“).
 *
 * Die öffentliche Website lädt ihre Daten als JSON von prod.server.tissottiming.com; der Server
 * erlaubt den Abruf aus dem Browser (CORS). Wir verwenden dieselben Endpunkte – schonend:
 *  - streng nacheinander, mindestens MIN_GAP_MS zwischen zwei Anfragen,
 *  - keine Zugangsdaten, keine Cookies, kein Referrer,
 *  - automatische Aktualisierung höchstens alle paar Minuten (siehe TissotAutoSync).
 *
 * Wettbewerbs-Kennung = Kürzel + Jahr, z. B. "tdf2026", "tds2026", "prx2026".
 */
import type { ClassificationKind, PalmaresEntry, Stage, StageType, StartStatus } from '../domain/types';
import { splitFullName } from './matching';

export const TISSOT_API = 'https://prod.server.tissottiming.com';
export const TISSOT_WEB = 'https://www.tissottiming.com';
export const TISSOT_SOURCE = 'Tissot Timing';
const MIN_GAP_MS = 350;

export type JsonFetcher = (path: string) => Promise<unknown>;

let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

/** Browser-Abruf: eine Anfrage nach der anderen, mit Mindestabstand und Zeitlimit. */
export const tissotFetcher: JsonFetcher = (path) => {
  const run = async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(TISSOT_API + path, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Tissot Timing antwortet mit ${res.status}`);
      return await res.json();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Tissot Timing antwortet nicht (Zeitüberschreitung).');
      if (e instanceof TypeError) throw new Error('Tissot Timing nicht erreichbar – keine Internetverbindung?');
      throw e;
    } finally { clearTimeout(t); }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
};

// ---------------------------------------------------------------- Rohformate (Auszug)

export interface TtCompetition { code: string; start: string; end: string; name: string; sport: string; type: string; status: string; location?: string; utcOffset?: number }
export interface TtStage { number: number; name: string; type: string; category?: string; distance?: string; start?: string; tabs?: string[] }
export interface TtRider { key: string; bib: number; name: string; nation?: string; uciRiderId?: string; teamCode?: string; teamName?: string; status?: string; young?: boolean }
export interface TtTeam { name: string; bib?: number; nation?: string; code?: string; members: TtRider[] }
export interface TtResult { resultType: string; key: string; rider?: TtRider; team?: TtTeam; rank: number | null; value: string; bonif?: string }
export interface TtRanking { order: number; name?: string; type: 'Stage' | 'Overall' | string; rankingType: string; distance?: string; results?: TtResult[] }
export interface TtAthlete { firstName?: string; lastName?: string; birthdate?: string; birthplace?: string; nation?: string; uciRiderId?: string; name?: string }

// ---------------------------------------------------------------- Abfragen

/** Strassenrennen eines Jahres (Rundfahrten und Eintagesrennen; Weltmeisterschaften nicht). */
export async function listRoadRaces(year: number, f: JsonFetcher = tissotFetcher): Promise<TtCompetition[]> {
  const all = ((await f(`/competitions?year=${year}`)) as TtCompetition[] | null) ?? [];
  return all.filter((c) => c.sport === 'CRD' && (c.type === 'GrandTour' || c.type === 'SingleRace'))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const competitionId = (code: string, year: number) => `${code}${year}`;

export async function listStages(compId: string, f: JsonFetcher = tissotFetcher): Promise<TtStage[]> {
  return (((await f(`/competitions/${compId}/stages`)) as TtStage[] | null) ?? []).sort((a, b) => a.number - b.number);
}

export async function getTeams(compId: string, stage: number, f: JsonFetcher = tissotFetcher): Promise<TtTeam[]> {
  return ((await f(`/competitions/${compId}/stages/${stage}/teams`)) as TtTeam[] | null) ?? [];
}

export async function getRankings(compId: string, stage: number, which: 'stage' | 'overall', f: JsonFetcher = tissotFetcher): Promise<TtRanking[]> {
  return ((await f(`/competitions/${compId}/stages/${stage}/rankings/${which}`)) as TtRanking[] | null) ?? [];
}

export async function getAthlete(uciId: string, compId: string, f: JsonFetcher = tissotFetcher): Promise<TtAthlete | null> {
  return (await f(`/athletes/infos/${encodeURIComponent(uciId)}/${compId}/0`)) as TtAthlete | null;
}

/** Top-10-Ergebnisse (UCI-Rennen) eines Fahrers, neueste zuerst. */
export async function getPalmares(uciId: string, f: JsonFetcher = tissotFetcher): Promise<PalmaresEntry[] | null> {
  const d = (await f(`/athletes/palmares/${encodeURIComponent(uciId)}`)) as { year: number; palmares: { rank: string; name: string; description?: string; nation?: string }[] }[] | null;
  if (!d) return null;
  return d.flatMap((y) => y.palmares.map((e) => ({
    year: y.year, rank: Number(e.rank), race: e.name.replace(/\s+/g, ' ').trim(),
    ...(e.description?.trim() ? { detail: e.description.trim() } : {}), ...(e.nation ? { nation: e.nation } : {}),
  }))).filter((e) => Number.isFinite(e.rank) && e.rank > 0).sort((a, b) => b.year - a.year || a.rank - b.rank);
}

// ---------------------------------------------------------------- Umwandlung

/** "Barcelone > Barcelone" → Start/Ziel; Etappentyp nach Tissot-Kürzel. */
export function stageFromTissot(s: TtStage, oneDay: boolean): Pick<Stage, 'order' | 'label' | 'date' | 'type' | 'start' | 'finish' | 'distanceKm'> {
  const [start, finish] = s.name.split('>').map((x) => x.trim());
  const type: StageType = oneDay ? 'eintages' : s.type === 'ITT' ? 'ezf' : s.type === 'TTT' ? 'mzf' : s.type === 'PRO' || /prolog/i.test(s.name) ? 'prolog' : 'strasse';
  const km = Number(s.distance);
  return {
    order: s.number,
    label: oneDay ? 'Rennen' : `Etappe ${s.number}`,
    date: (s.start ?? '').slice(0, 10),
    type,
    start: start || undefined,
    finish: finish || undefined,
    distanceKm: Number.isFinite(km) && km > 0 ? km : undefined,
  };
}

/** Tissot schreibt Namen wie PCS: „POGACAR Tadej“ (Nachname in Grossbuchstaben). */
export function splitTissotName(name: string): { first: string; last: string } {
  return splitFullName(name.replace(/\s+/g, ' ').trim());
}

const STATUS_MAP: Record<string, StartStatus | undefined> = { DNF: 'DNF', DNS: 'DNS', OTL: 'OTL', HD: 'HD', DSQ: 'DSQ', DQ: 'DSQ' };
export const tissotStatus = (s: string | undefined): StartStatus | undefined => (s ? STATUS_MAP[s.toUpperCase()] : undefined);

/** Startliste als Tabelle für den normalen Prüf-Import (gleiche Regeln wie CSV/PDF). */
export function teamsToMatrix(teams: TtTeam[]): string[][] {
  const rows: string[][] = [['Nr', 'Vorname', 'Nachname', 'Team', 'Nation', 'UCI-ID', 'Tissot-Status']];
  for (const t of teams) {
    for (const m of [...t.members].sort((a, b) => a.bib - b.bib)) {
      const n = splitTissotName(m.name);
      rows.push([String(m.bib), n.first, n.last, t.name, m.nation ?? '', m.uciRiderId ?? '', m.status ?? '']);
    }
  }
  return rows;
}

/**
 * Tissot schreibt Zeiten je nach Rennen unterschiedlich – alle bedeuten dasselbe:
 * „16:32:07“, „4:59:39"“, „21:47''“, „15h08'43"“, „06'32"“, „28“, „08''“, „00"“.
 * Liefert Sekunden (Bruchteile bleiben erhalten) oder null.
 */
export function parseTissotTime(v: string | undefined): number | null {
  let s = (v ?? '').trim().replace(/^\+/, '').replace(/\s+/g, '');
  if (!s || !/\d/.test(s)) return null;
  // Negativer Rückstand kommt vor (z. B. neutralisierte Schlussetappe)
  const neg = /^[-−]/.test(s);
  s = s.replace(/^[-−]/, '');
  const minutesOnly = /^\d+'$/.test(s);
  s = s.replace(/(''|"|″)$/, '').replace(/h/i, ':').replace(/['′](?=\d)/g, ':').replace(/'$/, '');
  if (!/^\d+(:\d+){0,2}([.,]\d+)?$/.test(s)) return null;
  const sec = s.replace(',', '.').split(':').reduce((a, p) => a * 60 + Number(p), 0);
  return (neg ? -1 : 1) * (minutesOnly ? sec * 60 : sec);
}

/** „' '“ = gleiche Zeit wie der Vordermann (wie „,,“ bei PCS) */
export const isSameTimeMark = (v: string | undefined) => /^['"]\s*['"]$/.test((v ?? '').trim());

/** Eine Zeile im Format der bestehenden Ranglisten-Logik (siehe pcsRankingCommit). */
export interface TissotRow {
  rank: number | null;
  name?: string;
  uciId?: string;
  bib?: string;
  team: string;
  timeSec?: number | null;
  gapSec?: number | null;
  sameTimeAsPrevious?: boolean;
  points?: number | null;
  sourceValue: string;
  prevRank: number | null;
  status?: StartStatus;
}

export interface TissotRanking {
  kind: ClassificationKind;
  unit: 'zeit' | 'punkte';
  title: string;
  rows: TissotRow[];
}

/** Welche Tissot-Wertung entspricht welcher Wertung im LK Board? */
export function kindOf(r: TtRanking): ClassificationKind | null {
  const overall = r.type === 'Overall';
  switch (r.rankingType) {
    case 'Time': return overall ? 'gc' : 'etappe';
    case 'SprintPoints': return overall ? 'punkte' : null;
    case 'MountainPoints': return overall ? 'berg' : null;
    case 'Young': return overall ? 'nachwuchs' : null;
    case 'Team': return overall ? 'team' : null;
    default: return null;
  }
}

export function convertRanking(r: TtRanking): TissotRanking | null {
  const kind = kindOf(r);
  const results = r.results ?? [];
  if (!kind || !results.length) return null;
  const unit: 'zeit' | 'punkte' = kind === 'punkte' || kind === 'berg' ? 'punkte' : 'zeit';
  let prevGap: number | null = null;
  const rows = results.map((x): TissotRow => {
    const status = tissotStatus(x.value?.trim());
    const row: TissotRow = {
      rank: !status && typeof x.rank === 'number' && x.rank > 0 ? x.rank : null,
      team: x.team?.name ?? x.rider?.teamName ?? '',
      sourceValue: x.value,
      prevRank: null,
    };
    if (x.rider) { row.name = x.rider.name; row.uciId = x.rider.uciRiderId || undefined; row.bib = String(x.rider.bib); }
    if (status) { row.status = status; return row; }
    if (unit === 'punkte') row.points = /^-?\d+$/.test(x.value.trim()) ? Number(x.value) : null;
    // Platz 1 trägt die absolute Zeit, alle anderen den Rückstand darauf
    else if (row.rank === 1) { row.timeSec = parseTissotTime(x.value); row.gapSec = 0; prevGap = 0; }
    else if (isSameTimeMark(x.value)) { row.gapSec = prevGap; row.sameTimeAsPrevious = true; }
    else {
      const g = parseTissotTime(x.value);
      row.gapSec = g;
      row.sameTimeAsPrevious = g != null && g === prevGap;
      prevGap = g;
    }
    return row;
  });
  return { kind, unit, title: r.name ?? kind, rows };
}

/** Alle verwendbaren Wertungen einer Etappe (Etappenergebnis + Gesamtstände danach). */
export async function fetchStageRankings(compId: string, stage: number, f: JsonFetcher = tissotFetcher): Promise<TissotRanking[]> {
  const out: TissotRanking[] = [];
  for (const which of ['stage', 'overall'] as const) {
    for (const r of await getRankings(compId, stage, which, f)) {
      const c = convertRanking(r);
      if (c && !out.some((o) => o.kind === c.kind)) out.push(c);
    }
  }
  return out;
}

/** Ausfälle laut Tissot-Teamliste, nach UCI-ID und Startnummer. */
export function statusesFromTeams(teams: TtTeam[]): { uciId?: string; bib: string; status: StartStatus }[] {
  const out: { uciId?: string; bib: string; status: StartStatus }[] = [];
  for (const t of teams) for (const m of t.members) {
    const st = tissotStatus(m.status);
    if (st) out.push({ uciId: m.uciRiderId || undefined, bib: String(m.bib), status: st });
  }
  return out;
}

/** Jüngste Etappe, für die Tissot bereits Ergebnisse führt (Startzeit erreicht). */
export function latestStartedStage(stages: TtStage[], now = new Date()): TtStage | undefined {
  return [...stages].reverse().find((s) => s.start && new Date(s.start) <= now && s.tabs?.includes('Rankings'));
}

/** „1998-09-21T00:00:00“ → „1998-09-21“ */
export function tissotDate(v: string | undefined): string | undefined {
  const m = (v ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m && !m[1].startsWith('0001') ? m[1] : undefined;
}

export const tissotPageUrl = (code: string, year: number, stage?: number) =>
  `${TISSOT_WEB}/${year}/${code}${stage != null ? `/stage-${stage}` : ''}`;
