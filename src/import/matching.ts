/**
 * Startlisten-Abgleich (Bauplan Abschnitt 7) – reine Funktionen, ohne Datenbank,
 * damit die Zuordnungsregeln vollständig testbar sind.
 *
 * Regeln:
 *  1. Belastbare externe ID zuerst.
 *  2. Im aktiven Rennen bereits gemeldete Person mit gleichem Namen = sichere Zuordnung
 *     (macht wiederholte Importe idempotent).
 *  3. Global namensgleiche Fahrer werden NUR zugeordnet, wenn ein weiteres Merkmal
 *     (Nationalität oder Geburtsjahr) übereinstimmt und keines widerspricht.
 *     Name allein → "mehrdeutig", Entscheidung nötig.
 *  4. Nichts wird still ausgelassen: jede Zeile hat einen Status.
 */
import type { ExternalId, Participation, Rider } from '../domain/types';
import { nameKey, normalize } from '../domain/text';

export const TARGET_FIELDS = [
  { key: 'bib', label: 'Startnummer' },
  { key: 'firstName', label: 'Vorname' },
  { key: 'lastName', label: 'Nachname' },
  { key: 'fullName', label: 'Name (vollständig)' },
  { key: 'team', label: 'Team' },
  { key: 'category', label: 'Kategorie' },
  { key: 'nationality', label: 'Nationalität' },
  { key: 'birthDate', label: 'Geburtsdatum/-jahr' },
  { key: 'pcsId', label: 'PCS-Kennung' },
  { key: 'uciId', label: 'UCI-ID' },
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number]['key'];
export type Mapping = Partial<Record<TargetField, string>>;

export interface NormalizedRow {
  bib: string;
  firstName: string;
  lastName: string;
  displayName: string;
  team: string;
  category: string;
  nationality: string;
  birthDate: string;
  externalIds: ExternalId[];
}

export type RowStatus = 'zugeordnet' | 'neu' | 'mehrdeutig' | 'fehlerhaft';
export type RowDiff = 'neu_im_rennen' | 'unveraendert' | 'geaendert' | null;

export interface MatchedRow {
  index: number;
  original: Record<string, string>;
  norm: NormalizedRow;
  status: RowStatus;
  diff: RowDiff;
  riderId?: string;
  candidates: string[];
  existingParticipationId?: string;
  changes: string[];
  problems: string[];
}

export interface MatchResult {
  rows: MatchedRow[];
  notInFile: Participation[];
}

/** Aliasnamen für automatische Spaltenerkennung */
const HEADER_HINTS: Record<TargetField, string[]> = {
  bib: ['startnummer', 'nr', 'nummer', 'bib', 'dossard', 'no', 'start no', 'startnr', '#'],
  firstName: ['vorname', 'first name', 'firstname', 'prenom', 'given name'],
  lastName: ['nachname', 'name', 'last name', 'lastname', 'nom', 'surname', 'family name'],
  fullName: ['fahrer', 'rider', 'coureur', 'fahrername', 'full name', 'vollstandiger name'],
  team: ['team', 'equipe', 'mannschaft', 'squadra'],
  category: ['kategorie', 'category', 'cat', 'klasse'],
  nationality: ['nation', 'nationalitat', 'nationality', 'land', 'nat', 'country'],
  birthDate: ['geburtsdatum', 'jahrgang', 'birth', 'birthdate', 'date of birth', 'geburtsjahr', 'dob'],
  pcsId: ['pcs', 'pcs id', 'pcs-id', 'procyclingstats'],
  uciId: ['uci', 'uci id', 'uci-id', 'uciid'],
};

export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  for (const f of TARGET_FIELDS) {
    const hints = HEADER_HINTS[f.key];
    const h = headers.find((hd) => !used.has(hd) && hints.includes(normalize(hd)));
    if (h) {
      m[f.key] = h;
      used.add(h);
    }
  }
  // "Name" ohne Vorname-Spalte ist vermutlich der vollständige Name
  if (m.lastName && !m.firstName && !m.fullName) {
    m.fullName = m.lastName;
    delete m.lastName;
  }
  return m;
}

