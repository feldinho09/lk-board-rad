/**
 * PDF-Export Ende-zu-Ende ohne Browser: Demo-Rennen → Dokument → echtes PDF (pdfmake, Node)
 * → Text mit pdf.js zurücklesen. Prüft Auswahl der Inhalte, Formatierung→PDF und Datenschutz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { useDatabase, db, mutate, newRecord, resetDeviceIdCache } from '../db/db';
import { seedDemo } from '../demo/demo';
import type { Note, Versioned } from '../domain/types';
import { collectExportData, buildExportDoc, DEFAULT_EXPORT, exportFileName, selectParts, type ExportOptions } from './exportDoc';
import { richToPdf } from './richToPdf';
import { readPdfText } from '../import/pdf';
import { Window } from 'happy-dom';

// Node-Umgebung (pdfmake/pdfkit brauchen echte Dateipfade); nur der HTML-Parser kommt aus happy-dom
(globalThis as unknown as { DOMParser: unknown }).DOMParser = new Window().DOMParser;

const require = createRequire(import.meta.url);
async function renderNode(doc: unknown): Promise<Uint8Array> {
  const pdfmake = require('pdfmake') as { addFonts(f: unknown): void; setUrlAccessPolicy(cb: () => boolean): void; createPdf(d: unknown): { getBuffer(): Promise<Buffer> } };
  const dir = require.resolve('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf').replace(/Roboto-Regular\.ttf$/, '');
  pdfmake.addFonts({ Roboto: { normal: dir + 'Roboto-Regular.ttf', bold: dir + 'Roboto-Medium.ttf', italics: dir + 'Roboto-Italic.ttf', bolditalics: dir + 'Roboto-MediumItalic.ttf' } });
  pdfmake.setUrlAccessPolicy(() => false);
  return new Uint8Array(await pdfmake.createPdf(doc).getBuffer());
}
const pdfText = async (doc: unknown) => (await readPdfText(await renderNode(doc))).map((i) => i.str).join(' ').replace(/\s+/g, ' ');

describe('Formatierung → PDF', () => {
  it('fett/kursiv/unterstrichen/Markierung/Aufzählung/Einzug', () => {
    const b = richToPdf('<div>A <b>fett</b> <i>k</i> <u>u</u> <span style="background-color:#fff1a8">m</span><ul><li>eins<ul><li>zwei</li></ul></li></ul><blockquote>ein</blockquote></div>');
    expect(b[0]).toEqual({ text: [{ text: 'A ' }, { text: 'fett', bold: true }, { text: ' ' }, { text: 'k', italics: true }, { text: ' ' }, { text: 'u', decoration: 'underline' }, { text: ' ' }, { text: 'm', background: '#fff1a8' }] });
    expect(b[1]).toEqual({ ul: [{ stack: [{ text: [{ text: 'eins' }] }, { ul: [{ text: [{ text: 'zwei' }] }] }] }] });
    expect(b[2]).toEqual({ stack: [{ text: [{ text: 'ein' }] }], margin: [14, 0, 0, 0] });
    expect(richToPdf('alt\nzwei Zeilen')).toEqual([{ text: [{ text: 'alt' }] }, { text: [{ text: 'zwei Zeilen' }] }]);
  });
});

describe('PDF-Export', () => {
  let n = 0; let edId = '';
  beforeEach(async () => {
    resetDeviceIdCache(); useDatabase(`pdf-${++n}-${Date.now()}`); await db.open();
    edId = await seedDemo();
    const r = (await db.riders.toArray()).find((x) => x.lastName === 'Brändli')!;
    await mutate(['notes', 'riders'], async (w) => {
      await w.put('riders', { ...r, bio: '<div>Kann <b>Zeitfahren</b></div>' });
      await w.put('notes', newRecord<Omit<Note, keyof Versioned>>({ scope: 'rider', refId: r.id, text: 'GEHEIM privat', toldInEditions: [], priority: false, private: true }) as Note);
      await w.put('notes', newRecord<Omit<Note, keyof Versioned>>({ scope: 'edition', refId: edId, editionId: edId, kind: 'statistik', text: '<div>Vorjahressieger <b>Brändli</b></div>', toldInEditions: [], priority: false, private: true }) as Note);
    });
  });

  it('Standard: Titel, Startliste, Fahrerkarten, Statistik – ohne private Notizen und ohne Kurzbio', async () => {
    const d = await collectExportData(edId, null, []);
    const txt = await pdfText(buildExportDoc(d, DEFAULT_EXPORT, new Date('2026-11-05T09:00:00')));
    expect(txt).toContain('DEMO – Rundfahrt Fiktivia 2026');
    expect(txt).toContain('frei erfunden');
    expect(txt).toContain('Startliste (16)');
    expect(txt).toContain('Lars Øvrebø'); // Sonderzeichen eingebettet
    expect(txt).toContain('Vorjahressieger Brändli');
    expect(txt).toContain('BREND-li'); // Aussprache
    expect(txt).not.toContain('GEHEIM');
    expect(txt).not.toContain('Kann Zeitfahren');
    expect(txt).toMatch(/Seite 1 \/ \d/);
  });

  it('Auswahl: nur Favoriten, Kurzbio + private Notizen, Wertungen; Fußzeile warnt vor privaten Notizen', async () => {
    const o: ExportOptions = { ...DEFAULT_EXPORT, riderScope: 'favoriten', startlist: false, statistik: false, card: { ...DEFAULT_EXPORT.card, bio: true, notes: true, privateNotes: true }, standings: ['etappe', 'gc'], standingsTop: 3 };
    const d = await collectExportData(edId, (await db.stages.toArray()).find((s) => s.order === 4)!.id, []);
    expect(selectParts(d, o).length).toBe(3);
    const txt = await pdfText(buildExportDoc(d, o));
    expect(txt).toContain('Kann Zeitfahren');
    expect(txt).toContain('GEHEIM privat');
    expect(txt).toContain('enthält PRIVATE Notizen');
    expect(txt).not.toContain('Startliste (');
    expect(txt).not.toContain('Vorjahressieger');
    expect(txt).toContain('Gesamtwertung nach Etappe 3 (EZF)'); // ehrliche Stand-Beschriftung
    expect(txt).toContain('Etappe 4 noch nicht vorhanden');
    expect(txt).toMatch(/weitere/);
    expect(txt).not.toContain('Marek Dvořák'); // kein Favorit, nicht in Top 3 … sofern nicht in Wertung
  });

  it('Dateiname ohne Sonderzeichen', async () => {
    const d = await collectExportData(edId, null, []);
    expect(exportFileName(d, new Date('2026-11-05T09:07:00'))).toBe('lk-board_DEMO-Rundfahrt-Fiktivia-2026_Etappe-4_2026-11-05_0907.pdf');
  });
});
