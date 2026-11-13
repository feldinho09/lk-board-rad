/**
 * Kopierte ProCyclingStats-Fahrerseite (Strg A / Strg C im Browser) lesen.
 * Kein automatischer Abruf: PCS untersagt das; der Nutzer kopiert die Seite selbst.
 * Mehrere Seiten hintereinander eingefügt werden getrennt erkannt („Name:“ beginnt jede Seite).
 */
import type { Rider } from '../domain/types';
import { normalize, riderSearchTokens } from '../domain/text';

export interface PcsRiderPage {
  name: string;
  birthDate?: string;
  nationality?: string; // IOC-Kürzel, wenn bekannt, sonst Ländername
  birthPlace?: string;
  heightCm?: number;
  weightKg?: number;
  specialties: { key: string; points: number }[];
  /** z. B. „5× Gesamtsieg Tour de France (2020, 2021, 2024–2026)“ */
  topResults: string[];
  teams: { year: number; team: string; level?: string }[];
  wins?: number;
  family: string[];
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** Englische Ländernamen (wie PCS sie schreibt) → IOC-Kürzel */
export const COUNTRY_IOC: Record<string, string> = {
  albania: 'ALB', algeria: 'ALG', andorra: 'AND', argentina: 'ARG', australia: 'AUS', austria: 'AUT', belarus: 'BLR', belgium: 'BEL',
  bolivia: 'BOL', brazil: 'BRA', bulgaria: 'BUL', canada: 'CAN', chile: 'CHI', china: 'CHN', colombia: 'COL', 'costa rica': 'CRC',
  croatia: 'CRO', cuba: 'CUB', cyprus: 'CYP', czechia: 'CZE', 'czech republic': 'CZE', denmark: 'DEN', ecuador: 'ECU', eritrea: 'ERI',
  estonia: 'EST', ethiopia: 'ETH', finland: 'FIN', france: 'FRA', germany: 'GER', 'great britain': 'GBR', 'united kingdom': 'GBR',
  greece: 'GRE', guatemala: 'GUA', hungary: 'HUN', iceland: 'ISL', ireland: 'IRL', israel: 'ISR', italy: 'ITA', japan: 'JPN',
  kazakhstan: 'KAZ', kenya: 'KEN', 'south korea': 'KOR', korea: 'KOR', latvia: 'LAT', liechtenstein: 'LIE', lithuania: 'LTU',
  luxembourg: 'LUX', malaysia: 'MAS', mexico: 'MEX', moldova: 'MDA', monaco: 'MON', morocco: 'MAR', namibia: 'NAM',
  netherlands: 'NED', 'new zealand': 'NZL', norway: 'NOR', panama: 'PAN', paraguay: 'PAR', peru: 'PER', philippines: 'PHI',
  poland: 'POL', portugal: 'POR', romania: 'ROU', russia: 'RUS', rwanda: 'RWA', 'san marino': 'SMR', serbia: 'SRB',
  slovakia: 'SVK', slovenia: 'SLO', 'south africa': 'RSA', spain: 'ESP', sweden: 'SWE', switzerland: 'SUI', taiwan: 'TPE',
  thailand: 'THA', tunisia: 'TUN', turkey: 'TUR', türkiye: 'TUR', ukraine: 'UKR', 'united states': 'USA', usa: 'USA',
  uruguay: 'URU', uzbekistan: 'UZB', venezuela: 'VEN', 'north macedonia': 'MKD', montenegro: 'MNE', 'bosnia and herzegovina': 'BIH',
};

const SPECIALTY_DE: Record<string, string> = { oneday: 'Klassikerspezialist', gc: 'Rundfahrer', tt: 'Zeitfahrer', sprint: 'Sprinter', climber: 'Kletterer', hills: 'Puncheur' };

const yearOf = (yy: string) => {
  const n = Number(yy);
  return n < 100 ? (n > 50 ? 1900 + n : 2000 + n) : n;
};

/** „('20, '21, '24, '25, '26)“ → „2020, 2021, 2024–2026“ */
function yearsDe(raw: string): string {
  const ys = [...raw.matchAll(/'?(\d{2,4})/g)].map((m) => yearOf(m[1])).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(j - i >= 2 ? `${ys[i]}–${ys[j]}` : ys.slice(i, j + 1).join(', '));
    i = j;
  }
  return out.join(', ');
}

/** Eine „Top results“-Zeile auf Deutsch. */
export function topResultDe(line: string): string | null {
  const m = line.trim().match(/^(?:(\d+)x\s+|(\d+)(?:st|nd|rd|th)\s+)?(GC\s+|stage\s+)?(.+?)\s*\(([^)]*)\)\s*$/i);
  if (!m) return null;
  const [, times, place, kind, rawRace, years] = m;
  const n = times ? Number(times) : 1;
  const race = rawRace.replace(/\s+ME\b/, '').trim();
  const wc = race.match(/^(World|European) Championships\s*-\s*(Road Race|ITT)$/i);
  if (wc && !place && !kind) {
    const title = `${wc[1].toLowerCase() === 'world' ? 'Welt' : 'Europa'}meister ${/itt/i.test(wc[2]) ? 'Zeitfahren' : 'Strasse'}`;
    return `${n > 1 ? `${n}× ` : ''}${title} (${yearsDe(years)})`;
  }
  const y = yearsDe(years);
  const k = kind?.trim().toLowerCase();
  if (place) return `${place}. ${k === 'gc' ? 'Gesamt ' : k === 'stage' ? 'Etappe ' : ''}${race} (${y})`;
  if (k === 'gc') return `${n > 1 ? `${n}× ` : ''}Gesamtsieg ${race} (${y})`;
  if (k === 'stage') return `${n} ${n === 1 ? 'Etappensieg' : 'Etappensiege'} ${race} (${y})`;
  return `${n > 1 ? `${n}× ` : ''}Sieg ${race} (${y})`;
}

function parseOne(lines: string[]): PcsRiderPage | null {
  const get = (label: string) => lines.find((l) => l.startsWith(label + ':'))?.slice(label.length + 1).trim();
  const name = get('Name');
  if (!name) return null;
  const page: PcsRiderPage = { name, specialties: [], topResults: [], teams: [], family: [] };

  const dob = get('Date of birth')?.match(/(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]+)\s+(\d{4})/);
  if (dob && MONTHS[dob[2].toLowerCase()]) page.birthDate = `${dob[3]}-${MONTHS[dob[2].toLowerCase()]}-${dob[1].padStart(2, '0')}`;
  const nat = get('Nationality');
  if (nat) page.nationality = COUNTRY_IOC[nat.toLowerCase()] ?? nat;
  const pob = get('Place of birth');
  if (pob) page.birthPlace = pob;
  const wh = lines.find((l) => /^Weight:|Height:/.test(l)) ?? '';
  const w = wh.match(/Weight:\s*([\d.,]+)\s*kg/i);
  if (w) page.weightKg = Number(w[1].replace(',', '.'));
  const h = wh.match(/Height:\s*([\d.,]+)\s*m\b/i);
  if (h) page.heightCm = Math.round(Number(h[1].replace(',', '.')) * 100);

