import { useEffect, useState } from 'react';
import { onSaveState, type SaveState } from '../db/db';
import { onSwState, applyUpdate } from './swClient';
import { DialogHost } from './dialogs';
import { FormatToolbar } from './rich';
import { go, stageLabel, useCurrent, useRoute } from './state';
import { RidersView } from './RidersView';
import { RacesView } from './RacesView';
import { TopicsView } from './TopicsView';
import { LiveView } from './LiveView';
import { PdfView } from './PdfView';
import { BackupView } from './BackupView';
import { SearchDialog } from './SearchDialog';

const TABS = [
  ['live', 'LIVE'], ['fahrer', 'Fahrer'], ['rennen', 'Rennen'], ['themen', 'Themen'], ['pdf', 'PDF'], ['sicherung', 'Sicherung'],
] as const;

export function App() {
  const route = useRoute();
  const [search, setSearch] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return (
    <>
      <Header view={route.view} onSearch={() => setSearch(true)} />
      {route.view === 'live' && <LiveView />}
      {route.view === 'fahrer' && <RidersView id={route.id} />}
      {route.view === 'rennen' && <RacesView id={route.id} />}
      {route.view === 'themen' && <TopicsView id={route.id} />}
      {route.view === 'pdf' && <PdfView />}
      {route.view === 'sicherung' && <BackupView />}
      {search && <SearchDialog onClose={() => setSearch(false)} />}
      <FormatToolbar />
      <DialogHost />
    </>
  );
}

function Header({ view, onSearch }: { view: string; onSearch: () => void }) {
  const cur = useCurrent();
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [sw, setSw] = useState({ controlled: false, updateWaiting: false });
  useEffect(() => onSaveState(setSave), []);
  useEffect(() => onSwState(setSw), []);
  return (
    <header className="top">
      <div className="top-1">
        <span className="brand">RAD COMMAND CENTER<small>{__BUILD_ID__.split(' ')[0]}</small></span>
        <select aria-label="Rennen" value={cur.race?.id ?? ''} onChange={(e) => cur.setRace(e.target.value)} disabled={!cur.races.length}>
          {!cur.races.length && <option value="">– noch kein Rennen –</option>}
          {cur.races.map((r) => <option key={r.id} value={r.id}>{r.name} {r.year}</option>)}
        </select>
        {cur.race && cur.race.kind === 'rundfahrt' && (
          <select aria-label="Etappe" value={cur.stage?.number ?? ''} onChange={(e) => cur.setStage(Number(e.target.value))}>
            {cur.stages.map((s) => <option key={s.id} value={s.number}>{stageLabel(s)}{s.finish ? ` – ${s.finish}` : ''}</option>)}
          </select>
        )}
        <button className="btn small" onClick={onSearch} title="Suche (Strg K)">Suche <kbd className="muted small">Strg K</kbd></button>
        <span className="grow" />
        {save.kind === 'ok' && <span className="badge ok" title={`Zuletzt gespeichert ${new Date(save.at).toLocaleTimeString('de-CH')}`}>✓ Gespeichert</span>}
        {save.kind === 'error' && <span className="badge err" role="alert" title={save.message}>Speichern fehlgeschlagen</span>}
        <span className={`badge ${sw.controlled ? 'ok' : ''}`} title="Startet auch ohne Internet">{sw.controlled ? 'Offline bereit' : 'Offline noch nicht bereit'}</span>
        {sw.updateWaiting && view !== 'live' && <button className="badge warn update-ready" onClick={applyUpdate} title="Lädt die neue Version. Deine Daten bleiben erhalten.">Neue Version – jetzt laden</button>}
        {sw.updateWaiting && view === 'live' && <span className="badge" title="Wird ausserhalb von LIVE angeboten">Update bereit</span>}
      </div>
      <nav className="tabs" aria-label="Bereiche">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#${k}`} className={`tab ${k === 'live' ? 'is-live' : ''} ${view === k ? 'on' : ''}`} aria-current={view === k ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
    </header>
  );
}

export { go };
