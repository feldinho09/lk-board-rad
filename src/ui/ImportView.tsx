import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate, newRecord } from '../db/db';
import type { ImportRun, Rider, SavedMapping } from '../domain/types';
import { parseDelimited, parseFile, tableFromMatrix, type ParsedTable } from '../import/parse';
import { TARGET_FIELDS, guessMapping, defaultDecision, validateFinalState, type Mapping, type MatchResult, type RowDecision } from '../import/matching';
import { prepareMatch, commitImport, undoImport } from '../import/commit';
import { csvCell } from '../backup/archive';
import { confirmDialog, promptDialog } from './dialogs';
import { saveFile, IS_ARTIFACT } from './host';
import { readPdfText } from '../import/pdf';
import { pdfToMatrix, type PdfMode, type PdfTextItem } from '../import/pdfLayout';
import { loadFromLink } from '../import/link';
import { parsePcsStartlist, pcsStartlistToMatrix, parsePcsRanking, type PcsStartlist, type PcsRanking } from '../import/pcsPaste';
import { PcsRankingPanel } from './PcsRankingPanel';
import { useApp } from './state';

const IMPORT_TEMPLATE = '\uFEFFStartnummer;Vorname;Nachname;Team;Kategorie;Nation;Geburtsdatum;UCI-ID;PCS-Kennung\r\n001;Vorname;Nachname;Teamname;Elite;SUI;1999-04-12;;\r\n002;Zweiter;Fahrer;Teamname;Elite;GER;2001;;\r\n';
const STATUS_TXT = { zugeordnet: 'eindeutig zugeordnet', neu: 'neu', mehrdeutig: 'mehrdeutig – Entscheidung nötig', fehlerhaft: 'fehlerhaft' } as const;
const DIFF_TXT = { neu_im_rennen: 'neu im Rennen', unveraendert: 'unverändert', geaendert: 'geändert' } as const;

