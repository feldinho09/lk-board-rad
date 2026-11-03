/**
 * Startlisten aus PDF (Bauplan 7: „PDF … muss eine kontrollierbare Tabellenzwischenstufe erzeugen“).
 *
 * Reine Funktionen auf Textpositionen – keine OCR, keine KI. Der Text selbst wird
 * exakt aus der PDF-Textebene übernommen; nur die ZUORDNUNG zu Zeilen/Spalten/Teams
 * ist eine Heuristik. Deshalb landet das Ergebnis immer in einer bearbeitbaren
 * Tabelle, die vor dem Abgleich ausdrücklich bestätigt werden muss.
 */

export interface PdfTextItem {
  page: number;
  str: string;
  x: number; // links, PDF-Punkte
  y: number; // Grundlinie, PDF-Punkte (wächst nach oben)
  w: number;
  h: number; // Schriftgröße (ungefähr)
  bold?: boolean;
}

export interface Segment { x0: number; x1: number; text: string; bold: boolean; h: number }
export interface PdfLine { page: number; y: number; segments: Segment[] }

/** Textstücke zu Zeilen (gleiche Grundlinie) und Zeilen zu Segmenten (Lücke = neue Spalte). */
export function toLines(items: PdfTextItem[]): PdfLine[] {
  const usable = items.filter((i) => i.str.trim() !== '');
  const byPage = new Map<number, PdfTextItem[]>();
  for (const i of usable) byPage.set(i.page, [...(byPage.get(i.page) ?? []), i]);
  const lines: PdfLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfTextItem[][] = [];
    for (const it of its) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, Math.min(r[0].h, it.h) * 0.45));
      if (row) row.push(it); else rows.push([it]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const segs: Segment[] = [];
      for (const it of row) {
        const last = segs[segs.length - 1];
        const charW = it.str.length ? it.w / it.str.length : it.h * 0.5;
        const gap = last ? it.x - last.x1 : Infinity;
        // Lücke größer als ~2 Zeichen = neue Spalte
        if (last && gap < Math.max(charW * 2.2, it.h * 0.9)) {
          last.text += (gap > charW * 0.25 && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          last.x1 = Math.max(last.x1, it.x + it.w);
          last.bold = last.bold && !!it.bold;
        } else segs.push({ x0: it.x, x1: it.x + it.w, text: it.str, bold: !!it.bold, h: it.h });
      }
      for (const s of segs) s.text = s.text.replace(/\s+/g, ' ').trim();
      lines.push({ page, y: row[0].y, segments: segs.filter((s) => s.text) });
    }
  }
  return lines;
}

/** Modus „Tabelle“: Spalten anhand der Segment-Startpositionen der breitesten Zeilen. */
export function linesToTable(lines: PdfLine[]): string[][] {
  if (!lines.length) return [];
  const maxSegs = Math.max(...lines.map((l) => l.segments.length));
  const ref = lines.filter((l) => l.segments.length === maxSegs);
  const cols: number[] = [];
  for (let c = 0; c < maxSegs; c++) cols.push(ref.reduce((a, l) => a + l.segments[c].x0, 0) / ref.length);
  return lines.map((l) => {
    const row = new Array<string>(cols.length).fill('');
    for (const s of l.segments) {
      let best = 0;
      for (let c = 1; c < cols.length; c++) if (Math.abs(cols[c] - s.x0) < Math.abs(cols[best] - s.x0)) best = c;
      row[best] = row[best] ? `${row[best]} ${s.text}` : s.text;
    }
    return row;
  });
}

const ENTRY = /^(\d{1,4})\s*[.)]?\s+(\S.*)$/;
const ONLY_NUMBER = /^\d{1,4}$/;
/** Kopf-/Fußzeilen und Spaltentitel, die keine Team-Überschrift sind.
 *  Spaltentitel nur als GANZES Segment („Team“), sonst würde „Team Kaizen“ verworfen. */
