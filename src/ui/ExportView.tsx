import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, getDevice, setDevice } from '../db/db';
import { CLASSIFICATION_LABEL, type ClassificationKind } from '../domain/types';
import { collectExportData, buildExportDoc, exportFileName, selectParts, DEFAULT_EXPORT, type ExportOptions, type ExportData } from '../export/exportDoc';
import { renderPdf } from '../export/pdf';
import { saveFile, IS_ARTIFACT } from './host';
import { useApp } from './state';

const KINDS: ClassificationKind[] = ['etappe', 'gc', 'punkte', 'berg', 'nachwuchs', 'team'];
const CARD_FIELDS: [keyof ExportOptions['card'], string][] = [
  ['pronunciation', 'Aussprache'], ['natAge', 'Nation & Alter'], ['type', 'Fahrertyp'], ['results', 'Etappen- & Gesamtplatz'],
  ['facts', 'Schlüsselfakten (max. 3)'], ['strengths', 'Stärken'], ['bio', 'Kurzbiografie'], ['person', 'Geburtsort, Grösse, Gewicht, Wohnort'], ['palmares', 'Erfolge (letzte Siege)'], ['notes', 'Notizen'],
];

/** PDF-Export mit frei wählbaren Inhalten. Die Auswahl wird auf diesem Gerät gemerkt. */
export function ExportView() {
  const app = useApp();
  const editions = useLiveQuery(() => db.editions.toArray().then(alive), []) ?? [];
  const [editionId, setEditionId] = useState(app.editionId ?? '');
  const stages = (useLiveQuery(() => (editionId ? db.stages.where('editionId').equals(editionId).toArray().then(alive) : []), [editionId]) ?? []).sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState(app.stageId ?? '');
  const [o, setO] = useState<ExportOptions | null>(null);
  const [data, setData] = useState<ExportData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { void getDevice<ExportOptions>('pdfExport', DEFAULT_EXPORT).then((v) => setO({ ...DEFAULT_EXPORT, ...v, card: { ...DEFAULT_EXPORT.card, ...v.card } })); }, []);
  useEffect(() => { if (o) void setDevice('pdfExport', o); }, [o]);
  // Angezeigte = verwendete Etappe: gehört die gewählte nicht zu diesem Rennen, aktive bzw. letzte Etappe nehmen
  const effectiveStageId = (stages.find((s) => s.id === stageId) ?? stages.find((s) => s.id === app.stageId) ?? stages[stages.length - 1])?.id ?? '';
  useEffect(() => {
    if (!editionId) { setData(null); return; }
    void collectExportData(editionId, effectiveStageId || null, app.pinned).then(setData).catch(() => setData(null));
  }, [editionId, effectiveStageId, app.pinned]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!o) return null;
  const edition = editions.find((e) => e.id === editionId);
  const count = data ? selectParts(data, o).length : 0;
  const set = (patch: Partial<ExportOptions>) => { setO({ ...o, ...patch }); setMsg(''); };
  const setCard = (k: keyof ExportOptions['card'], v: boolean) => set({ card: { ...o.card, [k]: v } });
  const toggleKind = (k: ClassificationKind) => set({ standings: o.standings.includes(k) ? o.standings.filter((x) => x !== k) : [...KINDS.filter((x) => x === k || o.standings.includes(x))] });
  const nothing = !o.startlist && !o.cards && !o.standings.length && !o.statistik && !o.themen && !o.raceNotes && !o.groups && !o.events;

  const create = async (mode: 'download' | 'preview') => {
    if (!editionId) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await collectExportData(editionId, effectiveStageId || null, app.pinned);
      const bytes = await renderPdf(buildExportDoc(d, o));
      const name = exportFileName(d);
      if (mode === 'preview') {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })));
        setMsg(`PDF erstellt (${Math.ceil(bytes.length / 1024)} KB). Vorschau unten.`);
      } else {
        const r = await saveFile(bytes, name, 'application/pdf');
        setMsg(r.ok ? `Gespeichert als „${name}“ (${Math.ceil(bytes.length / 1024)} KB) – im Download-Ordner.` : `Nicht gespeichert: ${r.reason}`);
      }
    } catch (e) { setErr('PDF konnte nicht erstellt werden: ' + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  };

  const cb = (checked: boolean, onChange: (v: boolean) => void, label: string, extra?: React.ReactNode) => (
    <label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}{extra}</label>
  );

  return (
    <div className="page export">
      <h1>Als PDF speichern</h1>
      <div className="export-grid">
        <fieldset className="form">
          <legend>Rennen</legend>
          <label>Rennen
            <select value={editionId} onChange={(e) => { setEditionId(e.target.value); setStageId(''); }}>
              <option value="">– wählen –</option>
              {editions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          {edition?.format === 'etappen' && (
            <label>Etappe (für Wertungen, Ergebnisse, Statistiken/Themen der Etappe)
              <select value={effectiveStageId} onChange={(e) => setStageId(e.target.value)}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          )}
          <div className="wide">
            <div className="rt-label">Welche Fahrer</div>
            {([['alle', 'Alle Teilnehmer'], ['aktiv', 'Nur im Rennen (ohne DNF/DNS …)'], ['favoriten', 'Nur Favoriten'], ['angeheftet', 'Nur angeheftete']] as const).map(([k, l]) => (
              <label key={k} className="chk"><input type="radio" name="scope" checked={o.riderScope === k} onChange={() => set({ riderScope: k })} /> {l}</label>
            ))}
            <div className="small muted">{count} Fahrer ausgewählt</div>
          </div>
        </fieldset>

        <fieldset className="form">
          <legend>Inhalte</legend>
          <div className="wide col">
            {cb(o.startlist, (v) => set({ startlist: v }), 'Startliste (Tabelle)')}
            {cb(o.cards, (v) => set({ cards: v }), 'Fahrerkarten')}
            {o.cards && (
              <div className="sub">
                {CARD_FIELDS.map(([k, l]) => <span key={k}>{cb(!!o.card[k], (v) => setCard(k, v), l)}</span>)}
                {o.card.notes && cb(o.card.privateNotes, (v) => setCard('privateNotes', v), 'auch private Notizen', o.card.privateNotes ? <span className="warn small"> – PDF nicht weitergeben</span> : null)}
              </div>
            )}
            {cb(o.statistik, (v) => set({ statistik: v }), 'Statistiken')}
            {cb(o.themen, (v) => set({ themen: v }), 'Themen')}
            {cb(o.raceNotes, (v) => set({ raceNotes: v }), 'Notizen zum Rennen')}
            <div>
              <div className="rt-label">Wertungen</div>
              <div className="sub">
                {KINDS.map((k) => <span key={k}>{cb(o.standings.includes(k), () => toggleKind(k), CLASSIFICATION_LABEL[k])}</span>)}
                {o.standings.length > 0 && (
                  <label className="chk">jeweils
                    <select value={o.standingsTop} onChange={(e) => set({ standingsTop: Number(e.target.value) })}>
                      <option value={10}>Top 10</option><option value={20}>Top 20</option><option value={50}>Top 50</option><option value={0}>alle</option>
                    </select>
                  </label>
                )}
              </div>
            </div>
            {cb(o.groups, (v) => set({ groups: v }), 'Renngruppen der Etappe')}
            {cb(o.events, (v) => set({ events: v }), 'Ereignisprotokoll')}
          </div>
        </fieldset>

        <fieldset className="form">
          <legend>Layout</legend>
          <label>Seite
            <select value={o.orientation} onChange={(e) => set({ orientation: e.target.value as 'portrait' | 'landscape' })}>
              <option value="portrait">A4 hoch</option><option value="landscape">A4 quer</option>
            </select>
          </label>
          <label>Schrift
            <select value={o.fontScale} onChange={(e) => set({ fontScale: e.target.value as 'normal' | 'gross' })}>
              <option value="normal">normal</option><option value="gross">groß</option>
            </select>
          </label>
          <label>Fahrerkarten
            <select value={o.cardColumns} onChange={(e) => set({ cardColumns: Number(e.target.value) as 1 | 2 })}>
              <option value={2}>2 nebeneinander</option><option value={1}>1 pro Zeile</option>
            </select>
          </label>
          <button className="link" onClick={() => setO(DEFAULT_EXPORT)}>Auswahl zurücksetzen</button>
        </fieldset>
      </div>

      <div className="row">
        <button disabled={!editionId || busy || nothing} onClick={() => create('download')}>{busy ? 'Erstelle PDF …' : 'PDF speichern'}</button>
        {!IS_ARTIFACT && <button className="small" disabled={!editionId || busy || nothing} onClick={() => create('preview')}>Vorschau</button>}
        {nothing && <span className="warn small">Mindestens einen Inhalt wählen.</span>}
      </div>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      {preview && <iframe className="pdf-preview" src={preview} title="PDF-Vorschau" />}
    </div>
  );
}