const PARTICLES = new Set(['van', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'des', 'la', 'le', 'von', 'ten', 'ter', 'y']);
/** "O'BRIEN" → "O'Brien", "RENARD-HAQUIN" → "Renard-Haquin", "VAN DER POEL" → "Van der Poel".
 *  Nur Darstellung – Abgleich und Suche sind unabhängig von Groß-/Kleinschreibung. */
export function capitalizeNamePart(p: string, index: number): string {
  const low = p.toLocaleLowerCase();
  if (index > 0 && PARTICLES.has(low)) return low;
  return low.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase());
}

/** "POGAČAR Tadej" (PCS-Stil) oder "Tadej Pogačar" → Vor-/Nachname, Original bleibt displayName */
export function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: full.trim() };
  const isUpper = (p: string) => p === p.toLocaleUpperCase() && p !== p.toLocaleLowerCase();
  const upper = parts.filter(isUpper);
  if (upper.length > 0 && upper.length < parts.length) {
    const last = parts.filter(isUpper).map((p, i) => capitalizeNamePart(p, i)).join(' ');
    const first = parts.filter((p) => !isUpper(p)).join(' ');
    return { first, last };
  }
  if (full.includes(',')) {
    const [l, f] = full.split(',', 2);
    return { first: f.trim(), last: l.trim() };
  }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function normalizeRow(raw: Record<string, string>, mapping: Mapping): NormalizedRow {
  const get = (f: TargetField) => (mapping[f] ? String(raw[mapping[f]!] ?? '').trim() : '');
  let first = get('firstName');
  let last = get('lastName');
  const full = get('fullName');
  let display = '';
  if (full && (!first || !last)) {
    const s = splitFullName(full);
    first = first || s.first;
    last = last || s.last;
  }
  display = first && last ? `${first} ${last}` : full || `${first} ${last}`.trim();
  const ext: ExternalId[] = [];
  if (get('pcsId')) ext.push({ ns: 'pcs', value: get('pcsId') });
  if (get('uciId')) ext.push({ ns: 'uci', value: get('uciId').replace(/\s+/g, '') });
  return {
    bib: get('bib'), // bleibt Text: "007" bleibt "007"
    firstName: first,
    lastName: last,
    displayName: display,
    team: get('team'),
    category: get('category'),
    nationality: get('nationality').toUpperCase(),
    birthDate: get('birthDate'),
    externalIds: ext,
  };
}

function birthYear(s: string | undefined): string | null {
  const m = (s ?? '').match(/(\d{4})/);
  return m ? m[1] : null;
}

function riderKey(r: Rider) {
  return nameKey(r.firstName, r.lastName);
}

export interface MatchContext {
  riders: Rider[];
  editionParticipations: Participation[];
  bibScope: 'rennen' | 'kategorie';
}

