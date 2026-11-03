import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getDevice, setDevice, nowIso } from '../db/db';
import { backupFileName, buildArchive, createRestorePoint, restoreFull, verifyArchive, type VerifiedArchive } from '../backup/archive';
import { saveFile, IS_ARTIFACT } from './host';
import { useApp } from './state';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-CH') : 'nie');
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export async function backupNow(): Promise<string | null> {
  const { bytes } = await buildArchive();
  const r = await saveFile(bytes, backupFileName(), 'application/zip');
  if (!r.ok) return r.reason;
  // Ein ausgelöster Download ist KEIN Nachweis einer externen Sicherung – so wird es auch angezeigt.
  await setDevice('lastDownloadAt', nowIso());
  return null;
}

export function BackupView() {
  const app = useApp();
  const points = (useLiveQuery(() => db.restorePoints.orderBy('createdAt').reverse().toArray(), []) ?? []);
  const lastDownload = useLiveQuery(() => getDevice<string | null>('lastDownloadAt', null), []);
  const syncPaused = useLiveQuery(() => getDevice<{ reason: string; at: string } | null>('syncPaused', null), []);
  const [pending, setPending] = useState<VerifiedArchive | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const live = app.mode === 'live';

  const verify = async (bytes: Uint8Array) => {
    setErr(''); setMsg(''); setPending(null);
    try { setPending(await verifyArchive(bytes)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="page">
      <h1>Sicherung & Wiederherstellung</h1>
      {IS_ARTIFACT && <div className="banner warn">Web-Version: Deine Daten liegen nur in diesem Browser auf diesem Computer. Auf einem anderen Computer ist der Bestand leer – dorthin mit Archiv-Download und Wiederherstellung übertragen.</div>}
      <p className="muted">Speichern schützt vor Neustart, Sicherungen vor Löschung und Beschädigung. Browserdaten können vom Browser oder durch „Browserdaten löschen“ entfernt werden – deshalb regelmäßig ein Archiv außerhalb des Browsers ablegen (z. B. USB-Stick, Cloud-Ordner).</p>

      <section className="panel">
        <h2>Jetzt sichern</h2>
        <p>Letzter Archiv-Download ausgelöst: <strong>{fmt(lastDownload)}</strong> <span className="muted small">(ob die Datei tatsächlich extern abgelegt wurde, kann die App nicht prüfen)</span></p>
        <div className="row">
          <button disabled={busy} onClick={async () => { setBusy(true); try { const fail = await backupNow(); if (fail) setErr(fail); else setMsg('Archiv übergeben – bitte Download-Ordner prüfen und Datei extern ablegen (USB-Stick, Cloud-Ordner).'); } catch (e) { setErr(String(e)); } setBusy(false); }}>Gesamten Bestand als Archiv herunterladen</button>
          <button className="small" disabled={busy} onClick={async () => { setBusy(true); await createRestorePoint('Manuell'); setBusy(false); setMsg('Lokaler Wiederherstellungspunkt erstellt (liegt im selben Browserspeicher – keine unabhängige Sicherung).'); }}>Lokalen Wiederherstellungspunkt erstellen</button>
        </div>
      </section>

      <section className="panel">
        <h2>Archiv wiederherstellen</h2>
        {live ? <p>Im Live-Modus gesperrt.</p> : (
          <>
            <p className="muted small">Das Archiv wird zuerst vollständig geprüft (Prüfsummen, Format, Verweise). Erst nach Bestätigung wird – nach einer automatischen Sicherung des aktuellen Stands – atomar ersetzt. Danach bleibt die Synchronisierung pausiert.</p>
            <input type="file" accept=".zip" aria-label="Sicherungsarchiv wählen" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await verify(new Uint8Array(await f.arrayBuffer())); }} />
          </>
        )}
        {pending && (
          <div className="banner warn">
            <p><strong>Archiv geprüft:</strong> erstellt {fmt(pending.manifest.createdAt)}, Formatversion {pending.manifest.formatVersion}{pending.manifest.note ? ` · ${pending.manifest.note}` : ''}</p>
            <p>{Object.entries(pending.manifest.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n}`).join(' · ')}</p>
            <button onClick={async () => {
              setBusy(true);
              try { await restoreFull(pending); setPending(null); setMsg('Wiederhergestellt. Vorheriger Stand liegt als Wiederherstellungspunkt bereit.'); }
              catch (e) { setErr('Wiederherstellung abgebrochen, bisheriger Bestand unverändert: ' + String(e)); }
              setBusy(false);
            }} disabled={busy}>Aktuellen Bestand ersetzen</button>
            <button className="link" onClick={() => setPending(null)}>Abbrechen</button>
          </div>
        )}
        {syncPaused && <p className="warn small">Synchronisierung pausiert seit {fmt(syncPaused.at)} ({syncPaused.reason}).</p>}
      </section>

      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}

      <section className="panel">
        <h2>Lokale Wiederherstellungspunkte ({points.length})</h2>
        <p className="muted small">Automatisch vor Importen, Rücknahmen und Wiederherstellungen sowie alle 15 Minuten bei Änderungen. Die letzten 20 werden behalten, geschützte nie automatisch entfernt.</p>
        <table className="table compact">
          <thead><tr><th>Zeit</th><th>Anlass</th><th>Größe</th><th></th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{fmt(p.createdAt)}</td><td>{p.reason}{p.protected && <span className="tag">geschützt</span>}</td><td>{kb(p.sizeBytes)}</td>
                <td>
                  <button className="small" onClick={async () => { const r = await saveFile(p.data, backupFileName('lk-board-wiederherstellungspunkt'), 'application/zip'); if (!r.ok) setErr(r.reason); }}>Herunterladen</button>
                  <button className="small" onClick={() => db.restorePoints.update(p.id, { protected: !p.protected })}>{p.protected ? 'Schutz aufheben' : 'Schützen'}</button>
                  {!live && <button className="small" onClick={() => verify(p.data)}>Wiederherstellen …</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p><a href="#notfall">Notfallübersicht des aktiven Rennens öffnen</a></p>
    </div>
  );
}
