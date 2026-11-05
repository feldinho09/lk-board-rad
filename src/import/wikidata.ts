/**
 * Land und Geburtsdatum von Fahrern aus Wikidata (die strukturierte Datenbank hinter den
 * Wikipedia-Infoboxen; Daten unter CC0). Abruf direkt aus dem Browser über die offizielle
 * API (CORS mit origin=*), schonend: Stapel zu 50 Einträgen, begrenzte Parallelität, maxlag.
 *
 * Grundsätze (Bauplan 6): nichts erfinden, Quelle speichern, Unsicheres nicht automatisch
 * übernehmen. Ein Treffer gilt nur als sicher, wenn genau EIN Radsportler zum Namen passt
 * und keine vorhandene Angabe (Nation, Jahrgang) widerspricht.
 */
import type { Rider } from '../domain/types';
import { normalize } from '../domain/text';

const API = 'https://www.wikidata.org/w/api.php';

/** Beschreibungen, die einen Radsportler kennzeichnen (de/en/fr/it/es/nl/pl/da/no/sv/…) */
const CYCLIST = /(cyclist|radrennfahrer|radsportler|radfahrer|coureur cycliste|cycliste|ciclista|wielrenner|wielrenster|kolarz|cyklist|syklist|cyklista|kerékpáros|pyöräilijä|велогонщи|bicycle racer)/i;
const OCC_SPORT_CYCLIST = 'Q2309784'; // Beruf „Radsportler“ – zusätzliches Signal

export type Fetcher = (url: string) => Promise<unknown>;

export const browserFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`Wikidata antwortet mit ${res.status}`);
  return res.json();
};

interface Claim { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }
interface Entity { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Record<string, Claim[]> }

export type LookupStatus = 'sicher' | 'mehrdeutig' | 'nicht_gefunden' | 'fehler';

export interface Candidate { qid: string; label: string; description: string; birthDate?: string; nationality?: string; nationalityAll: string[] }

export interface LookupResult {
  riderId: string;
  riderName: string;
  status: LookupStatus;
  candidates: Candidate[];
  chosen?: Candidate;
  message?: string;
  /** Felder, bei denen der Vorschlag einer vorhandenen Angabe widerspricht */
  conflicts: ('birthDate' | 'nationality')[];
}

const qs = (p: Record<string, string>) => API + '?' + new URLSearchParams({ format: 'json', origin: '*', maxlag: '5', ...p }).toString();

async function call(fetcher: Fetcher, params: Record<string, string>, tries = 3): Promise<Record<string, unknown>> {
  for (let i = 0; ; i++) {
    const r = (await fetcher(qs(params))) as Record<string, unknown>;
    const err = r.error as { code?: string; info?: string } | undefined;
    if (err?.code === 'maxlag' && i < tries) { await new Promise((res) => setTimeout(res, 2000 * (i + 1))); continue; }
    if (err) throw new Error(`Wikidata: ${err.info ?? err.code}`);
    return r;
  }
}

/** Wikidata-Zeitwert → "YYYY-MM-DD" (Tagesgenauigkeit) oder "YYYY" (gröber). Nie erfundene Tage. */
export function wdDate(v: unknown): string | undefined {
  const t = v as { time?: string; precision?: number } | undefined;
  const m = t?.time?.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  if ((t!.precision ?? 0) >= 11) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((t!.precision ?? 0) >= 9) return m[1];
  return undefined;
}

const claimValues = (e: Entity, p: string) =>
  (e.claims?.[p] ?? []).filter((c) => c.rank !== 'deprecated').map((c) => c.mainsnak?.datavalue?.value).filter((v) => v != null);
const itemIds = (e: Entity, p: string) => claimValues(e, p).map((v) => (v as { id?: string }).id).filter((x): x is string => !!x);

async function getEntities(fetcher: Fetcher, ids: string[], props: string): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call(fetcher, { action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'de|en' });
    for (const [id, e] of Object.entries((r.entities ?? {}) as Record<string, Entity>)) out.set(id, { ...e, id });
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      const i = next++;
      out[i] = await fn(items[i], i);
      onProgress?.(++done);
    }
  }));
  return out;
}

const birthYear = (s?: string) => s?.match(/\d{4}/)?.[0];

/**
 * Sucht für jeden Fahrer den Wikidata-Eintrag und liefert Vorschläge.
 * Schreibt NICHTS – Übernahme erfolgt erst nach Bestätigung in der Oberfläche.
 */
