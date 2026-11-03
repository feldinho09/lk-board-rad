/**
 * Startliste über einen Link laden – direkt aus dem Browser.
 *
 * Grenze (Bauplan 10, [5] CORS): Ein Browser darf fremde Seiten nur lesen, wenn deren
 * Server das ausdrücklich erlaubt (CORS-Freigabe). Viele Veranstalter-Seiten erlauben
 * das nicht; dann bleibt nur „Datei herunterladen und hier ablegen“ oder später der
 * eigene Importserver. Es wird KEIN öffentlicher Proxy verwendet.
 * ProCyclingStats wird bewusst nicht direkt abgerufen (nur über autorisierten Zugang, 7a).
 */
import { parseDelimited } from './parse';

export type LinkResult =
  | { kind: 'pdf'; bytes: Uint8Array; name: string }
  | { kind: 'xlsx'; file: File; name: string }
  | { kind: 'tables'; matrices: Record<string, unknown[][]>; name: string };

export class LinkError extends Error {}

const MAX_BYTES = 20 * 1024 * 1024;

export function checkUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new LinkError('Das ist keine gültige Adresse (sie muss mit https:// beginnen).'); }
  if (url.protocol !== 'https:') throw new LinkError('Nur https-Adressen sind möglich.');
  if (/(^|\.)procyclingstats\.com$/i.test(url.hostname)) {
    throw new LinkError('ProCyclingStats wird nicht direkt abgerufen: Laut Bauplan nur über einen autorisierten PCS-Zugang (derzeit nicht vorhanden). Bitte die Startliste beim Veranstalter als PDF/CSV herunterladen.');
  }
  return url;
}

export async function loadFromLink(raw: string): Promise<LinkResult> {
  const url = checkUrl(raw);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new LinkError('Keine Internetverbindung. Ein Link kann nur online geladen werden – lokale Dateien funktionieren auch offline.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: ctrl.signal, referrerPolicy: 'no-referrer' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LinkError('Zeitüberschreitung beim Laden des Links (20 s).');
    throw new LinkError(
      'Diese Seite erlaubt keinen direkten Abruf aus dem Browser (fehlende CORS-Freigabe) oder ist nicht erreichbar. ' +
      'Bitte die Datei im Browser öffnen, speichern und hier hineinziehen. Automatischer Abruf solcher Links folgt mit dem Importserver.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new LinkError(`Der Server antwortet mit Fehler ${res.status}.`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new LinkError('Datei größer als 20 MB.');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new LinkError('Datei größer als 20 MB.');
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const name = decodeURIComponent(url.pathname.split('/').pop() || url.hostname);
  return classify(buf, type, name);
}

/** Inhalt anhand Signatur/Typ erkennen – nicht allein anhand der Dateiendung. */
export function classify(buf: Uint8Array, type: string, name: string): LinkResult {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 8));
  if (head.startsWith('%PDF')) return { kind: 'pdf', bytes: buf, name };
  if (head.startsWith('PK')) {
    return { kind: 'xlsx', file: new File([buf as BlobPart], name.endsWith('.xlsx') ? name : `${name}.xlsx`), name };
  }
  const text = new TextDecoder('utf-8').decode(buf);
  if (type.includes('html') || /^\s*<(!doctype|html)/i.test(text)) {
    const matrices = htmlTables(text);
    if (!Object.keys(matrices).length) throw new LinkError('Die Seite enthält keine Tabelle. Falls die Startliste als PDF verlinkt ist, bitte den PDF-Link verwenden.');
    return { kind: 'tables', matrices, name };
  }
  return { kind: 'tables', matrices: { [name]: parseDelimited(text) }, name };
}

/** HTML-Tabellen auslesen. DOMParser führt keine Skripte aus; nur Textinhalt wird übernommen. */
export function htmlTables(html: string): Record<string, unknown[][]> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Record<string, unknown[][]> = {};
  doc.querySelectorAll('table').forEach((t, i) => {
    const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()));
    if (rows.length >= 2) {
      const caption = t.querySelector('caption')?.textContent?.trim();
      out[`Tabelle ${i + 1}${caption ? ` – ${caption.slice(0, 40)}` : ''} (${rows.length - 1} Zeilen)`] = rows;
    }
  });
  return out;
}
