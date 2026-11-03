import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate, newRecord } from '../db/db';
import type { Edition, EditionFormat, EditionStatus, Participation, RaceSeries, Rider, Stage, StageType, StartStatus } from '../domain/types';
import { START_STATUS_LABEL } from '../domain/types';
import { seedDemo } from '../demo/demo';
import { useApp } from './state';
import { bibSort } from './LiveView';
import { confirmDialog } from './dialogs';

type F<T> = Omit<T, 'id' | 'rev' | 'createdAt' | 'updatedAt'>;
const STATUS_LABEL: Record<EditionStatus, string> = { geplant: 'geplant', laeuft: 'läuft', beendet: 'beendet', archiviert: 'archiviert' };

export function RacesView({ id }: { id?: string }) {
  if (id) return <RaceDetail id={id} />;
  return <RaceList />;
}

function RaceList() {
  const app = useApp();
  const editions = useLiveQuery(() => db.editions.orderBy('startDate').reverse().toArray().then(alive), []) ?? [];
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const visible = editions.filter((e) => showArchived || e.status !== 'archiviert');

  return (
    <div className="page">
      <h1>Rennen</h1>
      <NewRaceForm />
      <div className="row">
        <button disabled={busy} onClick={async () => { setBusy(true); const id = await seedDemo(); app.setEdition(id); setBusy(false); }}>
          Demo-Rundfahrt laden (fiktive Daten)
        </button>
        <label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte anzeigen</label>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Datum</th><th>Format</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {visible.map((e) => (
            <tr key={e.id}>
              <td><a href={`#rennen-${e.id}`}>{e.name}</a>{e.dataOrigin === 'demo' && <span className="tag">DEMO</span>}</td>
              <td>{e.startDate}</td>
              <td>{e.format === 'etappen' ? 'Etappenrennen' : 'Eintagesrennen'}</td>
              <td>{STATUS_LABEL[e.status]}</td>
              <td>{app.editionId === e.id ? <strong>aktiv</strong> : <button className="small" onClick={() => app.setEdition(e.id)}>Aktivieren</button>}</td>
            </tr>
          ))}
          {visible.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Rennen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function NewRaceForm() {
  const app = useApp();
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [format, setFormat] = useState<EditionFormat>('eintages');
  const [stages, setStages] = useState(5);
  const [prolog, setProlog] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    if (!name.trim()) return setErr('Name fehlt');
    setErr('');
    const id = await mutate(['series', 'editions', 'stages'], async (w) => {
      const s = newRecord<F<RaceSeries>>({ name: name.trim() }) as RaceSeries;
      await w.put('series', s);
      const e = newRecord<F<Edition>>({
        seriesId: s.id, name: name.trim(), year: Number(date.slice(0, 4)), format, startDate: date,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'geplant', bibScope: 'rennen', dataOrigin: 'manuell',
      }) as Edition;
      await w.put('editions', e);
      const defs: [number, string, StageType][] = format === 'eintages'
        ? [[1, 'Rennen', 'eintages']]
        : [...(prolog ? [[0, 'Prolog', 'prolog'] as [number, string, StageType]] : []), ...Array.from({ length: stages }, (_, i) => [i + 1, `Etappe ${i + 1}`, 'strasse'] as [number, string, StageType])];
      for (const [order, label, type] of defs) {
        const d = new Date(date + 'T12:00:00');
        d.setDate(d.getDate() + (prolog ? order : order - 1));
        await w.put('stages', newRecord<F<Stage>>({ editionId: e.id, order, label, type, date: d.toISOString().slice(0, 10) }) as Stage);
      }
      return e.id;
    });
    app.setEdition(id);
    setName('');
  };

  return (
    <fieldset className="form">
      <legend>Neues Rennen</legend>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Datum <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Format
        <select value={format} onChange={(e) => setFormat(e.target.value as EditionFormat)}>
          <option value="eintages">Eintagesrennen</option>
          <option value="etappen">Etappenrennen</option>
        </select>
      </label>
      {format === 'etappen' && (
        <>
          <label>Etappen <input type="number" min={1} max={30} value={stages} onChange={(e) => setStages(Number(e.target.value))} /></label>
          <label><input type="checkbox" checked={prolog} onChange={(e) => setProlog(e.target.checked)} /> mit Prolog</label>
        </>
      )}
      <button onClick={create}>Anlegen</button>
      {err && <span className="err">{err}</span>}
    </fieldset>
  );
}

function RaceDetail({ id }: { id: string }) {
  const app = useApp();
  const edition = useLiveQuery(() => db.editions.get(id), [id]);
  const stages = (useLiveQuery(() => db.stages.where('editionId').equals(id).toArray().then(alive), [id]) ?? []).sort((a, b) => a.order - b.order);
  const parts = (useLiveQuery(() => db.participations.where('editionId').equals(id).toArray().then(alive), [id]) ?? []).sort(bibSort);
  const riders = useLiveQuery(async () => new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((r): r is Rider => !!r).map((r) => [r.id, r])), [parts]) ?? new Map();
  if (!edition) return <p>Rennen nicht gefunden.</p>;
  const live = app.mode === 'live';
  const saveEdition = (patch: Partial<Edition>) => mutate(['editions'], (w) => w.put('editions', { ...edition, ...patch }));
  const saveStage = (s: Stage, patch: Partial<Stage>) => mutate(['stages'], (w) => w.put('stages', { ...s, ...patch }));
  const savePart = (p: Participation, patch: Partial<Participation>) => mutate(['participations'], (w) => w.put('participations', { ...p, ...patch }));

  return (
    <div className="page">
      <p><a href="#rennen">← Rennen</a></p>
      <h1>{edition.name} {edition.dataOrigin === 'demo' && <span className="tag">DEMO</span>}</h1>
      {edition.notes && <p className="muted">{edition.notes}</p>}
      <fieldset className="form" disabled={live}>
        <legend>Stammdaten{live && ' (im Live-Modus gesperrt)'}</legend>
        <label>Name <input defaultValue={edition.name} onBlur={(e) => e.target.value.trim() && e.target.value !== edition.name && saveEdition({ name: e.target.value.trim() })} /></label>
        <label>Ort <input defaultValue={edition.location ?? ''} onBlur={(e) => e.target.value !== (edition.location ?? '') && saveEdition({ location: e.target.value })} /></label>
        <label>Zeitzone <input defaultValue={edition.timezone} onBlur={(e) => e.target.value !== edition.timezone && saveEdition({ timezone: e.target.value })} /></label>
        <label>Status
          <select value={edition.status} onChange={async (e) => {
            const v = e.target.value as EditionStatus;
            if (v === 'archiviert' && !(await confirmDialog('Rennen archivieren? Es bleibt mit seinem Datenstand erhalten und kann wieder geöffnet werden.', 'Archivieren'))) return;
            void saveEdition({ status: v });
          }}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Startnummern eindeutig
          <select value={edition.bibScope} onChange={(e) => saveEdition({ bibScope: e.target.value as 'rennen' | 'kategorie' })}>
            <option value="rennen">pro Rennen</option><option value="kategorie">pro Kategorie</option>
          </select>
        </label>
      </fieldset>

      <h2>Etappen / Läufe</h2>
      <table className="table">
        <thead><tr><th>Reihenfolge</th><th>Bezeichnung</th><th>Datum</th><th>Art</th><th>km</th></tr></thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.id}>
              <td><input type="number" step="0.5" defaultValue={s.order} disabled={live} onBlur={(e) => Number(e.target.value) !== s.order && saveStage(s, { order: Number(e.target.value) })} style={{ width: '5em' }} /></td>
              <td><input defaultValue={s.label} disabled={live} onBlur={(e) => e.target.value !== s.label && saveStage(s, { label: e.target.value })} /></td>
              <td><input type="date" defaultValue={s.date} disabled={live} onBlur={(e) => e.target.value !== s.date && saveStage(s, { date: e.target.value })} /></td>
              <td>
                <select value={s.type} disabled={live} onChange={(e) => saveStage(s, { type: e.target.value as StageType })}>
                  <option value="strasse">Straße</option><option value="prolog">Prolog</option><option value="ezf">Einzelzeitfahren</option><option value="mzf">Mannschaftszeitfahren</option><option value="eintages">Eintagesrennen</option>
                </select>
              </td>
              <td><input type="number" defaultValue={s.distanceKm ?? ''} disabled={live} onBlur={(e) => saveStage(s, { distanceKm: e.target.value ? Number(e.target.value) : undefined })} style={{ width: '6em' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!live && (
        <button className="small" onClick={() => {
          const last = stages[stages.length - 1];
          void mutate(['stages'], (w) => w.put('stages', newRecord<F<Stage>>({ editionId: id, order: (last?.order ?? 0) + 1, label: `Etappe ${(last?.order ?? 0) + 1}`, date: last?.date ?? edition.startDate, type: 'strasse' }) as Stage));
        }}>+ Etappe/Lauf</button>
      )}
      <p className="muted small">Halbetappen: Reihenfolge z. B. 3 und 3.5 mit Bezeichnung „Etappe 3a/3b“ – die Reihenfolge wird ausdrücklich gespeichert.</p>

      <h2>Teilnehmer ({parts.length}) <a className="small" href="#import">Startliste importieren</a></h2>
      <table className="table">
        <thead><tr><th>Nr.</th><th>Fahrer</th><th>Team (bei diesem Rennen)</th><th>Status</th><th>★</th></tr></thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}>
              <td>{p.bib}</td>
              <td><a href={`#fahrer-${p.riderId}`}>{riders.get(p.riderId)?.displayName}</a></td>
              <td>{p.teamName}</td>
              <td>
                <select value={p.status} onChange={(e) => savePart(p, { status: e.target.value as StartStatus })} aria-label="Startstatus">
                  {Object.entries(START_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td><input type="checkbox" checked={p.favorite} onChange={(e) => savePart(p, { favorite: e.target.checked })} aria-label="Favorit" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
