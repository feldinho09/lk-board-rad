import Papa from 'papaparse';

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  sheetNames?: string[];
}

/** Rohtabelle (Zeilen als Arrays) → Objekte, ab gewählter Kopfzeile. Alles bleibt Text. */
export function tableFromMatrix(matrix: unknown[][], headerRow = 0): ParsedTable {
  const header = (matrix[headerRow] ?? []).map((h, i) => {
    const s = String(h ?? '').trim();
    return s || `Spalte ${i + 1}`;
  });
  // doppelte Spaltennamen eindeutig machen
  const seen = new Map<string, number>();
  const headers = header.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  const rows: Record<string, string>[] = [];
  for (const line of matrix.slice(headerRow + 1)) {
    if (!line || line.every((c) => String(c ?? '').trim() === '')) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cellToText(line[i])));
    rows.push(obj);
  }
  return { headers, rows };
}

function cellToText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** CSV oder eingefügte Tabelle (Tab/Semikolon/Komma werden automatisch erkannt). */
export function parseDelimited(text: string): unknown[][] {
  const clean = text.replace(/^﻿/, '');
  const res = Papa.parse<string[]>(clean, {
    dynamicTyping: false, // Startnummern bleiben Text, "007" bleibt "007"
    skipEmptyLines: 'greedy',
    delimitersToGuess: ['\t', ';', ',', '|'],
  });
  return res.data;
}

export async function parseFile(file: File): Promise<{ matrices: Record<string, unknown[][]>; sheetNames: string[] }> {
  const name = file.name.toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('Datei größer als 20 MB – bitte prüfen.');
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    // parseNumber: Zahlen als Originaltext übernehmen (keine Rundung, keine Typ-Raterei)
    const sheets = await readXlsxFile(file, { parseNumber: (s: string) => s });
    const matrices: Record<string, unknown[][]> = {};
    for (const s of sheets) matrices[s.sheet] = s.data as unknown[][];
    return { matrices, sheetNames: sheets.map((s) => s.sheet) };
  }
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Häufiger Fall: Excel-CSV in Windows-1252
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return { matrices: { [file.name]: parseDelimited(text) }, sheetNames: [file.name] };
}
