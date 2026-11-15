/**
 * SRF-Programm: tabellarischer Sendeablauf je Etappe.
 */
import { db, alive, mutate, newRecord } from '../db/db';
import type { RundownRow, Versioned } from './types';

type New<T> = Omit<T, keyof Versioned>;

export const rundownRows = async (raceId: string, stageNumber: number) =>
  alive(await db.rundown.where('[raceId+stageNumber]').equals([raceId, stageNumber]).toArray()).sort((a, b) => a.order - b.order);

export async function addRow(raceId: string, stageNumber: number, fields: Partial<New<RundownRow>> = {}, afterOrder?: number): Promise<RundownRow> {
  const rows = await rundownRows(raceId, stageNumber);
  let order: number;
  if (afterOrder == null) order = (rows[rows.length - 1]?.order ?? 0) + 10;
  else {
    const next = rows.find((r) => r.order > afterOrder);
    order = next ? (afterOrder + next.order) / 2 : afterOrder + 10;
  }
  const r = newRecord<New<RundownRow>>({ raceId, stageNumber, order, item: '', ...fields }) as RundownRow;
  return mutate(['rundown'], (w) => w.put('rundown', r));
}

export async function updateRow(id: string, patch: Partial<New<RundownRow>>) {
  return mutate(['rundown'], async (w) => {
    const cur = await db.rundown.get(id);
    if (!cur) throw new Error('Zeile nicht gefunden');
    return w.put('rundown', { ...cur, ...patch });
  });
}
export async function removeRow(id: string) { await mutate(['rundown'], (w) => w.remove('rundown', id)); }

/** Zeile eins nach oben/unten */
export async function moveRow(raceId: string, stageNumber: number, id: string, dir: -1 | 1) {
  const rows = await rundownRows(raceId, stageNumber);
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await mutate(['rundown'], async (w) => {
    await w.put('rundown', { ...rows[i], order: rows[j].order });
    await w.put('rundown', { ...rows[j], order: rows[i].order });
  });
}