export async function lookupRiders(
  riders: Rider[],
  opts: { fetcher?: Fetcher; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<LookupResult[]> {
  const fetcher = opts.fetcher ?? browserFetcher;
  const total = riders.length * 2;

  // 1. Kandidaten je Fahrer (vorhandene Wikidata-ID hat Vorrang vor der Namenssuche)
  const candidateIds = await pool(riders, 4, async (r) => {
    const known = r.externalIds.find((e) => e.ns === 'wikidata')?.value;
    if (known) return [known];
    const name = `${r.firstName} ${r.lastName}`.trim() || r.displayName;
    const res = await call(fetcher, { action: 'wbsearchentities', search: name, language: 'en', uselang: 'de', type: 'item', limit: '7' });
    const hits = (res.search ?? []) as { id: string; label?: string; description?: string; match?: { text?: string } }[];
    // Name muss passen (akzentunabhängig, über Label oder Alias)
    const want = normalize(name);
    return hits.filter((h) => normalize(h.label ?? '') === want || normalize(h.match?.text ?? '') === want).map((h) => h.id);
  }, (d) => opts.onProgress?.(d, total), opts.signal);

  // 2. Einträge in Stapeln laden, dann Länder (für IOC-/ISO-Kürzel)
  const allIds = [...new Set(candidateIds.flat())];
  const ents = await getEntities(fetcher, allIds, 'claims|labels|descriptions');
  opts.onProgress?.(Math.round(total * 0.75), total);
  const countryIds = new Set<string>();
  for (const e of ents.values()) for (const p of ['P1532', 'P27']) for (const id of itemIds(e, p)) countryIds.add(id);
  const countries = await getEntities(fetcher, [...countryIds], 'claims|labels');
  const countryCode = (qid: string) => {
    const c = countries.get(qid);
    if (!c) return qid;
    const ioc = claimValues(c, 'P984')[0] as string | undefined; // IOC-Code, im Radsport üblich (SUI, GER, SLO)
    const iso = claimValues(c, 'P298')[0] as string | undefined; // ISO 3166-1 alpha-3 als Ersatz
    return (ioc ?? iso ?? c.labels?.de?.value ?? c.labels?.en?.value ?? qid).toUpperCase();
  };
  opts.onProgress?.(total, total);

  // 3. Bewerten
  return riders.map((r, i) => {
    const cands: Candidate[] = candidateIds[i].map((q) => ents.get(q)).filter((e): e is Entity => !!e).map((e) => {
      const desc = e.descriptions?.de?.value ?? e.descriptions?.en?.value ?? '';
      const sport = itemIds(e, 'P1532').map(countryCode);
      const citizen = itemIds(e, 'P27').map(countryCode);
      const all = [...new Set([...sport, ...citizen])];
      return {
        qid: e.id,
        label: e.labels?.de?.value ?? e.labels?.en?.value ?? e.id,
        description: desc,
        birthDate: wdDate(claimValues(e, 'P569')[0]),
        // Sportnation zuerst; sonst Staatsbürgerschaft nur, wenn eindeutig
        nationality: sport.length === 1 ? sport[0] : sport.length === 0 && citizen.length === 1 ? citizen[0] : undefined,
        nationalityAll: all,
        _cyclist: CYCLIST.test(`${e.descriptions?.de?.value ?? ''} ${e.descriptions?.en?.value ?? ''}`) || itemIds(e, 'P106').includes(OCC_SPORT_CYCLIST),
      } as Candidate & { _cyclist: boolean };
    }).filter((c) => (c as Candidate & { _cyclist: boolean })._cyclist || r.externalIds.some((x) => x.ns === 'wikidata' && x.value === c.qid));

    // Widersprüche mit vorhandenen Angaben schließen Kandidaten aus (wie beim Startlistenabgleich)
    const plausible = cands.filter((c) =>
      !(r.nationality && c.nationalityAll.length && !c.nationalityAll.includes(r.nationality.toUpperCase())) &&
      !(birthYear(r.birthDate) && birthYear(c.birthDate) && birthYear(r.birthDate) !== birthYear(c.birthDate)));
    const base: LookupResult = { riderId: r.id, riderName: r.displayName, status: 'nicht_gefunden', candidates: cands, conflicts: [] };
    if (cands.length === 0) return { ...base, message: 'Kein Radsportler mit diesem Namen auf Wikidata' };
    if (plausible.length !== 1) {
      return { ...base, status: 'mehrdeutig', message: plausible.length === 0 ? 'Gefundene Einträge widersprechen Nation oder Jahrgang im Profil' : `${plausible.length} Radsportler mit diesem Namen` };
    }
    const chosen = plausible[0];
    const conflicts: LookupResult['conflicts'] = [];
    if (r.birthDate && chosen.birthDate && r.birthDate !== chosen.birthDate && !(r.birthDate.length === 4 && chosen.birthDate.startsWith(r.birthDate))) conflicts.push('birthDate');
    if (r.nationality && chosen.nationality && r.nationality.toUpperCase() !== chosen.nationality) conflicts.push('nationality');
    return { ...base, status: 'sicher', chosen, conflicts };
  });
}

/** Neue Profilwerte: füllt standardmäßig nur LEERE Felder; Überschreiben nur ausdrücklich. */
export function applyLookup(r: Rider, c: Candidate, overwrite: boolean, today = new Date().toISOString().slice(0, 10)): Rider {
  const next: Rider = { ...r, externalIds: [...r.externalIds] };
  const better = (old: string | undefined, neu: string | undefined) =>
    neu && (overwrite || !old || (old.length === 4 && neu.length === 10 && neu.startsWith(old))) ? neu : old;
  next.birthDate = better(r.birthDate, c.birthDate);
  next.nationality = better(r.nationality, c.nationality);
  if (!next.externalIds.some((e) => e.ns === 'wikidata')) next.externalIds.push({ ns: 'wikidata', value: c.qid });
  const src = `Wikidata ${c.qid} (abgerufen ${today})`;
  next.sources = r.sources ? (r.sources.includes(c.qid) ? r.sources.replace(/Wikidata Q\d+ \(abgerufen [\d-]+\)/, src) : `${r.sources}; ${src}`) : src;
  return next;
}
