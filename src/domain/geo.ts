/**
 * Geographisches: Strecke aus GPX, Orte und Sehenswürdigkeiten entlang der Strecke aus
 * Wikipedia (Geosuche), sortiert nach km to go. Reine Logik + Abruf (Fetcher austauschbar).
 */
import type { GeoKind, GeoPoint, Route } from './types';

export type RoutePoint = Route['points'][number];

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GPX (trk/rte) lesen, Distanz aufsummieren, auf ca. alle `stepKm` ausdünnen. */
export function parseGpx(xml: string, stepKm = 0.1): { points: RoutePoint[]; lengthKm: number; name?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges GPX (XML-Fehler).');
  let pts = [...doc.getElementsByTagName('trkpt')];
  if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
  if (pts.length < 2) throw new Error('Im GPX wurde keine Strecke gefunden (keine trkpt/rtept-Punkte).');
  const raw = pts.map((p) => {
    const ele = p.getElementsByTagName('ele')[0]?.textContent;
    return [Number(p.getAttribute('lat')), Number(p.getAttribute('lon')), ele != null && ele !== '' ? Number(ele) : null] as [number, number, number | null];
  }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const out: RoutePoint[] = [];
  let km = 0, sinceLast = Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) { const d = haversineKm([raw[i - 1][0], raw[i - 1][1]], [raw[i][0], raw[i][1]]); km += d; sinceLast += d; }
    if (sinceLast >= stepKm || i === raw.length - 1) { out.push([round(raw[i][0], 5), round(raw[i][1], 5), raw[i][2] != null ? Math.round(raw[i][2]!) : null, round(km, 3)]); sinceLast = 0; }
  }
  const name = doc.getElementsByTagName('name')[0]?.textContent?.trim() || undefined;
  return { points: out, lengthKm: round(km, 1), name };
}
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Nächster Streckenpunkt zu einer Koordinate: km ab Start und Abstand in m. */
export function projectOnRoute(points: RoutePoint[], lat: number, lon: number): { km: number; offsetM: number } {
  let best = { km: 0, offsetM: Infinity };
  // grobe Suche, dann Feinschritt zwischen Nachbarpunkten
  for (let i = 0; i < points.length; i++) {
    const d = haversineKm([lat, lon], [points[i][0], points[i][1]]) * 1000;
    if (d < best.offsetM) best = { km: points[i][3], offsetM: d };
  }
  return { km: round(best.km, 1), offsetM: Math.round(best.offsetM) };
}

/** Abfragepunkte entlang der Strecke (alle `everyKm`), inkl. Start und Ziel. */
export function samplePoints(points: RoutePoint[], everyKm: number): RoutePoint[] {
  const out: RoutePoint[] = [];
  let next = 0;
  for (const p of points) if (p[3] >= next) { out.push(p); next = p[3] + everyKm; }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// ------------------------------------------------------------------ Einordnung

const ORT = /\b(gemeinde|stadt|kleinstadt|großstadt|grossstadt|dorf|ortschaft|ortsteil|weiler|kommune|hauptort|marktgemeinde|fraktion|stadtteil|commune|ville|village|municipality|town|comune|municipio|frazione)\b/i;
const NATUR = /\b(berg|gipfel|pass|passhöhe|col|see|stausee|fluss|bach|nebenfluss|wasserfall|schlucht|tal|gletscher|insel|höhle|naturschutzgebiet|nationalpark|naturpark|massiv|bergkette|hügel|klamm|mountain|lake|river|lac|rivière|fiume|lago|monte)\b/i;
const SIGHT = /\b(kirche|kirchengebäude|kathedrale|dom|münster|basilika|kapelle|kloster|abtei|stift|burg|burgruine|ruine|schloss|festung|zitadelle|palast|museum|denkmal|monument|brücke|viadukt|aquädukt|turm|leuchtturm|stadion|rennstrecke|amphitheater|theater|wallfahrts\w*|unesco|welterbe|altstadt|marktplatz|platz|park|garten|château|église|abbaye|cathédrale|pont|castello|chiesa|cathedral|castle|bridge|abbey)\b/i;
const NOISE = /\b(unternehmen|bank|kreditinstitut|hotel|restaurant|schule|gymnasium|universität|hochschule|bahnhof|haltestelle|flughafen|straße|strasse|autobahn|bahnstrecke|person|politiker|sportler|verein|club|fußballverein|partei|zeitung|organisation|krankenhaus|spital|gefängnis|kraftwerk|fabrik|einkaufszentrum|wahlkreis|bezirk|kanton|département|region|landkreis)\b/i;

export interface WikiHit { title: string; lat: number; lon: number; description?: string; categories: string[] }

/** Wikipedia-Artikel einordnen: Ort, Sehenswürdigkeit, Natur – oder null (nicht relevant). Mit Gewicht für die Auswahl. */
export function classify(h: WikiHit): { kind: GeoKind; weight: number } | null {
  const d = h.description ?? '';
  const cats = h.categories.join(' | ');
  const text = `${d} | ${cats}`;
  const unesco = /welterbe|unesco/i.test(text) ? 4 : 0;
  const kultur = /kulturgut von nationaler|monument historique|nationales denkmal|kulturdenkmal/i.test(text) ? 2 : 0;
  if ((ORT.test(d) || /\b(ort im|ort in|gemeinde (im|in)|commune (in|im)|ort an)\b/i.test(cats)) && !/\b(ortsteil|stadtteil|quartier)\b/i.test(d)) return { kind: 'ort', weight: 10 + unesco };
  if (NOISE.test(d) && !unesco && !kultur) return null;
  if (NATUR.test(d) || /\b(berg in|pass in|see in|fluss in|gewässer|geographie)\b/i.test(cats)) return { kind: 'natur', weight: 3 + unesco };
  if (SIGHT.test(d) || SIGHT.test(cats) || unesco || kultur) return { kind: 'sehenswuerdigkeit', weight: 2 + unesco + kultur + (/kirche|kathedrale|burg|schloss|kloster|abtei|brücke|festung/i.test(d) ? 1 : 0) };
  return null;
}

/** „Cully VD“ → „Cully“, „Villette (Lavaux)“ → „Villette“ */
export const placeName = (title: string) => title.replace(/\s*\([^)]*\)$/, '').replace(/\s+(AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)$/, '');

