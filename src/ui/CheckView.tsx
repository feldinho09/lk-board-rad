import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, getDevice } from '../db/db';
import { onSwState } from './swClient';
import { useApp } from './state';
import { IS_ARTIFACT } from './host';

type Level = 'ok' | 'warn' | 'err' | 'info';
function Item({ level, title, children }: { level: Level; title: string; children?: React.ReactNode }) {
  const sym = { ok: '✓', warn: '!', err: '✕', info: 'i' }[level];
  return (
    <li className={`check ${level}`}>
      <span className="sym" aria-hidden>{sym}</span>
      <div><strong>{title}</strong>{children && <div className="small">{children}</div>}</div>
    </li>
  );
}

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-CH') : 'nie');

export function CheckView() {
  const app = useApp();
  const [sw, setSw] = useState({ controlled: false, supported: true });
  useEffect(() => onSwState(setSw), []);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [persistAsked, setPersistAsked] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted);
    navigator.storage?.estimate?.().then(setEstimate);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  const edition = useLiveQuery(() => (app.editionId ? db.editions.get(app.editionId) : undefined), [app.editionId]);
  const parts = useLiveQuery(() => (app.editionId ? db.participations.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? [];
  const riders = useLiveQuery(() => db.riders.bulkGet(parts.map((p) => p.riderId)), [parts]) ?? [];
  const missingPron = riders.filter((r) => r && !r.pronunciation).length;
  const runs = useLiveQuery(() => (app.editionId ? db.importRuns.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? [];
  const lastRun = [...runs].filter((r) => !r.undone).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lastPoint = useLiveQuery(() => db.restorePoints.orderBy('createdAt').last(), []);
  const lastDownload = useLiveQuery(() => getDevice<string | null>('lastDownloadAt', null), []);
  const pending = useLiveQuery(() => db.outbox.where('synced').equals(0).count(), []) ?? 0;
  const mb = (n?: number) => (n != null ? `${(n / 1024 / 1024).toFixed(1)} MB` : '?');

  return (
    <div className="page">
      <h1>Bereitschaftscheck</h1>
      <p className="muted">App-Version: <strong>{__BUILD_ID__}</strong></p>
      <ul className="checks">
        {IS_ARTIFACT ? (
          <Item level="warn" title="Web-Version (Claude-Artefakt): kein Start ohne Internet">
            Die App muss online geöffnet werden. Ist sie einmal geladen, funktioniert sie bei kurzem Netzausfall weiter; die Daten liegen in diesem Browser. Für echten Offline-Start: eigenes Hosting (siehe README).
          </Item>
        ) : (
          <Item level={sw.controlled ? 'ok' : 'err'} title={sw.controlled ? 'App-Code offline verfügbar' : 'App-Code NICHT offline verfügbar'}>
            {sw.controlled ? 'Service Worker aktiv. Test: Netzwerk trennen, Browser schließen, Adresse erneut öffnen.' : 'Seite einmal online neu laden. Im Privatmodus oder ohne HTTPS nicht möglich.'}
          </Item>
        )}
        <Item level={persisted ? 'ok' : 'warn'} title={persisted ? 'Dauerhafter Browserspeicher gewährt' : 'Dauerhafter Browserspeicher nicht bestätigt'}>
          {!persisted && <>Der Browser darf Daten unter Speicherdruck entfernen. <button className="small" onClick={async () => { const r = await navigator.storage?.persist?.(); setPersistAsked(!!r); setPersisted(!!r); }}>Anfordern</button>{persistAsked === false && <span className="warn"> Abgelehnt – externe Sicherung ist umso wichtiger.</span>}</>}
        </Item>
        <Item level="info" title={`Speicher: ${mb(estimate?.usage)} von ca. ${mb(estimate?.quota)} belegt`} />
        <Item level={edition ? 'ok' : 'err'} title={edition ? `Aktives Rennen: ${edition.name}` : 'Kein aktives Rennen gewählt'}>
          {edition && `${parts.length} Teilnehmer · ${missingPron} ohne Aussprachehinweis${edition.dataOrigin === 'demo' ? ' · DEMO-Daten' : ''}`}
        </Item>
        <Item level={lastRun && lastRun.deferredRows.length > 0 ? 'warn' : 'ok'} title={lastRun ? `Letzter Import: ${lastRun.sourceName}` : 'Kein Startlistenimport für dieses Rennen'}>
          {lastRun && `${lastRun.deferredRows.length} zurückgestellte/fehlerhafte Zeilen offen`}
        </Item>
        <Item level={lastPoint ? 'ok' : 'warn'} title={`Letzter lokaler Wiederherstellungspunkt: ${fmt(lastPoint?.createdAt)}`}>Liegt im selben Browserspeicher – schützt nicht vor Geräteverlust.</Item>
        <Item level={lastDownload && Date.now() - new Date(lastDownload).getTime() < 86400000 ? 'ok' : 'warn'} title={`Letzter Archiv-Download (zweites Ziel): ${fmt(lastDownload)}`}>
          Nicht nachweisbar extern abgelegt. <a href="#sicherung">Jetzt sichern</a>
        </Item>
        <Item level="info" title={`Synchronisierung: kein Server konfiguriert · ${pending} lokale Änderungen protokolliert`}>Rein lokaler Betrieb ist ein normaler Zustand. Der Sync-Server folgt in Etappe C.</Item>
        <Item level="warn" title="ProCyclingStats: kein autorisierter Zugang (externe Blockade)">Automatischer Import ist vorbereitet (Adaptervertrag), aber ohne Zugang nicht aktiv. Ergebnisse können bis dahin nicht automatisch aktualisiert werden.</Item>
        <Item level={online ? 'info' : 'ok'} title={online ? 'Netzwerk laut Browser verbunden' : 'Netzwerk getrennt – Offline-Betrieb'}>Ein Netzwerksymbol beweist keine erreichbare Gegenstelle.</Item>
      </ul>
    </div>
  );
}
