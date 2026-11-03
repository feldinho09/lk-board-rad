/** PDF-Startlisten: echte PDFs (mit reportlab erzeugt, fiktive Namen) durch pdf.js + Layout-Erkennung. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { readPdfText } from './pdf';
import { pdfToMatrix, toLines, linesToStartlist, type PdfTextItem } from './pdfLayout';
import { tableFromMatrix } from './parse';
import { guessMapping, matchRows } from './matching';

const load = (f: string) => readPdfText(new Uint8Array(readFileSync(`src/import/fixtures/${f}`)));

describe('PDF-Import', () => {
  it('Teamblöcke nebeneinander über zwei Seiten: Nummer, Name, Team, Nation korrekt', async () => {
    const m = pdfToMatrix(await load('startliste-teambloecke.pdf'), 'startliste');
    expect(m[0]).toEqual(['Nr', 'Name', 'Team', 'Nation', 'PDF-Seite']);
    const rows = m.slice(1);
    expect(rows).toHaveLength(18);
    const by = (nr: string) => rows.find((r) => r[0] === nr)!;
    expect(by('12')).toEqual(['12', 'ØVREBØ Lars', 'ÉQUIPE LUMIÈRE', 'NOR', '1']);
    expect(by('41')[2]).toBe('TEAM KAIZEN'); // Teamname beginnt mit „Team“
    expect(by('43')[1]).toBe('VAN DEN BROECK Joris');
    expect(by('007')).toEqual(['007', 'AGENT Bond', 'ZERO ONE', 'GBR', '2']); // führende Nullen
    // Kopfzeilen werden nicht zu Teams oder Fahrern
    expect(rows.some((r) => /Startliste|Stand/.test(r.join(' ')))).toBe(false);
  });

  it('Tabellenlayout: Spalten nach Position, danach normaler Abgleich', async () => {
    const t = tableFromMatrix(pdfToMatrix(await load('startliste-tabelle.pdf'), 'tabelle'));
    expect(t.headers).toEqual(['Nr', 'Name', 'Team', 'Nation', 'Jahrgang']);
    expect(t.rows[0]).toMatchObject({ Nr: '007', Name: 'Lars Øvrebø', Nation: 'NOR' });
    const mapping = guessMapping(t.headers);
    expect(mapping).toMatchObject({ bib: 'Nr', fullName: 'Name', team: 'Team', nationality: 'Nation', birthDate: 'Jahrgang' });
    const res = matchRows(t.rows, mapping, { riders: [], editionParticipations: [], bibScope: 'rennen' });
    expect(res.rows.map((r) => r.status)).toEqual(['neu', 'neu', 'neu']);
    expect(res.rows[2].norm.birthDate).toBe(''); // fehlender Jahrgang bleibt leer
  });

  it('PDF ohne Textebene (Scan) liefert keine erfundenen Einträge', () => {
    expect(linesToStartlist(toLines([])).rows).toEqual([]);
  });

  it('Nummer und Name in getrennten Textstücken werden zusammengeführt', () => {
    const it = (str: string, x: number, y: number, bold = false): PdfTextItem => ({ page: 1, str, x, y, w: str.length * 5, h: 10, bold });
    const items = [it('SQUADRA X', 40, 700, true), it('5', 40, 685), it('ROSSI Marco', 70, 685), it('ITA', 200, 685)];
    expect(linesToStartlist(toLines(items)).rows).toEqual([['5', 'ROSSI Marco', 'SQUADRA X', 'ITA', '1']]);
  });
});
