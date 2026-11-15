import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setDevice } from '../db/db';
import { backupFileName, buildArchive, createRestorePoint, restoreFull, restorePoint, verifyArchive, type VerifiedArchive } from '../backup/archive';
import { saveFile } from './host';
import { confirmDialog } from './dialogs';
import { fmtDate } from './state';

const LABEL: Record<string, string> = { riders: 'Fahrer', races: 'Rennen', stages: 'Etappen', entries: 'Startlisten-Einträge', topics: 'Themen' };

export function BackupView() {
  const points = useLiveQuery(() => db.restorePoints.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const lastDownload = useLiveQuery(() => db.device.get('lastBackupDownload').then((r) => r?.value as string | undefined), []);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, setPending] = useState<VerifiedArchive | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersist);
    void navigator.storage?.estimate?.().then((e) => setUsage(e.usage != null ? `${(e.usage / 1024 / 1024).toFixed(1)} MB belegt` : ''));
  }, []);

  const download = async () => {
    const { bytes } = await buildArchive();
    const r = await saveFile(bytes, backupFileName(), 'application/zip');
    if (r.ok) { await setDevice('lastBackupDownload', new Date().toISOString()); setMsg({ kind: 'ok', text: 'Sicherung heruntergeladen. Bewahre sie ausserhalb dieses Browsers auf (z. B. OneDrive, USB-Stick).' }); }
    else setMsg({ kind: 'err', text: r.reason });
  };
  const pick = async (f: File | undefined) => {
    setMsg(null); setPending(null);
    if (!f) return;
    try { setPending(await verifyArchive(new Uint8Array(await f.arrayBuffer()))); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
  };
  const restore = async () => {
    if (!pending) return;
    if (!(await confirmDialog('Den aktuellen Bestand durch die Sicherung ersetzen? Vorher wird automatisch ein Wiederherstellungspunkt angelegt.', 'Wiederherstellen'))) return;
    await restoreFull(pending);
    setPending(null);
    setMsg({ kind: 'ok', text: 'Sicherung wiederhergestellt.' });
  };

  return (
    <main style={{ maxWidth: 900 }}>
      <div className="panel">
        <h2>Sicherung herunterladen</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Alle Daten liegen nur in diesem Browser. Lade regelmässig eine Sicherung herunter – sie enthält alle Fahrer, Rennen, Startlisten und Themen (ZIP mit Prüfsummen und einer offen lesbaren Fahrerliste).</p>
        <div className="row">
          <button className="btn primary" onClick={download}>Sicherung herunterladen</button>
          <span className="small muted">{lastDownload ? `Zuletzt: ${fmtDate(lastDownload, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Noch nie heruntergeladen'}</span>
        </div>
        <p className="small" style={{ marginBottom: 0 }}>
          Speicher: {persist === true ? <span className="okc">dauerhaft gewährt</span> : persist === false ? <><span className="warn">nicht dauerhaft</span> <button className="linkbtn" onClick={async () => setPersist((await navigator.storage?.persist?.()) ?? false)}>dauerhaft anfordern</button></> : 'unbekannt'}{usage ? ` · ${usage}` : ''}
        </p>
      </div>

      <div className="panel">
        <h2>Sicherung wiederherstellen</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Die Datei wird zuerst vollständig geprüft. Erst nach deiner Bestätigung wird der Bestand ersetzt.</p>
        <input type="file" accept=".zip" onChange={(e) => pick(e.target.files?.[0])} aria-label="Sicherungsdatei wählen" />
        {pending && (
          <div className="banner ok">
            Geprüft: Sicherung vom {fmtDate(pending.manifest.createdAt, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })} mit {Object.entries(pending.manifest.counts).map(([k, n]) => `${n} ${LABEL[k] ?? k}`).join(', ')}.
            {pending.warnings.map((w, i) => <div key={i} className="warn small">{w}</div>)}
            <div className="row" style={{ marginTop: 8 }}><button className="btn primary small" onClick={restore}>Wiederherstellen</button><button className="btn small" onClick={() => setPending(null)}>Abbrechen</button></div>
          </div>
        )}
      </div>

      {msg && <div className={`banner ${msg.kind}`} role="status">{msg.text}</div>}

      <div className="panel">
        <div className="row"><h2 className="grow">Wiederherstellungspunkte</h2><button className="btn small" onClick={async () => { await createRestorePoint('Von Hand'); setMsg({ kind: 'ok', text: 'Wiederherstellungspunkt angelegt.' }); }}>Jetzt anlegen</button></div>
        <p className="small muted" style={{ marginTop: 0 }}>Automatisch vor jeder Startliste, PCS-Übernahme, Löschung und Wiederherstellung. Die letzten 20 bleiben erhalten.</p>
        <table className="tbl">
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.createdAt, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{p.reason}</td>
                <td className="small muted">{(p.sizeBytes / 1024).toFixed(0)} KB</td>
                <td><button className="btn small" onClick={async () => { if (await confirmDialog(`Stand „${p.reason}“ zurückspielen? Der aktuelle Stand wird vorher gesichert.`, 'Zurückspielen')) { await restorePoint(p.id); setMsg({ kind: 'ok', text: 'Stand zurückgespielt.' }); } }}>Zurückspielen</button></td>
              </tr>
            ))}
            {!points.length && <tr><td className="muted small">Noch keine.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