  const idx = (re: RegExp, from = 0) => { const i = lines.findIndex((l, k) => k >= from && re.test(l)); return i < 0 ? lines.length : i; };
  // Spezialitäten: „9938Oneday“
  const sp = idx(/^Specialties$/);
  for (let i = sp + 1; i < Math.min(sp + 8, lines.length); i++) {
    const m = lines[i].match(/^(\d+)\s*(Oneday|GC|TT|Sprint|Climber|Hills)$/i);
    if (m) page.specialties.push({ key: m[2].toLowerCase(), points: Number(m[1]) });
  }
  // Top-Ergebnisse bis „Major jerseys worn“ / „Teams“
  const tr = idx(/^Top results$/);
  const trEnd = Math.min(idx(/^Major jerseys worn$/, tr), idx(/^Teams$/, tr));
  for (let i = tr + 1; i < trEnd; i++) { const t = topResultDe(lines[i]); if (t) page.topResults.push(t); }
  // Teams: „2026UAE Team Emirates - XRG (WT)“ bis „Program“
  const tm = idx(/^Teams$/);
  const tmEnd = idx(/^(Program|Key statistics)$/, tm);
  for (let i = tm + 1; i < tmEnd; i++) {
    const m = lines[i].match(/^(\d{4})\s*(.+?)(?:\s*\(([A-Z]+)\))?$/);
    if (m) page.teams.push({ year: Number(m[1]), team: m[2].trim(), ...(m[3] ? { level: m[3] } : {}) });
  }
  // Siege: „130WinsGC (22) …“ bzw. „0Wins“
  const wins = lines.find((l) => /^\d+Wins/.test(l))?.match(/^(\d+)Wins/);
  if (wins) page.wins = Number(wins[1]);
  // Familie: Zeilen „Tilen Pogačar (Brother)“
  const fam = idx(/^Family$/);
  for (let i = fam + 1; i < lines.length && /\((Brother|Sister|Father|Mother|Son|Daughter|Cousin|Uncle|Nephew|Wife|Husband|Partner|Grandfather|Brother-in-law|Father-in-law)[^)]*\)$/i.test(lines[i]); i++) {
    page.family.push(lines[i].replace(/\(Brother\)/i, '(Bruder)').replace(/\(Sister\)/i, '(Schwester)').replace(/\(Father\)/i, '(Vater)').replace(/\(Mother\)/i, '(Mutter)').replace(/\(Son\)/i, '(Sohn)').replace(/\(Daughter\)/i, '(Tochter)').replace(/\(Cousin\)/i, '(Cousin)').replace(/\(Uncle\)/i, '(Onkel)').replace(/\(Wife\)/i, '(Ehefrau)').replace(/\(Husband\)/i, '(Ehemann)'));
  }
  return page;
}

