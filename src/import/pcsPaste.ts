/**
 * Von ProCyclingStats MANUELL kopierte Inhalte erkennen (Strg A / Strg C auf der PCS-Seite,
 * im eigenen Browser, für den persönlichen Gebrauch). Es findet KEIN automatischer Abruf
 * von PCS statt (PCS-Nutzungsbedingungen untersagen automatisierte Zugriffe).
 *
 * Startliste, wie sie beim Kopieren entsteht:
 *   UAE Team Emirates - XRG (WT)        ← Team mit Status
 *   1POGAČAR Tadej                      ← Startnummer direkt vor dem Namen
 *   …
 *   DS MARCATO Marco, MARZANO Marco     ← Sportliche Leiter (ignoriert)
 *   team statistics in race             ← Menütext (ignoriert)
 * Kopfbereich: „2026 » 110th Ronde van Vlaanderen ME (1.UWT)“, „175 riders“.
 */

import type { ClassificationKind } from '../domain/types';
import { parseDuration } from '../domain/text';

export interface PcsRaceMeta {
  year?: number;
  raceName?: string;
  raceClass?: string;
  route?: string;
  distanceKm?: number;
  expectedRiders?: number;
}

export interface PcsStartlistEntry { bib: string; name: string; team: string; teamStatus: string; line: number }

export interface PcsStartlist {
  meta: PcsRaceMeta;
  entries: PcsStartlistEntry[];
  teams: string[];
  warnings: string[];
}

// Nummer + Name, Name beginnt mit Großbuchstabe (inkl. Akzente) oder Apostroph-Namen wie O'BRIEN
// PCS schreibt die Nummer OHNE Abstand vor den Namen („1POGAČAR Tadej“). Mit Abstand oder
// Tabulator wäre es eine normale Tabelle – die darf nicht als PCS erkannt werden.
const RIDER = /^(\d{1,4})([\p{Lu}][\p{L}'’.\- ]*\p{Ll}[^\t;|]*|[\p{Lu}][\p{Lu}'’.\- ]+)$/u;
const TEAM = /^(.+?)\s*\((WT|PRT|CT|NT|PRO|CTW|WTW|DEV|CL)\)\s*$/;
const IGNORE = /^(DS\s|team statistics in race$|more pdf options|startlist$|default$|search$)/i;

export function parsePcsStartlist(text: string): PcsStartlist | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ').trim());
  const meta: PcsRaceMeta = {};
  const entries: PcsStartlistEntry[] = [];
  const teams: string[] = [];
  const warnings: string[] = [];
  let team = '';
  let teamStatus = '';
  let prev = '';

  lines.forEach((l, i) => {
    if (!l) return;
    const head = l.match(/^(\d{4})\s*»\s*(?:\d+(?:st|nd|rd|th)\s+)?(.+?)(?:\s*\(([^)]+)\))?$/);
    if (head && !meta.raceName) { meta.year = Number(head[1]); meta.raceName = head[2].replace(/\s+ME$|\s+WE$/, '').trim(); meta.raceClass = head[3]; }
    const route = l.match(/»\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*km\)/);
    if (route && !meta.route) { meta.route = route[1].replace(/\s+/g, ' '); meta.distanceKm = Number(route[2].replace(',', '.')); }
    const cnt = l.match(/^(\d+)\s+riders$/i);
    if (cnt) { meta.expectedRiders = Number(cnt[1]); return; }
    if (IGNORE.test(l)) { prev = ''; return; }
    const r = l.match(RIDER);
    if (r) {
      // Team = Überschrift direkt vor dem ersten Fahrer des Blocks
      if (prev && !RIDER.test(prev)) {
        const t = prev.match(TEAM);
        team = t ? t[1] : prev;
        teamStatus = t ? t[2] : '';
        if (!teams.includes(team)) teams.push(team);
      }
      entries.push({ bib: r[1], name: r[2].trim(), team, teamStatus, line: i + 1 });
    }
    prev = l;
  });

  // Kein PCS-Aufbau: zu wenige Fahrer, Tabellenzeilen mit Trennzeichen oder keine Teamzeile „(WT)“ o. ä.
  const tabular = lines.filter((l) => /[\t;]/.test(l)).length;
  const teamLines = lines.filter((l) => TEAM.test(l)).length;
  if (entries.length < 3 || teamLines === 0 || tabular > entries.length / 2) return null;
  if (entries.some((e) => !e.team)) warnings.push(`${entries.filter((e) => !e.team).length} Fahrer ohne erkanntes Team`);
  if (meta.expectedRiders != null && meta.expectedRiders !== entries.length) {
    warnings.push(`PCS nennt ${meta.expectedRiders} Fahrer, erkannt wurden ${entries.length} – bitte prüfen, ob die Seite vollständig kopiert wurde.`);
  }
  const bibs = new Map<string, number>();
  for (const e of entries) bibs.set(e.bib, (bibs.get(e.bib) ?? 0) + 1);
  const dup = [...bibs].filter(([, n]) => n > 1).map(([b]) => b);
  if (dup.length) warnings.push(`Doppelte Startnummern: ${dup.join(', ')}`);
  return { meta, entries, teams, warnings };
}