export function matchRows(rawRows: Record<string, string>[], mapping: Mapping, ctx: MatchContext): MatchResult {
  const riders = ctx.riders.filter((r) => !r.deleted && !r.mergedInto);
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const parts = ctx.editionParticipations.filter((p) => !p.deleted);
  const byNameKey = new Map<string, Rider[]>();
  for (const r of riders) {
    const k = riderKey(r);
    byNameKey.set(k, [...(byNameKey.get(k) ?? []), r]);
  }
  const extIndex = new Map<string, Rider>();
  for (const r of riders) for (const e of r.externalIds) extIndex.set(`${e.ns}:${e.value}`, r);

  const bibKey = (bib: string, cat: string) => (ctx.bibScope === 'kategorie' ? `${cat}|${bib}` : bib);

  const rows: MatchedRow[] = rawRows.map((original, index) => {
    const norm = normalizeRow(original, mapping);
    const row: MatchedRow = { index, original, norm, status: 'neu', diff: null, candidates: [], changes: [], problems: [] };
    if (!norm.lastName && !norm.displayName) {
      row.status = 'fehlerhaft';
      row.problems.push('Kein Name vorhanden');
      return row;
    }
    if (!norm.bib) row.problems.push('Startnummer fehlt');
    const key = nameKey(norm.firstName, norm.lastName);

    // 1. Externe ID
    for (const e of norm.externalIds) {
      const hit = extIndex.get(`${e.ns}:${e.value}`);
      if (hit) {
        row.riderId = hit.id;
        row.status = 'zugeordnet';
        if (riderKey(hit) !== key) row.problems.push(`Name weicht vom Profil ab (${hit.displayName}) – Zuordnung über ${e.ns.toUpperCase()}-ID`);
        break;
      }
    }
    if (!row.riderId && norm.externalIds.length > 0) {
      // Namensgleiche Person mit anderer ID im selben Namensraum → widersprüchlich
      const same = byNameKey.get(key) ?? [];
      const conflicting = same.filter((r) =>
        norm.externalIds.some((e) => r.externalIds.some((re) => re.ns === e.ns && re.value !== e.value)),
      );
      const withoutId = same.filter((r) => !conflicting.includes(r) && !norm.externalIds.some((e) => r.externalIds.some((re) => re.ns === e.ns)));
      if (conflicting.length > 0) {
        row.status = 'mehrdeutig';
        row.candidates = [...conflicting, ...withoutId].map((r) => r.id);
        row.problems.push('Namensgleicher Fahrer mit anderer externer ID vorhanden – Entscheidung nötig');
      } else if (withoutId.length > 0) {
        row.status = 'mehrdeutig';
        row.candidates = withoutId.map((r) => r.id);
        row.problems.push('Namensgleicher Fahrer ohne externe ID vorhanden – bitte bestätigen');
      }
    }

    // 2. Bereits im Rennen gemeldet (gleicher Name)
    if (!row.riderId && row.status !== 'mehrdeutig') {
      const inRace = parts.filter((p) => {
        const r = riderById.get(p.riderId);
        return r && riderKey(r) === key;
      });
      if (inRace.length === 1) {
        row.riderId = inRace[0].riderId;
        row.status = 'zugeordnet';
      } else if (inRace.length > 1) {
        row.status = 'mehrdeutig';
        row.candidates = inRace.map((p) => p.riderId);
        row.problems.push('Mehrere namensgleiche Fahrer in diesem Rennen');
      }
    }

    // 3. Global namensgleich – nur mit bestätigendem Merkmal
    if (!row.riderId && row.status !== 'mehrdeutig') {
      const same = byNameKey.get(key) ?? [];
      if (same.length > 0) {
        const by = birthYear(norm.birthDate);
        const scored = same.map((r) => {
          let confirm = 0;
          let contra = 0;
          if (norm.nationality && r.nationality) (norm.nationality === r.nationality.toUpperCase() ? confirm++ : contra++);
          const rb = birthYear(r.birthDate);
          if (by && rb) (by === rb ? confirm++ : contra++);
          return { r, confirm, contra };
        });
        const plausible = scored.filter((s) => s.contra === 0);
        const confirmed = plausible.filter((s) => s.confirm > 0);
        if (confirmed.length === 1 && plausible.length === 1) {
          row.riderId = confirmed[0].r.id;
          row.status = 'zugeordnet';
        } else if (plausible.length === 0) {
          row.status = 'neu';
          row.problems.push('Namensgleiche Person mit abweichender Nationalität/Jahrgang existiert – wird als neue Person vorgeschlagen');
          row.candidates = same.map((r) => r.id);
        } else {
          row.status = 'mehrdeutig';
          row.candidates = plausible.map((s) => s.r.id);
          row.problems.push('Nur Namensgleichheit – Zuordnung bitte bestätigen');
        }
      }
    }

    // Diff gegenüber bestehender Teilnahme
    if (row.riderId) {
      const existing = parts.find((p) => p.riderId === row.riderId);
      if (existing) {
        row.existingParticipationId = existing.id;
        if (norm.bib && existing.bib !== norm.bib) row.changes.push(`Startnummer ${existing.bib} → ${norm.bib}`);
        if (norm.team && existing.teamName !== norm.team) row.changes.push(`Team ${existing.teamName} → ${norm.team}`);
        if (norm.category && (existing.category ?? '') !== norm.category) row.changes.push(`Kategorie ${existing.category ?? '–'} → ${norm.category}`);
        row.diff = row.changes.length ? 'geaendert' : 'unveraendert';
      } else row.diff = 'neu_im_rennen';
    } else if (row.status === 'neu') row.diff = 'neu_im_rennen';
    return row;
  });

  // Doppelte Startnummern innerhalb der Datei
  const seen = new Map<string, number[]>();
  rows.forEach((r) => {
    if (r.status === 'fehlerhaft' || !r.norm.bib) return;
    const k = bibKey(r.norm.bib, r.norm.category);
    seen.set(k, [...(seen.get(k) ?? []), r.index]);
  });
  for (const [, idx] of seen) {
    if (idx.length > 1) for (const i of idx) {
      rows[i].status = 'fehlerhaft';
      rows[i].problems.push(`Startnummer ${rows[i].norm.bib} mehrfach in der Datei`);
    }
  }

  const matchedIds = new Set(rows.map((r) => r.riderId).filter(Boolean));
  const notInFile = parts.filter((p) => !matchedIds.has(p.riderId));
  return { rows, notInFile };
}

