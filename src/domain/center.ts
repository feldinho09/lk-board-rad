/**
 * Fachlogik des Rad Command Centers (ohne Oberfläche, testbar).
 */
import { db, alive, mutate, newRecord } from '../db/db';
import type { Entry, EntryStatus, Race, RaceSectionKey, Rider, RiderSectionKey, Stage, Topic, Versioned } from './types';
import { normalize } from './text';
import { toPlain } from './richtext';

type New<T> = Omit<T, keyof Versioned>;

// ---------------------------------------------------------------- Fahrer

export const riderKey = (name: string) => normalize(name);
/** Namen unabhängig von Reihenfolge und Akzenten vergleichen („POGAČAR Tadej“ = „Tadej Pogacar“) */
export const nameMatchKey = (name: string) => normalize(name).split(' ').filter(Boolean).sort().join(' ');

/** „POGAČAR Tadej“ (PCS-Schreibweise) oder „Tadej Pogačar“ → Vor- und Nachname. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  const isUpper = (p: string) => p.replace(/ß/g, '') === p.replace(/ß/g, '').toLocaleUpperCase() && /\p{L}/u.test(p);
  if (parts.length > 1 && isUpper(parts[0])) {
    const lastParts: string[] = [];
    while (parts.length > 1 && isUpper(parts[0])) lastParts.push(parts.shift()!);
    return { firstName: parts.join(' '), lastName: lastParts.map((x, i) => capitalize(x, i)).join(' ') };
  }
  const particles = /^(van|von|de|der|den|del|della|di|da|du|le|la|ten|ter|op)$/i;
  let i = parts.length - 1;
  while (i > 1 && particles.test(parts[i - 1])) i--;
  return { firstName: parts.slice(0, i).join(' '), lastName: parts.slice(i).join(' ') };
}
/** Grossschreibung von Namensteilen; Partikel klein, ausser am Anfang („Van den Broeck“, „De la Rosa“) */
function capitalize(p: string, index: number) {
  const low = p.toLocaleLowerCase();
  if (index > 0 && /^(van|von|de|der|den|del|della|di|da|du|le|la|ten|ter)$/.test(low)) return low;
  return low.replace(/(^|[-'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
}

export async function createRider(fields: Partial<New<Rider>> & { firstName: string; lastName: string }): Promise<Rider> {
  const name = fields.name?.trim() || `${fields.firstName} ${fields.lastName}`.trim();
  const r = newRecord<New<Rider>>({ sections: {}, ...fields, name, searchKey: riderKey(name) }) as Rider;
  return mutate(['riders'], (w) => w.put('riders', r));
}

export async function updateRider(id: string, patch: Partial<New<Rider>>): Promise<Rider> {
  return mutate(['riders'], async (w) => {
    const cur = await db.riders.get(id);
    if (!cur) throw new Error('Fahrer nicht gefunden');
    const next: Rider = { ...cur, ...patch };
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      if (!patch.name) next.name = `${next.firstName} ${next.lastName}`.trim();
    }
    next.searchKey = riderKey(next.name);
    return w.put('riders', next);
  });
}

export async function saveRiderSection(id: string, key: RiderSectionKey, html: string): Promise<void> {
  const cur = await db.riders.get(id);
  if (!cur) return;
  await updateRider(id, { sections: { ...cur.sections, [key]: html }, ...(key === 'aktuell' ? { aktuellAt: new Date().toISOString() } : {}) });
}

export async function deleteRider(id: string): Promise<void> {
  await mutate(['riders', 'entries'], async (w) => {
    await w.remove('riders', id);
    // Startlisten behalten den Namen, verlieren nur die Verknüpfung
    for (const e of alive(await db.entries.where('riderId').equals(id).toArray())) await w.put('entries', { ...e, riderId: undefined });
  });
}

export const allRiders = async () => alive(await db.riders.toArray()).sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));

/** Profil zu einem Namen finden (eindeutig, akzent- und reihenfolgeunabhängig). */
export function findRiderByName(riders: Rider[], name: string): Rider | undefined {
  const k = nameMatchKey(name);
  const hits = riders.filter((r) => nameMatchKey(r.name) === k);
  return hits.length === 1 ? hits[0] : undefined;
}

// ---------------------------------------------------------------- Rennen & Etappen