export function pcsStartlistToMatrix(s: PcsStartlist): string[][] {
  return [['Nr', 'Name', 'Team', 'Teamstatus'], ...s.entries.map((e) => [e.bib, e.name, e.team, e.teamStatus])];
}

// ---------------------------------------------------------------- Ranglisten

export interface PcsRankingRow {
  rank: number | null;
  status?: string; // DNF, DNS, OTL, DSQ, DF, NR
  prevRank: number | null;
  name?: string; // Fahrer (PCS-Schreibweise)
  team: string;
  teamClass?: string;
  timeSec?: number | null; // nur Platz 1: absolute Zeit
  gapSec?: number | null;
  sameTimeAsPrevious?: boolean;
  points?: number | null;
  sourceValue: string;
}

export interface PcsRanking {
  meta: PcsRaceMeta & { stageLabel?: string; stageNumber?: number; isOneDay?: boolean };
  kind: ClassificationKind;
  unit: 'zeit' | 'punkte';
  /** PCS zeigt bei Punkte/Berg/Nachwuchs „General“ und „Today“ – der kopierte Text verrät nicht sicher, welcher Reiter aktiv war */
  kindCertain: boolean;
  rows: PcsRankingRow[];
  warnings: string[];
}

const STATUS = /^(DNF|DNS|OTL|DSQ|DF|NR|HD)$/;
const TITLE_KIND: [RegExp, ClassificationKind][] = [
  [/^General classification$/i, 'gc'],
  [/^Points classification$/i, 'punkte'],
  [/^Mountains classification$/i, 'berg'],
  [/^Youth classification$/i, 'nachwuchs'],
  [/^Teams classification$/i, 'team'],
];