/** km to go aus km ab Start */
export const kmToGo = (lengthKm: number, km: number) => Math.max(0, Math.round((lengthKm - km) * 10) / 10);

// ------------------------------------------------------------------ Abruf

export type Fetcher = (url: string) => Promise<unknown>;

/** Browser-Abruf mit Wiederholung, wenn Wikimedia bremst. */
export const wikiFetcher: Fetcher = async (url) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Wikipedia antwortet mit ${res.status}${res.status === 429 ? ' (zu viele Anfragen – bitte später nochmals)' : ''}`);
    return res.json();
  }
};

const api = (lang: string, params: Record<string, string>) =>
  `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params }).toString();

interface ApiPage { title: string; coordinates?: { lat: number; lon: number }[]; description?: string; categories?: { title: string }[]; extract?: string; missing?: boolean }

export interface FoundPlace {
  kind: GeoKind; name: string; km: number; offsetM: number; lat: number; lon: number; wikiTitle: string; description?: string; summary?: string; weight: number;
}

export interface GeoSearchOptions {
  lang?: string;
  /** Orte bis so weit neben der Strecke (m) – „Durchfahrt“ */
  ortMaxM?: number;
  /** Sehenswürdigkeiten/Natur bis so weit neben der Strecke (m) */
  sightMaxM?: number;
  /** höchstens so viele Sehenswürdigkeiten pro 10 km (die wichtigsten) */
  sightsPer10Km?: number;
  fetcher?: Fetcher;
  onProgress?: (done: number, total: number, phase: string) => void;
  pauseMs?: number;
}

/**
 * Orte und Sehenswürdigkeiten entlang der Strecke aus Wikipedia (Geosuche alle ~4 km,
 * Radius 5 km), eingeordnet, nach km sortiert, mit Kurzfassung (2 Sätze).
 */
