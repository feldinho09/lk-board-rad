import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, onSaveState, type SaveState } from '../db/db';
import type { Stage } from '../domain/types';
import { AppStateProvider, useApp, useRoute, isTyping } from './state';
import { onSwState, applyUpdate } from './swClient';
import { RaceClock } from './RaceClock';
import { SearchDialog } from './SearchDialog';
import { openLiveSearch } from './LiveSearch';
import { LiveView } from './LiveView';
import { RacesView } from './RacesView';
import { RidersView } from './RidersView';
import { ImportView } from './ImportView';
import { BackupView } from './BackupView';
import { CheckView } from './CheckView';
import { ExportView } from './ExportView';
import { EmergencyView } from './EmergencyView';
import { createRestorePoint } from '../backup/archive';
import { DialogHost, confirmDialog } from './dialogs';
import { IS_ARTIFACT } from './host';
import { TissotBadge, useTissotAutoSync } from './TissotPanel';

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

const NAV: [string, string][] = [
  ['live', 'Live'],
  ['rennen', 'Rennen'],
  ['fahrer', 'Fahrer'],
  ['import', 'Import'],
  ['sicherung', 'Sicherung'],
  ['export', 'PDF'],
  ['check', 'Bereitschaft'],
];

function Shell() {
  const app = useApp();
  const [route, go] = useRoute();
  const [searchOpen, setSearchOpen] = useState<false | string>(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const overlayOpen = useRef(false);
  overlayOpen.current = searchOpen !== false || helpOpen;

  useEffect(() => {
    /** Suche öffnen: im Live-Modus das zentrale Feld über der Fahrerkarte, sonst den Dialog. */
    const startSearch = (initial: string) => {
      if (document.querySelector('.live-search input')) openLiveSearch(initial);
      else setSearchOpen(initial);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startSearch('');
        return;
      }
      if (e.key === 'Escape') { setSearchOpen(false); setHelpOpen(false); return; }
      // Einzeltasten nur, wenn nicht gerade geschrieben wird und kein Dialog offen ist
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || overlayOpen.current) return;
      if (e.key === '?') { setHelpOpen(true); return; }
      if (e.key === '/' || e.key === 's' || e.key === 'S') { e.preventDefault(); startSearch(''); return; }
      // Ziffer = Startnummernsuche direkt beginnen (z. B. „2“ „1“ Enter)
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); startSearch(e.key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useAutoRestorePoints();
  useTissotAutoSync();

  if (!app.ready) return <div className="loading">Lade lokalen Datenbestand …</div>;
  if (app.storageError) return (
    <div className="loading" role="alert">
      <h2>Browserspeicher nicht verfügbar</h2>
      <p>Dieser Browser erlaubt der App keinen dauerhaften Speicher (z. B. Privatmodus oder blockierte Website-Daten). Ohne Speicher kann nichts sicher abgelegt werden.</p>
      <p className="muted small">{app.storageError}</p>
    </div>
  );
  const page = route[0];
  if (page === 'notfall') return <EmergencyView />;

  return (
    <div className={`shell mode-${app.mode}`}>
      <Header page={page} go={go} onSearch={() => (document.querySelector('.live-search input') ? openLiveSearch('') : setSearchOpen(''))} onHelp={() => setHelpOpen(true)} />
      <DemoBanner />
      <SaveErrorBanner />
      <main className="main">
        {page === 'live' && <LiveView />}
        {page === 'rennen' && <RacesView id={route[1]} />}
        {page === 'fahrer' && <RidersView id={route[1]} />}
        {page === 'import' && <ImportView />}
        {page === 'sicherung' && <BackupView />}
        {page === 'check' && <CheckView />}
        {page === 'export' && <ExportView />}
      </main>
      {searchOpen !== false && <SearchDialog initial={searchOpen} onClose={() => setSearchOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      <DialogHost />
    </div>
  );
}

/** Alle 15 Minuten ein lokaler Wiederherstellungspunkt, aber nur wenn sich etwas geändert hat. */
function useAutoRestorePoints() {
  useEffect(() => {
    const INTERVAL = 15 * 60 * 1000;
    const t = setInterval(async () => {
      try {
        const last = await db.restorePoints.orderBy('createdAt').last();
        if (last && Date.now() - new Date(last.createdAt).getTime() < INTERVAL) return;
        const changes = await db.outbox.where('at').above(last?.createdAt ?? '').count();
        if (changes > 0) await createRestorePoint('Automatisch (15 min)');
      } catch (e) {
        console.warn('Automatischer Wiederherstellungspunkt fehlgeschlagen', e);
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
}

function Header({ page, go, onSearch, onHelp }: { page: string; go: (p: string) => void; onSearch: () => void; onHelp: () => void }) {
  const app = useApp();
  const editions = useLiveQuery(() => db.editions.toArray().then(alive), []) ?? [];
  const stages = useLiveQuery(
    () => (app.editionId ? db.stages.where('editionId').equals(app.editionId).toArray().then(alive) : Promise.resolve([] as Stage[])),
    [app.editionId],
  ) ?? [];
  const sortedStages = [...stages].sort((a, b) => a.order - b.order);
  const edition = editions.find((e) => e.id === app.editionId);
  const pending = useLiveQuery(() => db.outbox.where('synced').equals(0).count(), []) ?? 0;
  const [sw, setSw] = useState<{ controlled: boolean; updateWaiting: boolean }>({ controlled: false, updateWaiting: false });
  useEffect(() => onSwState(setSw), []);
  const live = app.mode === 'live';

  const changeEdition = async (id: string) => {
    if (live && app.editionId && id !== app.editionId && !(await confirmDialog('Im Live-Modus das aktive Rennen wechseln?', 'Rennen wechseln'))) return;
    app.setEdition(id || null);
  };

  return (
    <header className="header">
      <div className="brand" title={`LK Board Rad · Version ${__BUILD_ID__}`}>LK&nbsp;Board <span className="build">{__BUILD_ID__.split(' · ')[0]}</span></div>
      <div className="race-select">
        <select aria-label="Aktives Rennen" value={app.editionId ?? ''} onChange={(e) => changeEdition(e.target.value)}>
          <option value="">– Rennen wählen –</option>
          {editions.filter((e) => e.status !== 'archiviert').map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {edition?.format === 'etappen' && (
          <select aria-label="Etappe" value={app.stageId ?? ''} onChange={(e) => app.setStage(e.target.value || null)}>
            <option value="">– Etappe –</option>
            {sortedStages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>
      <div className="mode-switch" role="group" aria-label="Modus">
        <button className={!live ? 'on' : ''} onClick={() => app.setMode('bearbeiten')} aria-pressed={!live}>Bearbeiten</button>
        <button className={live ? 'on is-live' : ''} onClick={() => { app.setMode('live'); go('live'); }} aria-pressed={live}>● Live</button>
      </div>
      <RaceClock />
      <button className="search-btn" onClick={onSearch} title="Suche (Strg/Cmd+K)">Suche <kbd>Strg K</kbd></button>
      {!live && (
        <nav className="nav">
          {NAV.map(([p, label]) => (
            <a key={p} href={`#${p}`} className={page === p ? 'active' : ''}>{label}</a>
          ))}
        </nav>
      )}
      {live && <nav className="nav"><a href="#live" className={page === 'live' ? 'active' : ''}>Live</a><a href="#export" className={page === 'export' ? 'active' : ''}>PDF</a><a href="#check" className={page === 'check' ? 'active' : ''}>Bereitschaft</a></nav>}
      <div className="status">
        <SaveIndicator />
        <TissotBadge />
        <span className="badge" title="Lokale Änderungen, die noch nicht mit einem Server abgeglichen wurden. Kein Server konfiguriert = normaler rein lokaler Betrieb.">
          Sync: kein Server · {pending} lokal
        </span>
        {IS_ARTIFACT ? (
          <span className="badge" title="Claude-Artefakt: Daten liegen in diesem Browser; ein Start ohne Internet ist hier nicht möglich">Web-Version</span>
        ) : (
          <span className={`badge ${sw.controlled ? 'ok' : 'warn'}`} title="Anwendungscode offline verfügbar?">
            {sw.controlled ? 'Offline bereit' : 'Offline nicht bereit'}
          </span>
        )}
        {sw.updateWaiting && !live && <button className="badge warn" onClick={applyUpdate}>Update bereit – neu laden</button>}
        {sw.updateWaiting && live && <span className="badge" title="Wird nach Live angeboten">Update vorbereitet</span>}
        <select aria-label="Darstellung" value={app.theme} onChange={(e) => app.setTheme(e.target.value as never)} className="small">
          <option value="dunkel">Dunkel</option><option value="hell">Hell</option><option value="kontrast">Hoher Kontrast</option>
        </select>
        <button className="icon" onClick={() => app.setFontScale(app.fontScale === 'gross' ? 'normal' : 'gross')} aria-pressed={app.fontScale === 'gross'} title="Große Schrift" aria-label="Große Schrift">A+</button>
        <button className="icon" onClick={onHelp} title="Tastenkürzel (?)" aria-label="Hilfe">?</button>
      </div>
    </header>
  );
}

function SaveIndicator() {
  const [s, setS] = useState<SaveState>({ kind: 'idle' });
  useEffect(() => onSaveState(setS), []);
  if (s.kind === 'error') return <span className="badge err" role="alert">✕ Speicherfehler</span>;
  if (s.kind === 'ok') return <span className="badge ok" title={`Zuletzt ${new Date(s.at).toLocaleTimeString('de-CH')}`}>✓ Lokal gespeichert</span>;
  return <span className="badge">Bereit</span>;
}

function SaveErrorBanner() {
  const [s, setS] = useState<SaveState>({ kind: 'idle' });
  useEffect(() => onSaveState(setS), []);
  if (s.kind !== 'error') return null;
  return (
    <div className="banner err" role="alert">
      <strong>Speichern fehlgeschlagen</strong> ({new Date(s.at).toLocaleTimeString('de-CH')}): {s.message}. Die letzte Eingabe wurde NICHT gespeichert.
      Text bleibt im Eingabefeld erhalten. Bitte Speicherplatz prüfen und unter „Sicherung“ exportieren.
    </div>
  );
}

function DemoBanner() {
  const app = useApp();
  const ed = useLiveQuery(() => (app.editionId ? db.editions.get(app.editionId) : undefined), [app.editionId]);
  if (ed?.dataOrigin !== 'demo') return null;
  return <div className="banner demo">DEMO-RENNEN · alle Personen, Teams und Resultate sind frei erfunden</div>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Tastenkürzel" onClick={(e) => e.stopPropagation()}>
        <h2>Tastenkürzel</h2>
        <table className="table">
          <tbody>
            <tr><td><kbd>0</kbd>–<kbd>9</kbd></td><td>Startnummer direkt eintippen, <kbd>Enter</kbd> wählt den Fahrer</td></tr>
            <tr><td><kbd>S</kbd>, <kbd>/</kbd> oder <kbd>Strg/Cmd</kbd>+<kbd>K</kbd></td><td>Suche (Name, auch ohne Akzente)</td></tr>
            <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Startliste durchgehen (wenn Liste fokussiert)</td></tr>
            <tr><td><kbd>P</kbd></td><td>Ausgewählten Fahrer anheften / lösen</td></tr>
            <tr><td><kbd>F</kbd></td><td>Favorit umschalten</td></tr>
            <tr><td><kbd>N</kbd></td><td>Ereignis/Notiz schreiben</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Dialog schließen</td></tr>
            <tr><td><kbd>?</kbd></td><td>Diese Hilfe</td></tr>
          </tbody>
        </table>
        <p className="muted">Kürzel sind deaktiviert, solange in ein Textfeld geschrieben wird.</p>
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