/** Erkennt eine kopierte PCS-Ergebnisseite (Etappe, GC, Punkte, Berg, Nachwuchs, Team). */
export function parsePcsRanking(text: string): PcsRanking | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' '));
  const t = lines.map((l) => l.trim());
  const meta: PcsRanking['meta'] = {};
  let kind: ClassificationKind | null = null;
  let headerIdx = -1;
  for (let i = 0; i < t.length; i++) {
    const head = t[i].match(/^(\d{4})\s*»\s*(?:\d+(?:st|nd|rd|th)\s+)?(.+?)(?:\s*\(([^)]+)\))?$/);
    if (head && !meta.raceName) { meta.year = Number(head[1]); meta.raceName = head[2].replace(/\s+(ME|WE)$/, '').trim(); meta.raceClass = head[3]; }
    const st = t[i].match(/^(Stage\s+(\d+)([ab])?|Prologue|One day race)\s*»\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*km\)/i);
    if (st && !meta.stageLabel) {
      meta.isOneDay = /one day/i.test(st[1]);
      meta.stageLabel = /prologue/i.test(st[1]) ? 'Prolog' : meta.isOneDay ? 'Rennen' : `Etappe ${st[2]}${st[3] ?? ''}`;
      meta.stageNumber = /prologue/i.test(st[1]) ? 0 : st[2] ? Number(st[2]) : undefined;
      meta.route = st[4].replace(/\s+/g, ' ');
      meta.distanceKm = Number(st[5].replace(',', '.'));
    }
    for (const [re, k] of TITLE_KIND) if (re.test(t[i])) kind = k;
    if (/^(Rnk|#)\t/.test(lines[i].trimStart()) && headerIdx < 0) { headerIdx = i; break; }
  }
  if (headerIdx < 0 || !meta.raceName) return null;
  const header = lines[headerIdx].trim().split('\t').map((h) => h.trim());
  const isTeamTable = kind === 'team' || (header.includes('Team') && !header.includes('Rider'));
  if (!kind) kind = isTeamTable ? 'team' : 'etappe';
  const valueCol = header.findIndex((h) => /^(Timelag|Time|Pnt|Points)$/i.test(h));
  if (valueCol < 0) return null;
  const unit: 'zeit' | 'punkte' = /^(Pnt|Points)$/i.test(header[valueCol]) ? 'punkte' : 'zeit';
  const prevCol = header.findIndex((h) => /^Prev\.?$/i.test(h));
  const teamCol = header.indexOf('Team');
  const classCol = header.indexOf('Class');

  const rows: PcsRankingRow[] = [];
  const warnings: string[] = [];
  const isEnd = (s: string) => /^(Race information|timelimit|DNF = )/i.test(s);
  const rankOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
  let lastGap: number | null = null;

  const pushValue = (row: PcsRankingRow, raw: string) => {
    const v = raw.trim();
    row.sourceValue = v;
    if (unit === 'punkte') { row.points = v === '' ? null : /^\d+$/.test(v) ? Number(v) : null; return; }
    if (v === ',,') { row.gapSec = lastGap; row.sameTimeAsPrevious = true; return; }
    const sec = parseDuration(v.replace(/^\*/, ''));
    if (row.rank === 1 && rows.length === 0) { row.timeSec = sec; row.gapSec = 0; lastGap = 0; return; }
    row.gapSec = sec;
    if (sec != null) lastGap = sec;
  };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (isEnd(t[i])) break;
    if (!t[i]) continue;
    const cells = lines[i].split('\t');
    const first = cells[0].trim();
    if (!(/^\d+$/.test(first) || STATUS.test(first))) continue;
    if (isTeamTable) {
      const row: PcsRankingRow = {
        rank: rankOf(first), status: STATUS.test(first) ? first : undefined,
        prevRank: prevCol >= 0 ? rankOf((cells[prevCol] ?? '').trim()) : null,
        team: (cells[teamCol] ?? '').trim(), teamClass: classCol >= 0 ? (cells[classCol] ?? '').trim() || undefined : undefined, sourceValue: '',
      };
      pushValue(row, cells[valueCol] ?? '');
      rows.push(row);
      continue;
    }
    // Fahrerzeile: Rang [Prev ▼▲] Name   ·   Folgezeile: Team + Werte (Spalten ab „Team“)
    const name = cells[cells.length - 1].trim();
    const next = lines[i + 1] ?? '';
    const nextCells = next.split('\t');
    const row: PcsRankingRow = {
      rank: rankOf(first), status: STATUS.test(first) ? first : undefined,
      prevRank: prevCol >= 0 ? rankOf((cells[prevCol] ?? '').trim()) : null,
      name, team: (nextCells[0] ?? '').trim(), sourceValue: '',
    };
    const vIdx = valueCol - teamCol;
    pushValue(row, vIdx >= 0 ? nextCells[vIdx] ?? '' : '');
    if (row.status) { row.gapSec = null; row.timeSec = null; row.sameTimeAsPrevious = false; }
    rows.push(row);
    i++; // Folgezeile verarbeitet
  }
  if (rows.length === 0) return null;
  // Plausibilität
  const ranks = rows.filter((r) => r.rank != null).map((r) => r.rank!);
  ranks.forEach((r, k) => { if (r !== k + 1) warnings.push(`Platz ${k + 1} fehlt oder ist doppelt (gefunden: ${r})`); });
  if (unit === 'zeit' && rows.some((r) => r.rank != null && r.rank > 1 && r.gapSec == null)) warnings.push('Einige Rückstände konnten nicht gelesen werden');
  const kindCertain = kind === 'gc' || kind === 'etappe' || kind === 'team' ? true : prevCol >= 0 && rows.some((r) => r.prevRank != null);
  return { meta, kind, unit, kindCertain, rows, warnings: warnings.slice(0, 5) };
}
