import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate } from '../db/db';
import type { Rider } from '../domain/types';
import { createRestorePoint } from '../backup/archive';
import { applyPcsPage, pageMatchesRider, parsePcsRiderPages, teamSpans, type PcsRiderPage } from '../import/pcsRider';

export const pcsRiderUrl = (r: Rider) => {
  const slug = r.externalIds.find((e) => e.ns === 'pcs')?.value;
  return slug ? `https://www.procyclingstats.com/rider/${encodeURIComponent(slug)}` : `https://www.procyclingstats.com/search.php?term=${encodeURIComponent(r.displayName)}`;
};

interface Row { page: PcsRiderPage; rider?: Rider; changes: string[]; next?: Rider; ok: boolean }

const changesOf = (a: Rider, b: Rider): string[] => {
  const c: string[] = [];
  if (a.displayName !== b.displayName) c.push(`Schreibweise ${b.displayName}`);
  if (a.birthDate !== b.birthDate) c.push(`geb. ${b.birthDate}`);
  if (a.nationality !== b.nationality) c.push(`Nation ${b.nationality}`);
  if (a.birthPlace !== b.birthPlace) c.push(`Geburtsort ${b.birthPlace}`);
  if (a.heightCm !== b.heightCm) c.push(`${b.heightCm} cm`);
  if (a.weightKg !== b.weightKg) c.push(`${b.weightKg} kg`);
  if (a.riderType !== b.riderType) c.push(`Typ ${b.riderType}`);
  if (JSON.stringify(a.teamHistory) !== JSON.stringify(b.teamHistory)) c.push(`${b.teamHistory?.length ?? 0} Teamjahre`);
  if (JSON.stringify(a.topResults) !== JSON.stringify(b.topResults)) c.push(`${b.topResults?.length ?? 0} Top-Ergebnisse`);
  if (a.careerWins !== b.careerWins) c.push(`${b.careerWins} Siege`);
  if (JSON.stringify(a.family) !== JSON.stringify(b.family)) c.push('Familie');
  if (JSON.stringify(a.keyFacts) !== JSON.stringify(b.keyFacts)) c.push('Schlüsselfakten (waren leer)');
  return c;
};

/**
 * Kopierte PCS-Fahrerseite(n) einlesen. Mit riderId: nur für diesen Fahrer; sonst werden
 * eine oder mehrere eingefügte Seiten den erfassten Fahrern über den Namen zugeordnet.
 */
export function PcsRiderPastePanel({ riderId }: { riderId?: string }) {
  const riders = useLiveQuery(() => db.riders.toArray().then((rs) => alive(rs).filter((r) => !r.mergedInto)), []) ?? [];
  const [text, setText] = useState('');
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState('');
  const pages = useMemo(() => parsePcsRiderPages(text), [text]);
  const target = riderId ? riders.find((r) => r.id === riderId) : undefined;

  const rows: Row[] = pages.map((page) => {
    let rider: Rider | undefined;
    let ok = false;
    if (riderId) { rider = target; ok = !!rider && (pageMatchesRider(page, rider) || force); }
    else {
      const hits = riders.filter((r) => pageMatchesRider(page, r));
      if (hits.length === 1) { rider = hits[0]; ok = true; }
    }
    const next = rider ? applyPcsPage(rider, page) : undefined;
    return { page, rider, ok, next, changes: rider && next ? changesOf(rider, next) : [] };
  });
  const usable = rows.filter((r) => r.ok && r.next && r.changes.length);

  const save = async () => {
    if (!usable.length) return;
    await createRestorePoint(`Vor PCS-Übernahme (${usable.length} Fahrer)`);
    await mutate(['riders'], async (w) => { for (const r of usable) await w.put('riders', r.next!); });
    setMsg(`${usable.length} ${usable.length === 1 ? 'Profil' : 'Profile'} ergänzt.`);
    setText(''); setForce(false);
  };

  return (
    <div className="pcs-rider">
      <p className="small muted">
        {target ? <><a href={pcsRiderUrl(target)} target="_blank" rel="noreferrer noopener">PCS-Seite von {target.displayName} öffnen</a>, dort Strg A und Strg C, hier einfügen.</>
          : <>PCS-Fahrerseiten öffnen, jeweils Strg A und Strg C – eine oder mehrere Seiten hintereinander hier einfügen. Zuordnung über den Namen.</>}
        {' '}Gefüllt werden nur leere Felder; Teamstationen und Top-Ergebnisse werden durch die neue Kopie ersetzt.
      </p>
      <textarea rows={3} value={text} placeholder="Kopierte PCS-Fahrerseite hier einfügen …" onChange={(e) => { setText(e.target.value); setMsg(''); }} aria-label="PCS-Fahrerseite einfügen" />
      {text.trim() && !pages.length && <p className="warn small">Keine PCS-Fahrerseite erkannt (es fehlt die Zeile „Name:“). Bitte die ganze Seite mit Strg A kopieren.</p>}
      {rows.length > 0 && (
        <table className="table compact">
          <thead><tr><th>PCS-Seite</th><th>Fahrer im LK Board</th><th>Wird ergänzt</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.page.name}{r.page.birthDate ? ` (${r.page.birthDate.slice(0, 4)})` : ''}</td>
                <td className={r.ok ? '' : 'warn'}>{r.rider ? r.rider.displayName : 'nicht eindeutig gefunden'}{riderId && r.rider && !pageMatchesRider(r.page, r.rider) ? ' – Name oder Jahrgang weicht ab!' : ''}</td>
                <td className="small">{r.ok ? (r.changes.join(', ') || <span className="muted">nichts Neues</span>) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {riderId && rows.some((r) => r.rider && !pageMatchesRider(r.page, r.rider)) && (
        <label className="confirm"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Ich bin sicher, dass es derselbe Fahrer ist</label>
      )}
      {rows.length > 0 && <button className="primary" disabled={!usable.length} onClick={save}>{usable.length ? `${usable.length} ${usable.length === 1 ? 'Profil' : 'Profile'} ergänzen` : 'Nichts zu übernehmen'}</button>}
      {msg && <span className="ok small"> {msg}</span>}
    </div>
  );
}

/** Teamstationen, Top-Ergebnisse, Siege, Familie – für Profil und Fahrerkarte. */
export function CareerInfo({ r, compact = false }: { r: Rider; compact?: boolean }) {
  const year = new Date().getFullYear();
  const spans = teamSpans(r.teamHistory ?? []);
  const shown = compact ? spans.filter((s) => s.from <= year).slice(0, 3) : spans;
  return (
    <div className={`career ${compact ? 'compact' : ''}`}>
      {spans.length > 0 && (
        <div><span className="label">Teams</span> {shown.map((s, i) => (
          <span key={i}>{i ? ' · ' : ''}{s.from === s.to ? s.from : `${s.from}–${s.to > year ? year : s.to}`} {s.team}{s.to > year ? ` (Vertrag bis ${s.to})` : ''}</span>
        ))}</div>
      )}
      {r.topResults && r.topResults.length > 0 && (
        <div><span className="label">Top-Ergebnisse{r.careerWins != null ? ` · ${r.careerWins} Siege` : ''}</span>
          {compact ? ' ' + r.topResults.slice(0, 5).join(' · ') : <ul>{r.topResults.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </div>
      )}
      {r.family && r.family.length > 0 && <div><span className="label">Familie</span> {r.family.join(', ')}</div>}
    </div>
  );
}