export async function createRace(fields: { name: string; year: number; kind: Race['kind']; startDate?: string; stageCount?: number; pcsUrl?: string }): Promise<Race> {
  const race = newRecord<New<Race>>({ name: fields.name.trim(), year: fields.year, kind: fields.kind, startDate: fields.startDate, pcsUrl: fields.pcsUrl, sections: {} }) as Race;
  const n = fields.kind === 'eintages' ? 1 : Math.max(1, fields.stageCount ?? 1);
  await mutate(['races', 'stages'], async (w) => {
    await w.put('races', race);
    for (let i = 1; i <= n; i++) {
      const date = fields.startDate ? addDays(fields.startDate, i - 1) : undefined;
      await w.put('stages', newRecord<New<Stage>>({ raceId: race.id, number: i, date }) as Stage);
    }
  });
  return race;
}

export const addDays = (iso: string, d: number) => {
  const t = new Date(iso + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

export async function updateRace(id: string, patch: Partial<New<Race>>): Promise<Race> {
  return mutate(['races'], async (w) => {
    const cur = await db.races.get(id);
    if (!cur) throw new Error('Rennen nicht gefunden');
    return w.put('races', { ...cur, ...patch });
  });
}

export async function saveRaceSection(id: string, key: RaceSectionKey, html: string): Promise<void> {
  const cur = await db.races.get(id);
  if (cur) await updateRace(id, { sections: { ...cur.sections, [key]: html } });
}

export async function deleteRace(id: string): Promise<void> {
  await mutate(['races', 'stages', 'entries', 'routes', 'geo', 'rundown'], async (w) => {
    await w.remove('races', id);
    for (const s of alive(await db.stages.where('raceId').equals(id).toArray())) await w.remove('stages', s.id);
    for (const e of alive(await db.entries.where('raceId').equals(id).toArray())) await w.remove('entries', e.id);
    for (const t of ['routes', 'geo', 'rundown'] as const) {
      for (const x of alive(await db.table(t).toArray()) as { id: string; raceId: string; deleted?: boolean }[]) if (x.raceId === id) await w.remove(t, x.id);
    }
  });
}

export const raceStages = async (raceId: string) => alive(await db.stages.where('raceId').equals(raceId).toArray()).sort((a, b) => a.number - b.number);

export async function addStage(raceId: string): Promise<Stage> {
  const st = await raceStages(raceId);
  const last = st[st.length - 1];
  const s = newRecord<New<Stage>>({ raceId, number: (last?.number ?? 0) + 1, date: last?.date ? addDays(last.date, 1) : undefined }) as Stage;
  return mutate(['stages'], (w) => w.put('stages', s));
}

export async function updateStage(id: string, patch: Partial<New<Stage>>): Promise<Stage> {
  return mutate(['stages'], async (w) => {
    const cur = await db.stages.get(id);
    if (!cur) throw new Error('Etappe nicht gefunden');
    return w.put('stages', { ...cur, ...patch });
  });
}

export async function removeStage(id: string): Promise<void> {
  await mutate(['stages'], (w) => w.remove('stages', id));
}

// ---------------------------------------------------------------- Startliste

export const raceEntries = async (raceId: string) => alive(await db.entries.where('raceId').equals(raceId).toArray()).sort(byBib);
export function byBib(a: Entry, b: Entry) {
  const na = Number(a.bib), nb = Number(b.bib);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (a.bib && !b.bib) return -1;
  if (!a.bib && b.bib) return 1;
  return a.name.localeCompare(b.name, 'de');
}

export interface StartlistResult { added: number; updated: number; unchanged: number; linked: number; removed: number; withProfile: number }

/**
 * Startliste übernehmen (aus PCS kopiert). Bestehende Einträge werden über Startnummer bzw.
 * Namen wiedergefunden; Notizen und Status bleiben erhalten. Profile werden über den Namen
 * verknüpft. Fahrer, die nicht mehr in der Liste stehen, werden nur mit `removeMissing` entfernt.
 */
export async function applyStartlist(raceId: string, rows: { bib?: string; name: string; team?: string }[], opts: { removeMissing?: boolean } = {}): Promise<StartlistResult> {
  const riders = await allRiders();
  const existing = await raceEntries(raceId);
  const res: StartlistResult = { added: 0, updated: 0, unchanged: 0, linked: 0, removed: 0, withProfile: 0 };
  const seen = new Set<string>();
  await mutate(['entries'], async (w) => {
    for (const row of rows) {
      const name = displayName(row.name);
      const key = nameMatchKey(name);
      const cur = existing.find((e) => !seen.has(e.id) && nameMatchKey(e.name) === key) ?? existing.find((e) => !seen.has(e.id) && row.bib && e.bib === row.bib && !e.riderId);
      const profile = findRiderByName(riders, name);
      if (cur) {
        seen.add(cur.id);
        const next: Entry = { ...cur, bib: row.bib ?? cur.bib, team: row.team ?? cur.team, name: cur.name, riderId: cur.riderId ?? profile?.id };
        if (!cur.riderId && profile) res.linked++;
        if (next.bib !== cur.bib || next.team !== cur.team || next.riderId !== cur.riderId) { await w.put('entries', next); res.updated++; } else res.unchanged++;
        if (next.riderId) res.withProfile++;
      } else {
        const e = newRecord<New<Entry>>({ raceId, bib: row.bib, name, team: row.team, riderId: profile?.id, status: 'aktiv' }) as Entry;
        await w.put('entries', e);
        res.added++;
        if (profile) { res.linked++; res.withProfile++; }
        seen.add(e.id);
      }
    }
    if (opts.removeMissing) for (const e of existing) if (!seen.has(e.id)) { await w.remove('entries', e.id); res.removed++; }
  });
  return res;
}

/** „POGAČAR Tadej“ → „Tadej Pogačar“; normale Schreibweise bleibt. */
export function displayName(raw: string): string {
  const n = splitName(raw);
  return `${n.firstName} ${n.lastName}`.trim();
}

/** Profil-Fahrer ins Rennen übernehmen (wenn sie starten); vorhandene bleiben unverändert. */
export async function addRidersToRace(raceId: string, riderIds: string[]): Promise<number> {
  const existing = await raceEntries(raceId);
  const riders = (await db.riders.bulkGet(riderIds)).filter((r): r is Rider => !!r && !r.deleted);
  let n = 0;
  await mutate(['entries'], async (w) => {
    for (const r of riders) {
      const byLink = existing.find((e) => e.riderId === r.id);
      if (byLink) continue;
      const byName = existing.find((e) => !e.riderId && nameMatchKey(e.name) === nameMatchKey(r.name));
      if (byName) await w.put('entries', { ...byName, riderId: r.id });
      else await w.put('entries', newRecord<New<Entry>>({ raceId, name: r.name, team: r.team, riderId: r.id, status: 'aktiv' }) as Entry);
      n++;
    }
  });
  return n;
}

export async function updateEntry(id: string, patch: Partial<New<Entry>>): Promise<Entry> {
  return mutate(['entries'], async (w) => {
    const cur = await db.entries.get(id);
    if (!cur) throw new Error('Eintrag nicht gefunden');
    return w.put('entries', { ...cur, ...patch });
  });
}

export async function setEntryStatus(id: string, status: EntryStatus, stage?: number) {
  return updateEntry(id, { status, statusStage: status === 'aktiv' ? undefined : stage });
}

export async function removeEntry(id: string) {
  await mutate(['entries'], (w) => w.remove('entries', id));
}

/** Aus einem Startlisten-Eintrag ein Profil anlegen und verknüpfen. */
export async function profileFromEntry(entryId: string): Promise<Rider> {
  const e = await db.entries.get(entryId);
  if (!e) throw new Error('Eintrag nicht gefunden');
  const n = splitName(e.name);
  const r = await createRider({ ...n, name: e.name, team: e.team });
  await updateEntry(e.id, { riderId: r.id });
  return r;
}

/** Profile, die schon einmal in einem Rennen standen – zuletzt gefahrene zuerst (Vorschlag beim neuen Rennen). */
export async function profilesByLastRace(): Promise<{ rider: Rider; lastRace?: Race }[]> {
  const riders = await allRiders();
  const races = new Map(alive(await db.races.toArray()).map((r) => [r.id, r]));
  const entries = alive(await db.entries.toArray()).filter((e) => e.riderId);
  return riders.map((rider) => {
    const rs = entries.filter((e) => e.riderId === rider.id).map((e) => races.get(e.raceId)).filter((x): x is Race => !!x);
    rs.sort((a, b) => (b.startDate ?? String(b.year)).localeCompare(a.startDate ?? String(a.year)));
    return { rider, lastRace: rs[0] };
  });
}

// ---------------------------------------------------------------- Themen

export async function createTopic(fields: Partial<New<Topic>> & { kind: Topic['kind'] }): Promise<Topic> {
  const t = newRecord<New<Topic>>({ title: '', body: '', riderIds: [], ...fields }) as Topic;
  return mutate(['topics'], (w) => w.put('topics', t));
}
export async function updateTopic(id: string, patch: Partial<New<Topic>>): Promise<Topic> {
  return mutate(['topics'], async (w) => {
    const cur = await db.topics.get(id);
    if (!cur) throw new Error('Eintrag nicht gefunden');
    return w.put('topics', { ...cur, ...patch });
  });
}
export async function deleteTopic(id: string) {
  await mutate(['topics'], (w) => w.remove('topics', id));
}

/** Themen zu Rennen/Etappe/Fahrer – für Rennseite, Fahrerprofil und LIVE. */
export function topicsFor(topics: Topic[], f: { raceId?: string; stageNumber?: number; riderId?: string }): Topic[] {
  return topics.filter((t) => {
    if (f.riderId && !t.riderIds.includes(f.riderId)) return false;
    if (f.raceId && t.raceId && t.raceId !== f.raceId) return false;
    if (f.raceId && !f.riderId && t.raceId !== f.raceId) return false;
    if (f.stageNumber != null && t.stageNumber != null && t.stageNumber !== f.stageNumber) return false;
    return true;
  }).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt.localeCompare(a.updatedAt));
}

// ---------------------------------------------------------------- Suche

export interface Hit { kind: 'rider' | 'race' | 'topic'; id: string; title: string; sub?: string; score: number }

/** Volltextsuche über Fahrer (Name, Team, Texte), Rennen und Themen – akzentunabhängig. */
export async function searchAll(q: string, limit = 30): Promise<Hit[]> {
  const terms = normalize(q).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const has = (hay: string) => terms.every((t) => hay.includes(t));
  const hits: Hit[] = [];
  for (const r of alive(await db.riders.toArray())) {
    const head = normalize(`${r.name} ${r.team ?? ''} ${r.nation ?? ''}`);
    const body = normalize(Object.values(r.sections).map((v) => toPlain(v)).join(' '));
    if (has(head)) hits.push({ kind: 'rider', id: r.id, title: r.name, sub: [r.nation, r.team].filter(Boolean).join(' · '), score: head.startsWith(terms[0]) || normalize(r.lastName).startsWith(terms[0]) ? 3 : 2 });
    else if (has(head + ' ' + body)) hits.push({ kind: 'rider', id: r.id, title: r.name, sub: 'Treffer im Profil', score: 1 });
  }
  for (const r of alive(await db.races.toArray())) {
    if (has(normalize(`${r.name} ${r.year}`))) hits.push({ kind: 'race', id: r.id, title: `${r.name} ${r.year}`, sub: 'Rennen', score: 2 });
  }
  for (const t of alive(await db.topics.toArray())) {
    if (has(normalize(`${t.title} ${toPlain(t.body)} ${t.source ?? ''}`))) hits.push({ kind: 'topic', id: t.id, title: t.title || toPlain(t.body).slice(0, 60), sub: t.kind, score: 1 });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de')).slice(0, limit);
}

// ---------------------------------------------------------------- Hilfen

export function ageOn(birth: string | undefined, onDate: string): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const b = new Date(birth + 'T00:00:00Z'), d = new Date(onDate + 'T00:00:00Z');
  let a = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

export function daysSince(iso: string | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400_000);
}

export const PCS = 'https://www.procyclingstats.com';
export const pcsRiderUrl = (r: Pick<Rider, 'pcsSlug' | 'name'>) =>
  r.pcsSlug ? `${PCS}/rider/${encodeURIComponent(r.pcsSlug)}` : `${PCS}/search.php?term=${encodeURIComponent(r.name)}`;
export const pcsRaceUrl = (r: Pick<Race, 'pcsUrl' | 'name' | 'year'>) => r.pcsUrl || `${PCS}/search.php?term=${encodeURIComponent(r.name)}`;
/** Aus einer eingefügten PCS-Adresse die Fahrerkennung lesen */
export const pcsSlugFrom = (v: string) => v.trim().match(/procyclingstats\.com\/rider\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? (/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
