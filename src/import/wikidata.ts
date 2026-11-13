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
import { plainToHtml } from '../domain/richtext';

const API = 'https://www.wikidata.org/w/api.php';

/** Beschreibungen, die einen Radsportler kennzeichnen (de/en/fr/it/es/nl/pl/da/no/sv/…) */
const CYCLIST = /(cyclist|radrennfahrer|radsportler|radfahrer|coureur cycliste|cycliste|ciclista|wielrenner|wielrenster|kolarz|cyklist|syklist|cyklista|kerékpáros|pyöräilijä|велогонщи|bicycle racer)/i;
const OCC_SPORT_CYCLIST = 'Q2309784'; // Beruf „Radsportler“ – zusätzliches Signal

export type Fetcher = (url: string) => Promise<unknown>;

/** Abruf mit schonender Wiederholung, wenn Wikimedia bremst (429/503 oder „maxlag“). */
export const browserFetcher: Fetcher = async (url) => {
  const host = new URL(url).hostname.includes('wikipedia') ? 'Wikipedia' : 'Wikidata';
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const busy = res.status === 429 || res.status === 503;
    const body = busy ? null : await res.json().catch(() => null);
    const lag = (body as { error?: { code?: string } } | null)?.error?.code === 'maxlag';
    if ((busy || lag) && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt * 2;
      await new Promise((r) => setTimeout(r, Math.min(wait, 20) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${host} antwortet mit ${res.status}${busy ? ' (zu viele Anfragen – bitte später nochmals)' : ''}`);
    if (body == null) throw new Error(`${host}: unerwartete Antwort`);
    return body;
  }
};

interface Claim { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }
interface Entity { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Record<string, Claim[]>; sitelinks?: Record<string, { title: string }> }

export type LookupStatus = 'sicher' | 'mehrdeutig' | 'nicht_gefunden' | 'fehler';

export interface Candidate {
  qid: string; label: string; description: string; birthDate?: string; nationality?: string; nationalityAll: string[];
  heightCm?: number; weightKg?: number; residence?: string; pcsId?: string;
  /** Wikipedia-Artikel (deutsch bevorzugt, sonst englisch) */
  wiki?: { lang: 'de' | 'en'; title: string };
  /** Einleitung des Artikels als Klartext (gekürzt) */
  intro?: string;
}

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
    const r = await call(fetcher, { action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'de|en', ...(props.includes('sitelinks') ? { sitefilter: 'dewiki|enwiki' } : {}) });
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

// Einheiten in Wikidata
const U_M = 'Q11573', U_CM = 'Q174728', U_KG = 'Q11570';
/** Grösse in cm bzw. Gewicht in kg aus einer Wikidata-Mengenangabe; unbekannte Einheiten → undefined */
export function wdQuantity(v: unknown, kind: 'height' | 'weight'): number | undefined {
  const q = v as { amount?: string; unit?: string } | undefined;
  const n = Number(q?.amount);
  const unit = q?.unit?.split('/').pop();
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (kind === 'height') {
    const cm = unit === U_M ? n * 100 : unit === U_CM ? n : undefined;
    return cm && cm > 120 && cm < 230 ? Math.round(cm) : undefined;
  }
  return unit === U_KG && n > 30 && n < 150 ? Math.round(n * 10) / 10 : undefined;
}

/** Einleitung eines Wikipedia-Artikels: erster Absatz, höchstens ~700 Zeichen, an Satzende gekürzt. */
export function shortIntro(text: string | undefined, max = 700): string | undefined {
  let first = (text ?? '').split(/\n+/).map((x) => x.trim()).find((x) => x.length > 40);
  if (!first) return undefined;
  // Lautschrift am Anfang weglassen: „([taˈdɛ́ːj …] , * 21. …)“ → „(* 21. …)“
  first = first.replace(/\(\s*\[[^\]]*\]\s*[,;]?\s*/, '(').replace(/\(\s*\)\s*/, '').replace(/\s+,/g, ',');
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\u00a0'));
  return end > 200 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + ' …';
}

/** Artikeleinleitungen in Stapeln zu 20 (Grenze der Wikipedia-API für Einleitungen). */
async function fetchIntros(fetcher: Fetcher, lang: 'de' | 'en', titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20', redirects: '1', titles: batch.join('|'), format: 'json', origin: '*', maxlag: '5',
    }).toString();
    const r = (await fetcher(url)) as { query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: Record<string, { title: string; extract?: string }> } };
    const q = r.query ?? {};
    const byTitle = new Map(Object.values(q.pages ?? {}).map((pg) => [pg.title, pg.extract]));
    for (const t of batch) {
      let cur = t;
      for (const m of [...(q.normalized ?? []), ...(q.redirects ?? [])]) if (m.from === cur) cur = m.to;
      const ex = shortIntro(byTitle.get(cur));
      if (ex) out.set(t, ex);
    }
  }
  return out;
}

/**
 * Sucht für jeden Fahrer den Wikidata-Eintrag und liefert Vorschläge.
 * Schreibt NICHTS – Übernahme erfolgt erst nach Bestätigung in der Oberfläche.
 */
export async function lookupRiders(
  riders: Rider[],
  opts: { fetcher?: Fetcher; onProgress?: (done: number, total: number) => void; signal?: AbortSignal; /** Kurzbio, Grösse/Gewicht/Wohnort, PCS-Kennung */ extras?: boolean; concurrency?: number } = {},
): Promise<LookupResult[]> {
  const fetcher = opts.fetcher ?? browserFetcher;
  const total = riders.length * 2;

  // 1. Kandidaten je Fahrer (vorhandene Wikidata-ID hat Vorrang vor der Namenssuche)
  const candidateIds = await pool(riders, opts.concurrency ?? 4, async (r) => {
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
  const ents = await getEntities(fetcher, allIds, opts.extras ? 'claims|labels|descriptions|sitelinks' : 'claims|labels|descriptions');
  opts.onProgress?.(Math.round(total * 0.75), total);
  const countryIds = new Set<string>();
  for (const e of ents.values()) for (const p of ['P1532', 'P27', ...(opts.extras ? ['P551'] : [])]) for (const id of itemIds(e, p)) countryIds.add(id);
  const countries = await getEntities(fetcher, [...countryIds], 'claims|labels');
  const countryCode = (qid: string) => {
    const c = countries.get(qid);
    if (!c) return qid;
    const ioc = claimValues(c, 'P984')[0] as string | undefined; // IOC-Code, im Radsport üblich (SUI, GER, SLO)
    const iso = claimValues(c, 'P298')[0] as string | undefined; // ISO 3166-1 alpha-3 als Ersatz
    return (ioc ?? iso ?? c.labels?.de?.value ?? c.labels?.en?.value ?? qid).toUpperCase();
  };
  const placeName = (qid: string) => countries.get(qid)?.labels?.de?.value ?? countries.get(qid)?.labels?.en?.value;

  // Wikipedia-Einleitungen (nur mit extras): deutsch bevorzugt, sonst englisch
  const intros = new Map<string, { lang: 'de' | 'en'; title: string; intro?: string }>();
  if (opts.extras) {
    for (const e of ents.values()) {
      const de = e.sitelinks?.dewiki?.title, en = e.sitelinks?.enwiki?.title;
      if (de) intros.set(e.id, { lang: 'de', title: de });
      else if (en) intros.set(e.id, { lang: 'en', title: en });
    }
    for (const lang of ['de', 'en'] as const) {
      const list = [...intros.values()].filter((x) => x.lang === lang);
      const got = await fetchIntros(fetcher, lang, [...new Set(list.map((x) => x.title))]);
      for (const x of list) x.intro = got.get(x.title);
    }
  }
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
        ...(opts.extras ? {
          heightCm: wdQuantity(claimValues(e, 'P2048')[0], 'height'),
          weightKg: wdQuantity(claimValues(e, 'P2067')[0], 'weight'),
          residence: itemIds(e, 'P551').map(placeName).find(Boolean),
          // nur echte Seitenkennung („tadej-pogacar“), keine Nummern
          pcsId: [claimValues(e, 'P1663')[0]].find((v): v is string => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(v)),
          wiki: intros.get(e.id) ? { lang: intros.get(e.id)!.lang, title: intros.get(e.id)!.title } : undefined,
          intro: intros.get(e.id)?.intro,
        } : {}),
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

export interface ApplyFields { bio?: boolean; physical?: boolean }

/** Neue Profilwerte: füllt standardmäßig nur LEERE Felder; Überschreiben nur ausdrücklich (gilt nur für Land/Datum). */
export function applyLookup(r: Rider, c: Candidate, overwrite: boolean, today = new Date().toISOString().slice(0, 10), fields: ApplyFields = {}): Rider {
  const next: Rider = { ...r, externalIds: [...r.externalIds] };
  const better = (old: string | undefined, neu: string | undefined) =>
    neu && (overwrite || !old || (old.length === 4 && neu.length === 10 && neu.startsWith(old))) ? neu : old;
  next.birthDate = better(r.birthDate, c.birthDate);
  next.nationality = better(r.nationality, c.nationality);
  if (fields.physical) {
    if (!r.heightCm && c.heightCm) next.heightCm = c.heightCm;
    if (!r.weightKg && c.weightKg) next.weightKg = c.weightKg;
    if (!r.residence && c.residence) next.residence = c.residence;
  }
  // Kurzbio nur in ein leeres Feld – eigene Texte werden nie ersetzt
  if (fields.bio && c.intro && !(r.bio ?? '').replace(/<[^>]*>|&nbsp;/g, '').trim()) next.bio = plainToHtml(c.intro);
  if (!next.externalIds.some((e) => e.ns === 'wikidata')) next.externalIds.push({ ns: 'wikidata', value: c.qid });
  if (c.pcsId && !next.externalIds.some((e) => e.ns === 'pcs')) next.externalIds.push({ ns: 'pcs', value: c.pcsId });
  let src = `Wikidata ${c.qid} (abgerufen ${today})`;
  if (next.bio !== r.bio && c.wiki) src += `; Kurzbio: Wikipedia ${c.wiki.lang} „${c.wiki.title}“ (CC BY-SA)`;
  const old = r.sources ?? '';
  next.sources = old ? (old.includes(c.qid) ? old.replace(/Wikidata Q\d+ \(abgerufen [\d-]+\)(; Kurzbio: Wikipedia [^;]+)?/, src) : `${old}; ${src}`) : src;
  return next;
}

/** Hat die Übernahme etwas am Profil geändert? */
export function lookupChanged(a: Rider, b: Rider): boolean {
  return (['birthDate', 'nationality', 'heightCm', 'weightKg', 'residence', 'bio', 'sources'] as const).some((k) => a[k] !== b[k]) || a.externalIds.length !== b.externalIds.length;
}
