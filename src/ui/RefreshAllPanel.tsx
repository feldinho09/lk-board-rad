import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setDevice } from '../db/db';
import { refreshAllRiders, type RefreshReport } from '../import/refreshAll';

const KEY = 'refreshAllLast';

/** Ein Knopf: alle Fahrer aus Tissot Timing und Wikipedia auf den neuesten Stand bringen. */
export function RefreshAllPanel() {
  const last = useLiveQuery(() => db.device.get(KEY).then((r) => r?.value as RefreshReport | undefined), []);
  const [tissot, setTissot] = useState(true);
  const [wikipedia, setWikipedia] = useState(true);
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState<RefreshReport | null>(null);

  const run = async () => {
    setReport(null); setBusy('Start …');
    try {
      const r = await refreshAllRiders({ tissot, wikipedia }, (phase, d, t) => setBusy(`${phase}: ${d} von ${t} …`));
      setReport(r);
      await setDevice(KEY, r);
    } catch (e) {
      setReport({ riders: 0, errors: [e instanceof Error ? e.message : String(e)], at: new Date().toISOString() });
    }
    setBusy('');
  };
  const shown = report ?? last;

  return (
    <section className="panel refresh-all">
      <div className="row">
        <button className="primary" onClick={run} disabled={!!busy || (!tissot && !wikipedia)}>Alle aktualisieren</button>
        <label className="confirm"><input type="checkbox" checked={tissot} onChange={(e) => setTissot(e.target.checked)} /> Tissot Timing (Palmarès, Geburtsdaten)</label>
        <label className="confirm"><input type="checkbox" checked={wikipedia} onChange={(e) => setWikipedia(e.target.checked)} /> Wikipedia (Kurzbio, Grösse, Gewicht, Wohnort)</label>
        {!busy && last && <span className="small muted">Zuletzt: {new Date(last.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</span>}
      </div>
      <p className="small muted">Für alle erfassten Fahrer. Füllt nur leere Felder, ersetzt das Palmarès durch den neuesten Stand. Wikipedia nur bei eindeutiger Zuordnung, nur wo etwas fehlt, pro Fahrer höchstens alle 30 Tage und höchstens 1000 Fahrer pro Klick (Fahrer aus Rennen zuerst). Vorher entsteht ein Wiederherstellungspunkt. Dauert je nach Anzahl Fahrer einige Minuten; das Board bleibt dabei bedienbar. ProCyclingStats ist nicht dabei (nur kopierte Seiten erlaubt).</p>
      {busy && <div className="banner warn" role="status">{busy}</div>}
      {shown && !busy && <RefreshSummary r={shown} fresh={!!report} />}
    </section>
  );
}

function RefreshSummary({ r, fresh }: { r: RefreshReport; fresh: boolean }) {
  const lines: string[] = [];
  if (r.tissot) {
    lines.push(`Tissot: ${r.tissot.palmares} Palmarès aktualisiert, ${r.tissot.profiles} Profile ergänzt${r.tissot.withoutUci ? `, ${r.tissot.withoutUci} Fahrer ohne UCI-ID übersprungen` : ''}.`);
  }
  if (r.wikipedia) {
    const w = r.wikipedia;
    lines.push(`Wikipedia: ${w.checked} Fahrer nachgeschlagen, ${w.updated} Profile ergänzt${w.notFound ? `, ${w.notFound} ohne Eintrag` : ''}${w.skippedRecent ? `, ${w.skippedRecent} in den letzten 30 Tagen schon geprüft` : ''}.${w.remaining ? ` Noch ${w.remaining} offen – nochmals klicken.` : ''}`);
  }
  const unclear = r.wikipedia?.unclear ?? [];
  const failed = [...(r.tissot?.failed ?? []), ...(r.wikipedia?.failed ?? [])];
  return (
    <div className={`banner ${r.errors.length ? 'err' : 'ok'}`}>
      {fresh ? 'Fertig. ' : 'Letzter Lauf: '}{r.riders} Fahrer. {lines.join(' ')}
      {unclear.length > 0 && <div className="small">Nicht eindeutig (bitte unten mit „Infos aus Wikipedia ergänzen“ selbst wählen): {unclear.slice(0, 8).join(', ')}{unclear.length > 8 ? ` und ${unclear.length - 8} weitere` : ''}</div>}
      {failed.length > 0 && <div className="small warn">Nicht möglich: {failed.slice(0, 6).join(', ')}{failed.length > 6 ? ' …' : ''}</div>}
      {r.errors.map((e, i) => <div key={i} className="small">{e}</div>)}
    </div>
  );
}