const NOISE_PREFIX = /^(seite|page|startliste|start list|liste des partants|stand:|datum|date:|\d{1,2}[./]\d{1,2}[./]\d{2,4})/i;
const NOISE_EXACT = /^(nr\.?|no\.?|bib|name|fahrer|rider|team|équipe|equipe|dossard|nation|nat\.?|land|jahrgang|uci id)$/i;
const isNoise = (t: string) => NOISE_PREFIX.test(t) || NOISE_EXACT.test(t);

/**
 * Modus „Startliste“: erkennt Einträge „Nr Name [Zusatz…]“ und Team-Überschriften,
 * auch bei mehreren Teamblöcken nebeneinander (typische UCI-/Veranstalter-Layouts).
 * Ein Eintrag erbt die letzte Überschrift aus derselben Spalte (ähnliche x-Position).
 */
export function linesToStartlist(lines: PdfLine[]): { header: string[]; rows: string[][] } {
  type Heading = { page: number; x0: number; text: string };
  const headings: Heading[] = [];
  const rows: { nr: string; name: string; team: string; extra: string[]; page: number }[] = [];
  const COL_TOL = 70;
  const teamFor = (x0: number) => {
    for (let i = headings.length - 1; i >= 0; i--) {
      const h = headings[i];
      if (Math.abs(h.x0 - x0) <= COL_TOL) return h.text;
    }
    return '';
  };

  for (const line of lines) {
    const segs = line.segments;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let nr = '', name = '', x0 = s.x0;
      const m = s.text.match(ENTRY);
      if (m) { nr = m[1]; name = m[2]; }
      else if (ONLY_NUMBER.test(s.text) && segs[i + 1] && /\p{L}/u.test(segs[i + 1].text) && !ENTRY.test(segs[i + 1].text)) {
        nr = s.text; name = segs[i + 1].text; i++;
      }
      if (nr) {
        // Folgende Segmente ohne eigene Nummer, nahe am Eintrag = Zusatzfelder (Nation, Jahrgang …)
        const extra: string[] = [];
        while (segs[i + 1] && !ENTRY.test(segs[i + 1].text) && !ONLY_NUMBER.test(segs[i + 1].text) && segs[i + 1].x0 - x0 < 260) {
          extra.push(segs[++i].text);
        }
        rows.push({ nr, name, team: teamFor(x0), extra, page: line.page });
        continue;
      }
      const text = s.text;
      if (/\p{L}{2,}/u.test(text) && !isNoise(text) && text.length <= 60) {
        headings.push({ page: line.page, x0, text });
      }
    }
  }
  const maxExtra = Math.max(0, ...rows.map((r) => r.extra.length));
  // Zusatzspalten benennen, wenn ihr Inhalt eindeutig ist (sonst „Zusatz n“, Zuordnung durch Nutzer)
  const labelFor = (k: number) => {
    const vals = rows.map((r) => r.extra[k]).filter((v): v is string => !!v);
    const share = (re: RegExp) => vals.length > 0 && vals.filter((v) => re.test(v)).length / vals.length >= 0.8;
    if (share(/^[A-Z]{3}$/)) return 'Nation';
    if (share(/^(19|20)\d{2}$/)) return 'Jahrgang';
    return `Zusatz ${k + 1}`;
  };
  const header = ['Nr', 'Name', 'Team', ...Array.from({ length: maxExtra }, (_, k) => labelFor(k)), 'PDF-Seite'];
  return {
    header,
    rows: rows.map((r) => [r.nr, r.name, r.team, ...Array.from({ length: maxExtra }, (_, k) => r.extra[k] ?? ''), String(r.page)]),
  };
}

export type PdfMode = 'startliste' | 'tabelle';

export function pdfToMatrix(items: PdfTextItem[], mode: PdfMode): string[][] {
  const lines = toLines(items);
  if (mode === 'tabelle') return linesToTable(lines);
  const { header, rows } = linesToStartlist(lines);
  return [header, ...rows];
}