export async function findAlongRoute(points: RoutePoint[], o: GeoSearchOptions = {}): Promise<FoundPlace[]> {
  const lang = o.lang ?? 'de';
  const f = o.fetcher ?? wikiFetcher;
  const ortMax = o.ortMaxM ?? 1500, sightMax = o.sightMaxM ?? 3000, per10 = o.sightsPer10Km ?? 3;
  const pause = o.pauseMs ?? 250;
  const sample = samplePoints(points, 4);
  const hits = new Map<string, WikiHit>();
  for (const [i, p] of sample.entries()) {
    o.onProgress?.(i, sample.length, 'Strecke absuchen');
    let cont: Record<string, string> = {};
    for (let page = 0; page < 3; page++) {
      const r = (await f(api(lang, { action: 'query', generator: 'geosearch', ggscoord: `${p[0]}|${p[1]}`, ggsradius: '5000', ggslimit: '100', prop: 'coordinates|description|categories', clshow: '!hidden', cllimit: 'max', ...cont }))) as { query?: { pages?: ApiPage[] }; continue?: Record<string, string> };
      for (const pg of r.query?.pages ?? []) {
        const c = pg.coordinates?.[0];
        if (!c) continue;
        const prev = hits.get(pg.title);
        const cats = (pg.categories ?? []).map((x) => x.title.replace(/^[^:]+:/, ''));
        hits.set(pg.title, { title: pg.title, lat: c.lat, lon: c.lon, description: pg.description ?? prev?.description, categories: [...new Set([...(prev?.categories ?? []), ...cats])] });
      }
      if (!r.continue) break;
      cont = r.continue;
    }
    if (pause) await new Promise((res) => setTimeout(res, pause));
  }
  o.onProgress?.(sample.length, sample.length, 'Strecke absuchen');

  const found: FoundPlace[] = [];
  for (const h of hits.values()) {
    const c = classify(h);
    if (!c) continue;
    const { km, offsetM } = projectOnRoute(points, h.lat, h.lon);
    if (offsetM > (c.kind === 'ort' ? ortMax : sightMax)) continue;
    found.push({ kind: c.kind, name: placeName(h.title), km, offsetM, lat: h.lat, lon: h.lon, wikiTitle: h.title, description: h.description, weight: c.weight });
  }
  // Sehenswürdigkeiten/Natur: je 10-km-Abschnitt nur die wichtigsten (nahe an der Strecke bevorzugt)
  const keep: FoundPlace[] = found.filter((x) => x.kind === 'ort');
  const buckets = new Map<number, FoundPlace[]>();
  for (const x of found.filter((y) => y.kind !== 'ort')) buckets.set(Math.floor(x.km / 10), [...(buckets.get(Math.floor(x.km / 10)) ?? []), x]);
  for (const list of buckets.values()) keep.push(...list.sort((a, b) => b.weight - a.weight || a.offsetM - b.offsetM).slice(0, per10));
  keep.sort((a, b) => a.km - b.km);

  // Kurzfassungen (2 Sätze) in Stapeln zu 20
  const titles = keep.map((x) => x.wikiTitle);
  for (let i = 0; i < titles.length; i += 20) {
    o.onProgress?.(i, titles.length, 'Kurzfassungen holen');
    const r = (await f(api(lang, { action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '2', exlimit: '20', titles: titles.slice(i, i + 20).join('|') }))) as { query?: { pages?: ApiPage[] } };
    for (const pg of r.query?.pages ?? []) {
      const x = keep.find((k) => k.wikiTitle === pg.title);
      if (x && pg.extract) x.summary = cleanExtract(pg.extract);
    }
    if (pause) await new Promise((res) => setTimeout(res, pause));
  }
  return keep;
}

/** Kurzfassung für einen einzelnen Ort/Artikel (z. B. eigener Punkt „Wikipedia holen“). */
export async function fetchSummary(title: string, lang = 'de', f: Fetcher = wikiFetcher): Promise<{ title: string; summary?: string; description?: string; lat?: number; lon?: number } | null> {
  const r = (await f(api(lang, { action: 'query', prop: 'extracts|description|coordinates', exintro: '1', explaintext: '1', exsentences: '3', redirects: '1', titles: title }))) as { query?: { pages?: ApiPage[] } };
  const pg = r.query?.pages?.[0];
  if (!pg || pg.missing) return null;
  return { title: pg.title, summary: pg.extract ? cleanExtract(pg.extract) : undefined, description: pg.description, lat: pg.coordinates?.[0]?.lat, lon: pg.coordinates?.[0]?.lon };
}

/** Lautschrift und leere Klammern entfernen. */
export function cleanExtract(t: string): string {
  return t.replace(/\s*\[[^\]]{1,80}\]/g, '').replace(/\(\s*[,;]\s*/g, '(').replace(/\(\s*\)\s*/g, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

/** Neue Funde mit bestehenden Punkten zusammenführen: nichts doppelt, Ausgeblendetes bleibt aus, eigene Notizen bleiben. */
export function mergeFound(existing: GeoPoint[], found: FoundPlace[]): { add: FoundPlace[]; update: { id: string; patch: Partial<GeoPoint> }[] } {
  const add: FoundPlace[] = [];
  const update: { id: string; patch: Partial<GeoPoint> }[] = [];
  for (const x of found) {
    const cur = existing.find((e) => e.wikiTitle === x.wikiTitle);
    if (!cur) { add.push(x); continue; }
    const patch: Partial<GeoPoint> = {};
    if (cur.km !== x.km) patch.km = x.km;
    if (!cur.summary && x.summary) patch.summary = x.summary;
    if (Object.keys(patch).length) update.push({ id: cur.id, patch });
  }
  return { add, update };
}

/** Höhenmeter-Summe und Höchstpunkt einer Strecke (für die Übersicht). */
export function climbStats(points: RoutePoint[]): { up: number; max: number | null; min: number | null } {
  let up = 0, max: number | null = null, min: number | null = null, prev: number | null = null;
  for (const p of points) {
    const e = p[2];
    if (e == null) continue;
    if (prev != null && e > prev) up += e - prev;
    prev = e;
    max = max == null ? e : Math.max(max, e);
    min = min == null ? e : Math.min(min, e);
  }
  return { up: Math.round(up), max, min };
}