/** Teamstationen zusammengefasst: „2025–2032 UAE Team Emirates - XRG“ (neueste zuerst). */
export function teamSpans(t: { year: number; team: string }[]): { from: number; to: number; team: string }[] {
  const asc = [...t].sort((a, b) => a.year - b.year);
  const out: { from: number; to: number; team: string }[] = [];
  for (const x of asc) {
    const last = out[out.length - 1];
    if (last && last.team === x.team && last.to === x.year - 1) last.to = x.year;
    else out.push({ from: x.year, to: x.year, team: x.team });
  }
  return out.reverse();
}

/** Eine oder mehrere kopierte Fahrerseiten. */
export function parsePcsRiderPages(text: string): PcsRiderPage[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ').trim()).filter(Boolean);
  const starts = lines.map((l, i) => (l.startsWith('Name:') ? i : -1)).filter((i) => i >= 0);
  return starts.map((s, k) => parseOne(lines.slice(s, starts[k + 1] ?? lines.length))).filter((p): p is PcsRiderPage => !!p);
}

/** Stärkste Spezialität als Fahrertyp-Vorschlag */
export function riderTypeFrom(p: PcsRiderPage): string | undefined {
  const top = [...p.specialties].sort((a, b) => b.points - a.points)[0];
  return top && top.points > 0 ? SPECIALTY_DE[top.key] : undefined;
}

/** Passt die Seite zum Fahrer? Name (akzentfrei) und – falls bekannt – Geburtsjahr. */
export function pageMatchesRider(p: PcsRiderPage, r: Rider): boolean {
  const n = normalize(p.name);
  const names = [r.displayName, `${r.firstName} ${r.lastName}`, ...r.aliases].map(normalize);
  if (!names.includes(n)) return false;
  return !(r.birthDate && p.birthDate && !p.birthDate.startsWith(r.birthDate.slice(0, 4)));
}

/**
 * Seite übernehmen: leere Felder füllen; Teamstationen und PCS-Top-Ergebnisse werden ersetzt
 * (eigene Liste der Quelle). Schlüsselfakten/Fahrertyp nur, wenn noch leer.
 */
export function applyPcsPage(r: Rider, p: PcsRiderPage, today = new Date().toISOString().slice(0, 10)): Rider {
  const next: Rider = { ...r };
  if (p.birthDate && (!r.birthDate || (r.birthDate.length === 4 && p.birthDate.startsWith(r.birthDate)))) next.birthDate = p.birthDate;
  if (p.nationality && !r.nationality && /^[A-Z]{3}$/.test(p.nationality)) next.nationality = p.nationality;
  if (p.birthPlace && !r.birthPlace) next.birthPlace = p.birthPlace;
  if (p.heightCm && !r.heightCm) next.heightCm = p.heightCm;
  if (p.weightKg && !r.weightKg) next.weightKg = p.weightKg;
  if (!r.riderType) next.riderType = riderTypeFrom(p) ?? r.riderType;
  if (p.teams.length) next.teamHistory = p.teams;
  if (p.topResults.length) next.topResults = p.topResults;
  if (p.wins != null) next.careerWins = p.wins;
  if (p.family.length) next.family = p.family;
  if (!r.keyFacts.some((f) => f.trim()) && p.topResults.length) next.keyFacts = p.topResults.slice(0, 3);
  // Schreibweise mit Akzenten übernehmen, wenn nur diese abweicht
  if (normalize(p.name) === normalize(r.displayName) && p.name !== r.displayName && r.displayName === `${r.firstName} ${r.lastName}`) {
    const parts = p.name.split(' ');
    const lastLen = r.lastName.split(' ').length;
    const first = parts.slice(0, parts.length - lastLen).join(' ');
    const last = parts.slice(parts.length - lastLen).join(' ');
    if (normalize(first) === normalize(r.firstName) && normalize(last) === normalize(r.lastName)) {
      Object.assign(next, { firstName: first, lastName: last, displayName: p.name });
      next.aliases = r.aliases.includes(r.displayName) ? r.aliases : [...r.aliases, r.displayName];
      next.searchTokens = riderSearchTokens(first, last, p.name, next.aliases);
    }
  }
  const src = `ProCyclingStats, kopiert (${today})`;
  const old = r.sources ?? '';
  next.sources = old ? (/ProCyclingStats, kopiert \([\d-]+\)/.test(old) ? old.replace(/ProCyclingStats, kopiert \([\d-]+\)/, src) : `${old}; ${src}`) : src;
  return next;
}
