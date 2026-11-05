import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate } from '../db/db';
import type { Rider } from '../domain/types';
import { lookupRiders, applyLookup, type Candidate, type LookupResult } from '../import/wikidata';
import { createRestorePoint } from '../backup/archive';
import { IS_ARTIFACT } from './host';
import { useApp } from './state';

type Scope = 'fehlend' | 'rennen' | 'alle';
const STATUS_TXT = { sicher: 'eindeutig', mehrdeutig: 'bitte wählen', nicht_gefunden: 'nicht gefunden', fehler: 'Fehler' } as const;

/** Land und Geburtsdatum aus Wikidata (Wikipedia) ergänzen – mit Vorschau und Bestätigung. */
export function WikidataPanel() {
  const app = useApp();
  const riders = useLiveQuery(() => db.riders.toArray().then((rs) => alive(rs).filter((r) => !r.mergedInto && !r.archived)), []) ?? [];
  const raceRiderIds = useLiveQuery(async () => (app.editionId ? new Set(alive(await db.participations.where('editionId').equals(app.editionId).toArray()).map((p) => p.riderId)) : new Set<string>()), [app.editionId]) ?? new Set<string>();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('fehlend');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({}); // riderId -> qid | ''
  const [overwrite, setOverwrite] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);

  const scoped = useMemo(() => {
    if (scope === 'fehlend') return riders.filter((r) => !r.nationality || !r.birthDate || r.birthDate.length === 4);
    if (scope === 'rennen') return riders.filter((r) => raceRiderIds.has(r.id));
    return riders;
  }, [riders, scope, raceRiderIds]);

  const start = async () => {
    setErr(''); setMsg(''); setResults(null);
    if (!navigator.onLine) return setErr('Keine Internetverbindung – der Abgleich mit Wikipedia/Wikidata geht nur online.');
    if (scoped.length > 600) return setErr(`${scoped.length} Fahrer sind für einen Durchgang zu viele. Bitte „Teilnehmer des aktiven Rennens“ wählen.`);
    abort.current = new AbortController();
    setProgress([0, scoped.length * 2]);
    try {
      const res = await lookupRiders(scoped, { signal: abort.current.signal, onProgress: (d, t) => setProgress([d, t]) });
      setResults(res);
      setChoice(Object.fromEntries(res.map((r) => [r.riderId, r.status === 'sicher' && r.conflicts.length === 0 ? r.chosen!.qid : ''])));
    } catch (e) {
      setErr((e as Error).name === 'AbortError' ? 'Abgebrochen.' : `Abruf fehlgeschlagen: ${(e as Error).message}. Bereits Gespeichertes ist unverändert.`);
    }
    setProgress(null);
  };

  const apply = async () => {
    if (!results) return;
    const byId = new Map(riders.map((r) => [r.id, r]));
    const updates: Rider[] = [];
    for (const res of results) {
      const qid = choice[res.riderId];
      const cand = res.candidates.find((c) => c.qid === qid);
      const r = byId.get(res.riderId);
      if (!cand || !r) continue;
      const next = applyLookup(r, cand, overwrite);
      if (next.birthDate !== r.birthDate || next.nationality !== r.nationality || next.externalIds.length !== r.externalIds.length || next.sources !== r.sources) updates.push(next);
    }
    if (!updates.length) return setMsg('Nichts zu übernehmen.');
    await createRestorePoint(`Vor Wikidata-Ergänzung (${updates.length} Fahrer)`);
    await mutate(['riders'], async (w) => { for (const u of updates) await w.put('riders', u); });
    setMsg(`${updates.length} Fahrerprofile ergänzt. Quelle und Wikidata-ID sind im Profil vermerkt. Vorher wurde ein Wiederherstellungspunkt angelegt.`);
    setResults(null);
  };

  if (!open) {
    return (
      <div className="row">
        <button onClick={() => setOpen(true)} disabled={IS_ARTIFACT} title={IS_ARTIFACT ? 'In der Claude-Artefakt-Fassung nicht möglich' : ''}>Land &amp; Geburtsdatum aus Wikipedia ergänzen …</button>
      </div>
    );
  }
  const selected = results ? Object.values(choice).filter(Boolean).length : 0;
  const counts = results?.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});

  return (
    <section className="panel wikidata">
      <div className="panel-head"><h2>Land &amp; Geburtsdatum aus Wikipedia (Wikidata)</h2><button className="link" onClick={() => { abort.current?.abort(); setOpen(false); }}>schließen</button></div>
      <p className="small muted">Abgefragt wird Wikidata, die Datenbank hinter den Wikipedia-Infoboxen. Übernommen wird nur, was du bestätigst. Land = Sportnation im Radsport-/IOC-Kürzel (z. B. SUI, GER, SLO). Datum nur so genau, wie Wikidata es kennt.</p>
      <div className="row">
        <label><input type="radio" checked={scope === 'fehlend'} onChange={() => setScope('fehlend')} /> Fahrer ohne Land oder vollständiges Geburtsdatum</label>
        <label><input type="radio" checked={scope === 'rennen'} onChange={() => setScope('rennen')} disabled={!app.editionId} /> Teilnehmer des aktiven Rennens</label>
        <label><input type="radio" checked={scope === 'alle'} onChange={() => setScope('alle')} /> Alle Fahrer</label>
        <strong>{scoped.length} Fahrer</strong>
        {!progress && <button onClick={start} disabled={!scoped.length}>Suchen</button>}
        {progress && <><progress max={progress[1]} value={progress[0]} /> <button className="link" onClick={() => abort.current?.abort()}>Abbrechen</button></>}
      </div>
      {err && <div className="banner err">{err}</div>}
      {msg && <div className="banner ok">{msg}</div>}
      {results && (
        <>
          <p>{counts?.sicher ?? 0} eindeutig · {counts?.mehrdeutig ?? 0} zu prüfen · {counts?.nicht_gefunden ?? 0} nicht gefunden</p>
          <div className="scroll-x" style={{ maxHeight: '55vh' }}>
            <table className="table compact">
              <thead><tr><th>Fahrer</th><th>Wikidata-Eintrag</th><th>Land</th><th>Geburtsdatum</th><th>Status</th></tr></thead>
              <tbody>
                {results.map((res) => {
                  const r = riders.find((x) => x.id === res.riderId);
                  const cand = res.candidates.find((c) => c.qid === choice[res.riderId]);
                  return (
                    <tr key={res.riderId} className={res.conflicts.length ? 'warnrow' : ''}>
                      <td>{res.riderName}</td>
                      <td>
                        {res.candidates.length === 0 ? <span className="muted">–</span> : (
                          <select aria-label={`Eintrag für ${res.riderName}`} value={choice[res.riderId] ?? ''} onChange={(e) => setChoice({ ...choice, [res.riderId]: e.target.value })}>
                            <option value="">nicht übernehmen</option>
                            {res.candidates.map((c) => <option key={c.qid} value={c.qid}>{candLabel(c)}</option>)}
                          </select>
                        )}
                        {cand && <> <a href={`https://www.wikidata.org/wiki/${cand.qid}`} target="_blank" rel="noopener noreferrer" className="small">{cand.qid} ↗</a></>}
                      </td>
                      <td>{diff(r?.nationality, cand?.nationality, res.conflicts.includes('nationality'))}{cand && !cand.nationality && cand.nationalityAll.length > 1 && <span className="small muted"> (mehrere: {cand.nationalityAll.join(', ')})</span>}</td>
                      <td>{diff(r?.birthDate, cand?.birthDate, res.conflicts.includes('birthDate'))}</td>
                      <td className="small">{STATUS_TXT[res.status]}{res.message ? ` – ${res.message}` : ''}{res.conflicts.length ? ' – weicht von vorhandener Angabe ab' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <label className="confirm"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Abweichende vorhandene Angaben überschreiben (sonst werden nur leere Felder gefüllt)</label>
            <button onClick={apply} disabled={!selected}>{selected} übernehmen</button>
          </div>
        </>
      )}
    </section>
  );
}

function candLabel(c: Candidate): string {
  return `${c.label} – ${c.description || 'ohne Beschreibung'}${c.birthDate ? ` (${c.birthDate.slice(0, 4)})` : ''}`;
}
function diff(old: string | undefined, neu: string | undefined, conflict: boolean) {
  if (!neu) return <span className="muted">{old ?? '–'}</span>;
  if (!old || old === neu) return <strong>{neu}</strong>;
  return <span className={conflict ? 'warn' : ''}>{old} → <strong>{neu}</strong></span>;
}