export function ImportView() {
  const app = useApp();
  const editions = useLiveQuery(() => db.editions.toArray().then(alive), []) ?? [];
  const [editionId, setEditionId] = useState(app.editionId ?? '');
  const [sourceName, setSourceName] = useState('');
  const [matrices, setMatrices] = useState<Record<string, unknown[][]>>({});
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [paste, setPaste] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<MatchResult | null>(null);
  const [decisions, setDecisions] = useState<RowDecision[]>([]);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ImportRun | null>(null);
  const [pdfItems, setPdfItems] = useState<PdfTextItem[] | null>(null);
  const [pdfMode, setPdfMode] = useState<PdfMode>('startliste');
  const [reviewed, setReviewed] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [pcs, setPcs] = useState<PcsStartlist | null>(null);
  const [ranking, setRanking] = useState<PcsRanking | null>(null);
  const mappings = useLiveQuery(() => db.mappings.toArray().then(alive), []) ?? [];
  const existingParts = useLiveQuery(() => (editionId ? db.participations.where('editionId').equals(editionId).toArray().then(alive) : []), [editionId]) ?? [];
  const live = app.mode === 'live';
  useEffect(() => { if (app.editionId) { setEditionId(app.editionId); } }, [app.editionId]);

  const table: ParsedTable | null = useMemo(() => (sheet && matrices[sheet] ? tableFromMatrix(matrices[sheet], headerRow - 1) : null), [sheet, matrices, headerRow]);
  useEffect(() => { if (table) setMapping((m) => (Object.keys(m).length ? m : guessMapping(table.headers))); }, [table]);
  const reset = () => { setResult(null); setDone(null); setError(''); };

  const useMatrices = (m: Record<string, unknown[][]>, name: string, items: PdfTextItem[] | null = null) => {
    setMatrices(m); setSheet(Object.keys(m)[0]); setSourceName(name); setMapping({}); setHeaderRow(1);
    setPdfItems(items); setReviewed(false); setPcs(null); setRanking(null);
  };
  /** Kopierter Text: erst auf PCS-Startliste prüfen, sonst als Tabelle lesen. */
  const useText = (text: string, name: string): void => {
    const rk = parsePcsRanking(text);
    if (rk) { setMatrices({}); setSheet(''); setPdfItems(null); setPcs(null); setRanking(rk); return; }
    const p = parsePcsStartlist(text);
    if (p) {
      const label = `PCS (manuell kopiert): ${p.meta.raceName ?? name}${p.meta.year ? ` ${p.meta.year}` : ''}`;
      useMatrices({ [label]: pcsStartlistToMatrix(p) }, label);
      setPcs(p);
    } else useMatrices({ [name]: parseDelimited(text) }, name);
  };
  const loadPdf = async (bytes: Uint8Array, name: string, mode = pdfMode) => {
    const items = await readPdfText(bytes);
    if (items.filter((i) => i.str.trim()).length < 5) {
      throw new Error('Dieses PDF enthält keine lesbare Textebene – vermutlich ein Scan oder Foto. Texterkennung (OCR) ist noch nicht eingebaut. Bitte eine digitale Startliste (PDF aus Word/Excel, CSV, XLSX) verwenden.');
    }
    useMatrices({ [`PDF: ${name}`]: pdfToMatrix(items, mode) }, name, items);
  };
  const loadFile = async (f: File) => {
    reset();
    setBusy('Datei wird gelesen …');
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('Datei größer als 20 MB – bitte prüfen.');
      const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
      if (isPdf) await loadPdf(new Uint8Array(await f.arrayBuffer()), f.name);
      else if (/\.xlsx$/i.test(f.name)) { const { matrices } = await parseFile(f); useMatrices(matrices, f.name); }
      else {
        const buf = await f.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buf);
        useText(text.replace(/^\uFEFF/, ''), f.name);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const loadLink = async () => {
    reset();
    setBusy('Link wird geladen …');
    try {
      const r = await loadFromLink(link);
      if (r.kind === 'pdf') await loadPdf(r.bytes, r.name);
      else if (r.kind === 'xlsx') { const { matrices } = await parseFile(r.file); useMatrices(matrices, link.trim()); }
      else useMatrices(r.matrices, link.trim());
      setSourceName(link.trim());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const changePdfMode = (m: PdfMode) => {
    setPdfMode(m);
    if (pdfItems) { setMatrices({ [sheet]: pdfToMatrix(pdfItems, m) }); setMapping({}); setReviewed(false); reset(); }
  };
  const editCell = (r: number, c: number, v: string) => {
    const m = (matrices[sheet] ?? []).map((row) => [...row]);
    m[r][c] = v;
    setMatrices({ ...matrices, [sheet]: m });
    setReviewed(false); setResult(null);
  };
  const deleteRow = (r: number) => {
    setMatrices({ ...matrices, [sheet]: (matrices[sheet] ?? []).filter((_, i) => i !== r) });
    setReviewed(false); setResult(null);
  };
  const loadPaste = () => {
    reset();
    useText(paste, 'Eingefügte Tabelle');
  };
  const runMatch = async () => {
    if (!table || !editionId) return;
    setError('');
    if (pdfItems && !reviewed) return setError('Bitte zuerst die aus dem PDF erkannte Tabelle prüfen und bestätigen.');
    if (!mapping.lastName && !mapping.fullName) return setError('Bitte mindestens „Nachname“ oder „Name (vollständig)“ zuordnen.');
    const r = await prepareMatch(editionId, table.rows, mapping);
    setResult(r);
    setDecisions(r.rows.map(defaultDecision));
  };
  const commit = async () => {
    if (!result) return;
    setError('');
    try {
      const run = await commitImport(editionId, sourceName, result, decisions);
      setDone(run); setResult(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const edition = editions.find((e) => e.id === editionId);
  const finalErrors = result && edition ? validateFinalState(result.rows, decisions, existingParts, edition.bibScope) : [];

  if (live) return <div className="page"><h1>Import</h1><p>Importe sind im Live-Modus gesperrt. Bitte in den Bearbeitungsmodus wechseln.</p></div>;

  return (
    <div className="page">
      <h1>Startliste importieren</h1>
      <p className="muted">CSV, XLSX, PDF, Link oder eingefügte Tabelle. Jede Zeile wird geprüft; nichts wird ungefragt in Fahrerprofile geschrieben. Vor jedem Import entsteht automatisch ein Wiederherstellungspunkt. <button className="link" onClick={() => saveFile(IMPORT_TEMPLATE, 'lk-board-importvorlage.csv', 'text/csv')}>Importvorlage (CSV)</button></p>
      <fieldset
        className={`form ${dragOver ? 'drop' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void loadFile(f); }}
      >
        <legend>1 · Ziel und Quelle</legend>
        <label>Rennen
          <select value={editionId} onChange={(e) => { setEditionId(e.target.value); reset(); }}>
            <option value="">– wählen –</option>
            {editions.filter((e) => e.status !== 'archiviert').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label>Datei (CSV, XLSX, PDF – auch hierher ziehen) <input type="file" accept=".csv,.txt,.tsv,.xlsx,.pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f); }} /></label>
        <label className="wide">… oder Link zur Startliste (PDF, CSV, XLSX oder Webseite mit Tabelle)
          <span className="row" style={{ margin: 0 }}>
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && link.trim() && void loadLink()} placeholder="https://…" style={{ flex: 1 }} aria-label="Link zur Startliste" />
            <button disabled={!link.trim() || !!busy || IS_ARTIFACT} onClick={loadLink}>Link laden</button>
          </span>
          <span className="small muted">{IS_ARTIFACT
            ? 'In der Claude-Artefakt-Fassung sind Abrufe fremder Seiten gesperrt – bitte die Datei herunterladen und hier ablegen.'
            : 'Funktioniert nur, wenn die Seite den Abruf aus dem Browser erlaubt (CORS). Sonst Datei speichern und hier ablegen. ProCyclingStats nur über autorisierten Zugang.'}</span>
        </label>
        <label className="wide">… oder Tabelle einfügen
          <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Aus Excel/Browser kopierte Tabelle mit Kopfzeile – oder ganze PCS-Startlistenseite (Strg A, Strg C)" />
        </label>
        <button disabled={!paste.trim()} onClick={loadPaste}>Eingefügte Tabelle laden</button>
      </fieldset>

      {table && (
        <fieldset className="form">
          <legend>2 · Tabellenblatt, Kopfzeile, Spalten</legend>
          {Object.keys(matrices).length > 1 && (
            <label>Tabellenblatt <select value={sheet} onChange={(e) => { setSheet(e.target.value); setMapping({}); reset(); }}>{Object.keys(matrices).map((s) => <option key={s}>{s}</option>)}</select></label>
          )}
          <label>Kopfzeile in Zeile <input type="number" min={1} value={headerRow} onChange={(e) => { setHeaderRow(Math.max(1, Number(e.target.value))); setMapping({}); reset(); }} style={{ width: '5em' }} /></label>
          <label>Gespeicherte Zuordnung
            <select value="" onChange={(e) => { const m = mappings.find((x) => x.id === e.target.value); if (m) { setMapping(m.mapping as Mapping); reset(); } }}>
              <option value="">– laden –</option>
              {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="mapping wide">
            {TARGET_FIELDS.map((f) => (
              <label key={f.key}>{f.label}
                <select value={mapping[f.key] ?? ''} onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value || undefined }); reset(); }}>
                  <option value="">– nicht verwenden –</option>
                  {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button className="small" onClick={async () => {
            const name = await promptDialog('Name der Zuordnung (z. B. Veranstalter)');
            if (name) await mutate(['mappings'], (w) => w.put('mappings', newRecord({ name, mapping } as Omit<SavedMapping, 'id' | 'rev' | 'createdAt' | 'updatedAt'>)));
          }}>Zuordnung speichern</button>
          {pcs && (
            <div className="wide banner ok" style={{ margin: 0 }}>
              <strong>ProCyclingStats-Startliste erkannt</strong> (manuell kopiert): {pcs.meta.raceName ?? '–'}{pcs.meta.year ? ` ${pcs.meta.year}` : ''}{pcs.meta.raceClass ? ` (${pcs.meta.raceClass})` : ''}{pcs.meta.distanceKm ? ` · ${pcs.meta.distanceKm} km` : ''}
              {' · '}{pcs.entries.length} Fahrer in {pcs.teams.length} Teams{pcs.meta.expectedRiders != null ? ` (laut PCS: ${pcs.meta.expectedRiders})` : ''}
              {pcs.warnings.map((w) => <div key={w} className="warn">⚠ {w}</div>)}
            </div>
          )}
          {pdfItems && (
            <div className="wide pdf-review">
              <h3>Aus dem PDF erkannte Tabelle – bitte prüfen</h3>
              <p className="small muted">Text und Startnummern stammen exakt aus der PDF-Textebene; die Aufteilung in Zeilen, Spalten und Teams ist eine automatische Erkennung. Werte direkt korrigieren, falsche Zeilen entfernen.</p>
              <div className="row">
                <label>Erkennung
                  <select value={pdfMode} onChange={(e) => changePdfMode(e.target.value as PdfMode)}>
                    <option value="startliste">Startliste (Nummer + Name, Teams aus Überschriften)</option>
                    <option value="tabelle">Tabelle (Spalten nach Position)</option>
                  </select>
                </label>
                <span className="small">{table.rows.length} Zeilen erkannt{table.headers.includes('Team') ? ` · ${table.rows.filter((r) => !r['Team']).length} ohne Team` : ''}</span>
              </div>
              <div className="scroll-x pdf-grid">
                <table className="table compact">
                  <thead><tr><th></th>{(matrices[sheet]?.[headerRow - 1] ?? []).map((h, c) => <th key={c}>{String(h)}</th>)}</tr></thead>
                  <tbody>
                    {(matrices[sheet] ?? []).slice(headerRow).map((row, i) => {
                      const r = i + headerRow;
                      return (
                        <tr key={r}>
                          <td><button className="link" onClick={() => deleteRow(r)} aria-label={`Zeile ${i + 1} entfernen`} title="Zeile entfernen">✕</button></td>
                          {row.map((v, c) => (
                            <td key={c}><input value={String(v ?? '')} onChange={(e) => editCell(r, c, e.target.value)} aria-label={`Zeile ${i + 1} Spalte ${c + 1}`} size={Math.max(3, Math.min(28, String(v ?? '').length + 1))} /></td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <label className="confirm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> Ich habe die erkannte Tabelle geprüft (Startnummern, Namen, Teams).</label>
            </div>
          )}
          <div className="wide" hidden={!!pdfItems}>
            <h3>Vorschau (Originalwerte, erste 5 Zeilen von {table.rows.length})</h3>
            <div className="scroll-x">
              <table className="table compact"><thead><tr>{table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{table.rows.slice(0, 5).map((r, i) => <tr key={i}>{table.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table>
            </div>
          </div>
          <button disabled={!editionId || (!!pdfItems && !reviewed)} onClick={runMatch}>3 · Abgleichen</button>
        </fieldset>
      )}

      {busy && <div className="banner warn" role="status">{busy}</div>}
      {ranking && <PcsRankingPanel ranking={ranking} editionId={editionId} />}

      {error && <div className="banner err" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {result && <MatchTable result={result} decisions={decisions} setDecisions={setDecisions} />}
      {result && (
        <div className="row sticky-bottom">
          {finalErrors.length > 0 && <span className="err">{finalErrors.join(' · ')}</span>}
          <button disabled={finalErrors.length > 0} onClick={commit}>4 · Bestätigte Zeilen übernehmen</button>
          <span className="muted">{decisions.filter((d) => d.action === 'uebernehmen').length} übernehmen · {decisions.filter((d) => d.action === 'zurueckstellen').length} zurückstellen</span>
        </div>
      )}
      {done && <ImportSummary run={done} />}
      {editionId && <ImportHistory editionId={editionId} />}
    </div>
  );
}

function MatchTable({ result, decisions, setDecisions }: { result: MatchResult; decisions: RowDecision[]; setDecisions: (d: RowDecision[]) => void }) {
  const ids = useMemo(() => [...new Set(result.rows.flatMap((r) => [...r.candidates, r.riderId ?? '']).filter(Boolean))], [result]);
  const riders = useLiveQuery(async () => new Map((await db.riders.bulkGet(ids)).filter((r): r is Rider => !!r).map((r) => [r.id, r])), [ids]) ?? new Map<string, Rider>();
  const nameOf = (id: string) => { const r = riders.get(id); return r ? `${r.displayName} (${r.nationality ?? '?'}, ${r.birthDate ?? 'Jg. ?'})` : id.slice(0, 8); };
  const counts = result.rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});

  return (
    <section>
      <h2>Abgleich</h2>
      <p>{Object.entries(counts).map(([k, v]) => `${v} ${STATUS_TXT[k as keyof typeof STATUS_TXT]}`).join(' · ')} · {result.notInFile.length} bisher gemeldet, aber nicht in der Datei</p>
      <div className="scroll-x">
        <table className="table compact">
          <thead><tr><th>Zeile</th><th>Nr.</th><th>Name</th><th>Team</th><th>Status</th><th>Änderung</th><th>Hinweise</th><th>Entscheidung</th></tr></thead>
          <tbody>
            {result.rows.map((r, i) => {
              const d = decisions[i];
              const value = d.action === 'zurueckstellen' ? 'zurueck' : d.riderId;
              return (
                <tr key={i} className={`st-${r.status}`}>
                  <td>{r.index + 1}</td><td>{r.norm.bib || '–'}</td><td>{r.norm.displayName}</td><td>{r.norm.team}</td>
                  <td><span className={`badge st-${r.status}`}>{STATUS_TXT[r.status]}</span></td>
                  <td>{r.diff ? DIFF_TXT[r.diff] : '–'}{r.changes.length > 0 && <div className="small">{r.changes.join('; ')}</div>}</td>
                  <td className="small">{r.problems.join('; ')}</td>
                  <td>
                    {r.status === 'fehlerhaft' ? <span className="muted">zurückgestellt</span> : (
                      <select aria-label={`Entscheidung Zeile ${r.index + 1}`} value={value} onChange={(e) => {
                        const v = e.target.value;
                        const next = [...decisions];
                        next[i] = v === 'zurueck' ? { action: 'zurueckstellen' } : { action: 'uebernehmen', riderId: v };
                        setDecisions(next);
                      }}>
                        <option value="zurueck">zurückstellen</option>
                        <option value="neu">als neuen Fahrer anlegen</option>
                        {[...new Set([r.riderId, ...r.candidates].filter(Boolean) as string[])].map((id) => <option key={id} value={id}>= {nameOf(id)}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.notInFile.length > 0 && (
        <p className="muted">Nicht in der neuen Datei enthalten (werden NICHT gelöscht oder als ausgeschieden markiert): {result.notInFile.map((p) => `Nr. ${p.bib}`).join(', ')}</p>
      )}
    </section>
  );
}

function ImportSummary({ run }: { run: ImportRun }) {
  const s = run.summary;
  const report = () => {
    const cols = [...new Set(run.deferredRows.flatMap((d) => Object.keys(d.row)))];
    const csv = '﻿' + [[...cols, 'Grund'].join(';'), ...run.deferredRows.map((d) => [...cols.map((c) => csvCell(d.row[c])), csvCell(d.reason)].join(';'))].join('\r\n');
    void saveFile(csv, `import-fehlerbericht_${run.createdAt.slice(0, 10)}.csv`, 'text/csv');
  };
  return (
    <div className="banner ok">
      Import gespeichert: {s.neu} neue Fahrer, {s.zugeordnet} zugeordnet ({s.geaendert} geändert, {s.unveraendert} unverändert), {s.zurueckgestellt} zurückgestellt, {s.fehlerhaft} fehlerhaft, {s.nichtEnthalten} nicht in Datei.
      {run.deferredRows.length > 0 && <button className="small" onClick={report}>Fehlerbericht herunterladen</button>}
    </div>
  );
}

function ImportHistory({ editionId }: { editionId: string }) {
  const runs = (useLiveQuery(() => db.importRuns.where('editionId').equals(editionId).toArray().then(alive), [editionId]) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [msg, setMsg] = useState('');
  if (!runs.length) return null;
  return (
    <section>
      <h2>Importprotokoll</h2>
      <table className="table compact">
        <thead><tr><th>Zeit</th><th>Quelle</th><th>Ergebnis</th><th></th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString('de-CH')}</td><td>{r.sourceName}</td>
              <td className="small">neu {r.summary.neu} · geändert {r.summary.geaendert} · unverändert {r.summary.unveraendert} · zurückgestellt {r.summary.zurueckgestellt + r.summary.fehlerhaft}</td>
              <td>{r.undone ? <span className="muted">zurückgenommen</span> : (
                <button className="small" onClick={async () => {
                  if (!(await confirmDialog('Diesen Import zurücknehmen? Später bearbeitete Datensätze bleiben unverändert.', 'Zurücknehmen'))) return;
                  const res = await undoImport(r.id);
                  setMsg(`${res.undone} Änderungen zurückgenommen.${res.skipped.length ? ' Nicht zurückgenommen: ' + res.skipped.join('; ') : ''}`);
                }}>Rückgängig</button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
