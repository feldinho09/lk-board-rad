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
