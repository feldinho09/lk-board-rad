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
import { normalize } from '../domain/text';


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

/**
 * Fahrer-Links aus der kopierten PCS-Seite: Beim Kopieren legt der Browser neben dem Text
 * auch das HTML in die Zwischenablage, darin stehen die Links „rider/tadej-pogacar“.
 * Nur Text, den der Nutzer selbst eingefügt hat – kein Abruf.
 */
export interface PcsRiderLink { name: string; slug: string; bib?: string }

/** Kennung aus einer Adresse: „…/rider/tadej-pogacar“, „rider/tadej-pogacar/statistics“, „rider.php?id=…“ nicht. */
export function slugFromHref(href: string): string | undefined {
  let h = href.trim();
  try { h = decodeURIComponent(h); } catch { /* bleibt */ }
  const m = h.match(/(?:^|[/.])rider\/([^/?#\s"']+)/i);
  const s = m?.[1]?.toLowerCase();
  return s && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s) && s.includes('-') ? s : undefined;
}

export function pcsRiderLinks(html: string): PcsRiderLink[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: PcsRiderLink[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const slug = slugFromHref(a.getAttribute('href') ?? '');
    const name = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    // Startnummer: Text des Listeneintrags bzw. der Tabellenzeile vor dem Link
    let bib: string | undefined;
    const box = a.closest('li, tr, div');
    if (box) {
      const before = (box.textContent ?? '').split(a.textContent ?? '\u0000')[0].replace(/\s+/g, ' ').trim();
      bib = before.match(/(?:^|\s)(\d{1,3})$/)?.[1];
    }
    out.push({ name, slug, bib });
  }
  return out;
}

const words = (s: string) => normalize(s).split(' ').filter((w) => w.length > 1);

/**
 * Kennungen den Fahrern der Startliste zuordnen: zuerst über den Linktext (Name),
 * dann über die Startnummer, zuletzt über die Kennung selbst („jonas-vingegaard-rasmussen“
 * enthält alle Namensteile von „Jonas Vingegaard“). Nur eindeutige Treffer.
 */
export function matchPcsSlugs(entries: { bib?: string; name: string }[], links: PcsRiderLink[]): (string | undefined)[] {
  const key = (s: string) => words(s).sort().join(' ');
  const byName = new Map<string, string | null>();
  for (const l of links) { const k = key(l.name); if (k) byName.set(k, byName.has(k) && byName.get(k) !== l.slug ? null : l.slug); }
  const byBib = new Map<string, string | null>();
  for (const l of links) if (l.bib) byBib.set(l.bib, byBib.has(l.bib) && byBib.get(l.bib) !== l.slug ? null : l.slug);
  return entries.map((e) => {
    const n = byName.get(key(e.name));
    if (n) return n;
    const b = e.bib ? byBib.get(e.bib) : undefined;
    if (b && words(e.name).some((w) => b.split('-').includes(w))) return b;
    const ws = words(e.name);
    const hits = links.filter((l) => ws.length > 0 && ws.every((w) => l.slug.split('-').includes(w)));
    return hits.length === 1 ? hits[0].slug : undefined;
  });
}