export type RowDecision = { action: 'uebernehmen'; riderId: string | 'neu' } | { action: 'zurueckstellen' };

export function defaultDecision(r: MatchedRow): RowDecision {
  if (r.status === 'zugeordnet' && r.riderId) return { action: 'uebernehmen', riderId: r.riderId };
  if (r.status === 'neu') return { action: 'uebernehmen', riderId: 'neu' };
  return { action: 'zurueckstellen' };
}

/**
 * Prüft den Endzustand: Startnummern müssen im Geltungsbereich eindeutig sein,
 * und kein Fahrer darf zweimal im selben Rennen stehen.
 */
export function validateFinalState(
  rows: MatchedRow[],
  decisions: RowDecision[],
  existing: Participation[],
  bibScope: 'rennen' | 'kategorie',
): string[] {
  const errors: string[] = [];
  const final = new Map<string, { bib: string; cat: string }>(); // riderId|tempKey -> bib
  for (const p of existing.filter((p) => !p.deleted)) final.set(p.riderId, { bib: p.bib, cat: p.category ?? '' });
  rows.forEach((r, i) => {
    const d = decisions[i];
    if (d.action !== 'uebernehmen') return;
    const id = d.riderId === 'neu' ? `neu#${r.index}` : d.riderId;
    const prev = final.get(id);
    final.set(id, { bib: r.norm.bib || prev?.bib || '', cat: r.norm.category || prev?.cat || '' });
  });
  const riderTargets = new Map<string, number>();
  decisions.forEach((d) => {
    if (d.action === 'uebernehmen' && d.riderId !== 'neu') riderTargets.set(d.riderId, (riderTargets.get(d.riderId) ?? 0) + 1);
  });
  for (const [id, n] of riderTargets) if (n > 1) errors.push(`Ein Fahrer ist mehreren Zeilen zugeordnet (ID ${id.slice(0, 8)})`);
  const bibs = new Map<string, string[]>();
  for (const [id, v] of final) {
    if (!v.bib) continue;
    const k = bibScope === 'kategorie' ? `${v.cat}|${v.bib}` : v.bib;
    bibs.set(k, [...(bibs.get(k) ?? []), id]);
  }
  for (const [k, ids] of bibs) if (ids.length > 1) errors.push(`Startnummer ${k.split('|').pop()} wäre doppelt vergeben`);
  return errors;
}