/** „14.05“, „14:05“, „1405“ → „14:05“ */
export function normTime(v: string | undefined): string | undefined {
  const m = (v ?? '').trim().match(/^(\d{1,2})[:.h]?(\d{2})(?:[:.](\d{2}))?$/);
  if (!m) return undefined;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
/** „5“, „5'“, „5 min“, „04:30“ (mm:ss), „1:30:00“ → Minuten */
export function parseDuration(v: string | undefined): number | undefined {
  const s = (v ?? '').trim().replace(/\s*(min|minuten|')\s*$/i, '');
  if (!s) return undefined;
  if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  const p = s.split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return undefined;
  if (p.length === 2) return Math.round((p[0] + p[1] / 60) * 100) / 100;
  if (p.length === 3) return Math.round((p[0] * 60 + p[1] + p[2] / 60) * 100) / 100;
  return undefined;
}
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.round(((m % 60) + 60) % 60)).padStart(2, '0')}`;
export const fmtDur = (min?: number) => (min == null ? '' : Number.isInteger(min) ? `${min}'` : `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, '0')}`);

const HEAD: Record<keyof Pick<RundownRow, 'time' | 'durationMin' | 'item' | 'content' | 'who'>, RegExp> = {
  time: /^(zeit|uhrzeit|start|beginn|time|tc)$/i,
  durationMin: /^(dauer|länge|laenge|min|duration)$/i,
  item: /^(element|beitrag|titel|rubrik|programmpunkt|punkt|item|block|teil)$/i,
  content: /^(inhalt|beschreibung|bemerkung|bemerkungen|notiz|notizen|details|text)$/i,
  who: /^(wer|sprecher|kommentar|moderation|verantwortlich|person|personen|on air)$/i,
};

/**
 * Tabelle aus Excel/Word/Mail (Tab-getrennt) lesen. Mit Kopfzeile werden die Spalten über
 * die Überschriften erkannt; ohne gilt: Zeit | Dauer | Element | Inhalt | Wer.
 */
export function parseRundownTable(text: string): Pick<RundownRow, 'time' | 'durationMin' | 'item' | 'content' | 'who'>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const rows = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}|\s*;\s*/)).map((c) => c.trim()));
  let map: Partial<Record<keyof typeof HEAD, number>> = {};
  const head = rows[0];
  for (const [k, re] of Object.entries(HEAD) as [keyof typeof HEAD, RegExp][]) {
    const i = head.findIndex((c) => re.test(c));
    if (i >= 0) map[k] = i;
  }
  const hasHead = Object.keys(map).length >= 2;
  if (!hasHead) {
    // ohne Kopfzeile: Spalten am Inhalt der ersten Zeile erkennen
    const first = rows[0];
    let i = 0;
    map = {};
    if (normTime(first[i])) map.time = i++;
    if (first[i] && parseDuration(first[i]) != null && !normTime(first[i])) map.durationMin = i++;
    else if (first[i] && /^\d{1,3}('|\s*min)$/i.test(first[i])) map.durationMin = i++;
    map.item = i++;
    map.content = i++;
    map.who = i++;
  }
  const body = hasHead ? rows.slice(1) : rows;
  return body.map((c) => {
    const get = (k: keyof typeof HEAD) => (map[k] != null ? c[map[k]!] : undefined);
    return {
      time: normTime(get('time')),
      durationMin: parseDuration(get('durationMin')),
      item: get('item') ?? '',
      content: get('content') || undefined,
      who: get('who') || undefined,
    };
  }).filter((r) => r.item || r.time || r.content);
}

export async function pasteRows(raceId: string, stageNumber: number, text: string, replace: boolean): Promise<number> {
  const parsed = parseRundownTable(text);
  const existing = await rundownRows(raceId, stageNumber);
  let order = replace ? 0 : (existing[existing.length - 1]?.order ?? 0);
  await mutate(['rundown'], async (w) => {
    if (replace) for (const r of existing) await w.remove('rundown', r.id);
    for (const p of parsed) { order += 10; await w.put('rundown', newRecord<New<RundownRow>>({ raceId, stageNumber, order, ...p }) as RundownRow); }
  });
  return parsed.length;
}

/** Ablauf einer anderen Etappe als Vorlage übernehmen (ohne Häkchen). */
export async function copyRundown(raceId: string, fromStage: number, toStage: number): Promise<number> {
  const src = await rundownRows(raceId, fromStage);
  const dst = await rundownRows(raceId, toStage);
  let order = dst[dst.length - 1]?.order ?? 0;
  await mutate(['rundown'], async (w) => {
    for (const r of src) {
      order += 10;
      const { id: _i, rev: _r, createdAt: _c, updatedAt: _u, deleted: _d, ...rest } = r;
      await w.put('rundown', newRecord<New<RundownRow>>({ ...rest, stageNumber: toStage, order, done: false }) as RundownRow);
    }
  });
  return src.length;
}

/** Zeiten aus der ersten Zeit und den Dauern fortschreiben (nur leere Zeiten oder alle). */
export async function fillTimes(raceId: string, stageNumber: number, overwrite: boolean): Promise<number> {
  const rows = await rundownRows(raceId, stageNumber);
  const first = rows.find((r) => r.time);
  if (!first) throw new Error('Mindestens eine Zeile braucht eine Uhrzeit.');
  let t = toMin(first.time!);
  let n = 0;
  await mutate(['rundown'], async (w) => {
    for (const r of rows.slice(rows.indexOf(first))) {
      if (r !== first) {
        if (overwrite || !r.time) { const nt = fromMin(t); if (nt !== r.time) { await w.put('rundown', { ...r, time: nt }); n++; } }
        else t = toMin(r.time);
      }
      t += r.durationMin ?? 0;
    }
  });
  return n;
}

/** Laufende und nächste Zeile zur Uhrzeit (Minuten seit Mitternacht). */
export function currentRow(rows: RundownRow[], nowMin: number): { current?: RundownRow; next?: RundownRow; endsInMin?: number; nextInMin?: number } {
  const timed = rows.filter((r) => r.time).map((r) => ({ r, t: toMin(r.time!) }));
  if (!timed.length) return {};
  let cur: { r: RundownRow; t: number } | undefined;
  for (const x of timed) if (x.t <= nowMin) cur = x;
  const nxt = timed.find((x) => x.t > nowMin);
  return {
    current: cur?.r,
    next: nxt?.r,
    nextInMin: nxt ? nxt.t - nowMin : undefined,
    endsInMin: cur && cur.r.durationMin != null ? cur.t + cur.r.durationMin - nowMin : nxt ? nxt.t - nowMin : undefined,
  };
}
