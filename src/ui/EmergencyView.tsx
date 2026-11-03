import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../db/db';
import type { Rider } from '../domain/types';
import { useApp } from './state';
import { bibSort } from './LiveView';
import { useRef, useState } from 'react';
import { IS_ARTIFACT, saveFile } from './host';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Druckbare Notfallübersicht. Private Notizen werden nicht aufgenommen. */
export function EmergencyView() {
  const app = useApp();
  const tableRef = useRef<HTMLTableElement>(null);
  const [msg, setMsg] = useState('');
  const edition = useLiveQuery(() => (app.editionId ? db.editions.get(app.editionId) : undefined), [app.editionId]);
  const parts = (useLiveQuery(() => (app.editionId ? db.participations.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? []).sort(bibSort);
  const riders = useLiveQuery(async () => new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((r): r is Rider => !!r).map((r) => [r.id, r])), [parts]) ?? new Map<string, Rider>();
  if (!edition) return <p style={{ padding: 20 }}>Kein aktives Rennen. <a href="#rennen">Zurück</a></p>;
  return (
    <div className="emergency">
      <div className="no-print row">
        <a href="#live">← zurück</a>
        {!IS_ARTIFACT && <button onClick={() => window.print()}>Drucken / als PDF speichern</button>}
        <button onClick={async () => {
          const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(edition.name)} – Notfallübersicht</title><style>body{font:14px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}</style></head><body>${tableRef.current?.parentElement?.innerHTML.replace(/<div class="no-print[\s\S]*?<\/div>/, '') ?? ''}</body></html>`;
          const r = await saveFile(html, `notfall_${edition.name.replace(/[^\w-]+/g, '_')}.html`, 'text/html');
          setMsg(r.ok ? 'Datei übergeben – im Browser öffnen und dort drucken.' : r.reason);
        }}>Als HTML-Datei herunterladen (zum Drucken)</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      <h1>{edition.name} – Notfallübersicht</h1>
      <p className="small">Stand {new Date().toLocaleString('de-CH')}{edition.dataOrigin === 'demo' ? ' · DEMO, fiktive Daten' : ''}</p>
      <table className="table print" ref={tableRef}>
        <thead><tr><th>Nr.</th><th>Name</th><th>Team</th><th>Aussprache</th><th>Schlüsselfakten</th></tr></thead>
        <tbody>
          {parts.map((p) => {
            const r = riders.get(p.riderId);
            return (
              <tr key={p.id}>
                <td><strong>{p.bib}</strong></td>
                <td>{p.overrides.displayName ?? r?.displayName}{p.status !== 'aktiv' && p.status !== 'gemeldet' ? ` (${p.status})` : ''}</td>
                <td>{p.teamName}</td>
                <td>{p.overrides.pronunciation ?? r?.pronunciation ?? ''}</td>
                <td>{r?.keyFacts.slice(0, 3).join(' · ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
