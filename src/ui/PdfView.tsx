import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, getDevice, setDevice } from '../db/db';
import { RACE_SECTIONS, RIDER_SECTIONS } from '../domain/types';
import { buildExportDoc, collectExportData, DEFAULT_EXPORT, exportFileName, type ExportOptions } from '../export/exportDoc';
import { renderPdf } from '../export/pdf';
import { saveFile } from './host';
import { stageLabel, useCurrent } from './state';

export function PdfView() {
  const cur = useCurrent();
  const [o, setO] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const riders = useLiveQuery(async () => {
    if (!cur.race) return [];
    const es = alive(await db.entries.where('raceId').equals(cur.race.id).toArray()).filter((e) => e.riderId);
    const rs = (await db.riders.bulkGet(es.map((e) => e.riderId!))).filter((r) => r && !r.deleted);
    return rs.map((r) => r!).sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));
  }, [cur.race?.id]) ?? [];
  useEffect(() => { void getDevice<ExportOptions | null>('pdfOptions', null).then((s) => s && setO({ ...DEFAULT_EXPORT, ...s, riderIds: [] })); }, []);
  const set = (p: Partial<ExportOptions>) => { const n = { ...o, ...p }; setO(n); void setDevice('pdfOptions', { ...n, riderIds: [] }); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (!cur.race) return <main><div className="panel empty-state">Zuerst ein Rennen anlegen.</div></main>;
  const race = cur.race;
  const make = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await collectExportData(race.id);
      const bytes = await renderPdf(buildExportDoc(d, o));
      const r = await saveFile(bytes, exportFileName(race), 'application/pdf');
      setMsg(r.ok ? 'PDF gespeichert.' : r.reason);
    } catch (e) { setMsg(`PDF konnte nicht erstellt werden: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  };

  return (
    <main style={{ maxWidth: 1000 }}>
      <div className="panel">
        <h2>PDF für {race.name} {race.year}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Wähle, was ins PDF soll. Die Auswahl wird gemerkt. Das PDF entsteht in deinem Browser, auch ohne Internet.</p>

        <h3>Rennen</h3>
        <div className="row">
          {RACE_SECTIONS.map((s) => <label key={s.key} className="check"><input type="checkbox" checked={o.raceSections.includes(s.key)} onChange={() => set({ raceSections: toggle(o.raceSections, s.key) })} /> {s.label}</label>)}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <label className="check"><input type="checkbox" checked={o.stages} onChange={(e) => set({ stages: e.target.checked })} /> {race.kind === 'eintages' ? 'Strecke' : 'Etappen mit Notizen'}</label>
          {o.stages && race.kind === 'rundfahrt' && (
            <select value={o.onlyStage ?? ''} onChange={(e) => set({ onlyStage: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Etappen">
              <option value="">alle Etappen</option>{cur.stages.map((s) => <option key={s.id} value={s.number}>nur {stageLabel(s)}</option>)}
            </select>
          )}
          <label className="check"><input type="checkbox" checked={o.startlist} onChange={(e) => set({ startlist: e.target.checked })} /> Startliste</label>
        </div>

        <h3 style={{ marginTop: 14 }}>Spickzettel {o.onlyStage != null ? `(${stageLabel({ number: o.onlyStage })})` : 'pro Etappe'}</h3>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!o.sheetRundown} onChange={(e) => set({ sheetRundown: e.target.checked })} /> SRF-Sendeablauf</label>
          <label className="check"><input type="checkbox" checked={!!o.sheetGeo} onChange={(e) => set({ sheetGeo: e.target.checked })} /> Punkte an der Strecke (km to go)</label>
        </div>
        {race.kind === 'rundfahrt' && !o.stages && (
          <div className="row" style={{ marginTop: 6 }}>
            <select value={o.onlyStage ?? ''} onChange={(e) => set({ onlyStage: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Etappe für Spickzettel">
              <option value="">alle Etappen</option>{cur.stages.map((s) => <option key={s.id} value={s.number}>nur {stageLabel(s)}</option>)}
            </select>
          </div>
        )}

        <h3 style={{ marginTop: 14 }}>Fahrer</h3>
        <div className="row">
          <label className="check"><input type="radio" checked={o.riders === 'keine'} onChange={() => set({ riders: 'keine' })} /> keine</label>
          <label className="check"><input type="radio" checked={o.riders === 'profile'} onChange={() => set({ riders: 'profile' })} /> alle Profil-Fahrer im Rennen ({riders.length})</label>
          <label className="check"><input type="radio" checked={o.riders === 'auswahl'} onChange={() => set({ riders: 'auswahl' })} /> Auswahl</label>
        </div>
        {o.riders === 'auswahl' && (
          <div style={{ columns: '220px', marginTop: 6 }}>
            {riders.map((r) => <label key={r.id} className="check" style={{ display: 'flex' }}><input type="checkbox" checked={o.riderIds.includes(r.id)} onChange={() => setO({ ...o, riderIds: toggle(o.riderIds, r.id) })} /> {r.name}</label>)}
          </div>
        )}
        {o.riders !== 'keine' && (
          <div className="row" style={{ marginTop: 6 }}>
            <label className="check"><input type="checkbox" checked={o.riderFacts} onChange={(e) => set({ riderFacts: e.target.checked })} /> Angaben (Nation, Team, Alter …)</label>
            {RIDER_SECTIONS.map((s) => <label key={s.key} className="check"><input type="checkbox" checked={o.riderSections.includes(s.key)} onChange={() => set({ riderSections: toggle(o.riderSections, s.key) })} /> {s.label}</label>)}
          </div>
        )}

        <h3 style={{ marginTop: 14 }}>Themen</h3>
        <div className="row">
          <label className="check"><input type="radio" checked={o.topics === 'keine'} onChange={() => set({ topics: 'keine' })} /> keine</label>
          <label className="check"><input type="radio" checked={o.topics === 'stern'} onChange={() => set({ topics: 'stern' })} /> nur ★ hervorgehobene</label>
          <label className="check"><input type="radio" checked={o.topics === 'alle'} onChange={() => set({ topics: 'alle' })} /> alle zum Rennen</label>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <label className="check"><input type="checkbox" checked={o.fontScale === 'gross'} onChange={(e) => set({ fontScale: e.target.checked ? 'gross' : 'normal' })} /> grosse Schrift</label>
          <span className="grow" />
          <button className="btn primary" onClick={make} disabled={busy || (o.riders === 'auswahl' && !o.riderIds.length && !o.raceSections.length && !o.stages && !o.startlist)}>{busy ? 'Wird erstellt …' : 'PDF erstellen'}</button>
        </div>
        {msg && <div className="banner" role="status">{msg}</div>}
      </div>
    </main>
  );
}
