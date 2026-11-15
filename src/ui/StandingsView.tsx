import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { STANDING_KINDS, type Entry, type Race, type Stage, type StandingKind } from '../domain/types';
import { raceEntries, raceStages } from '../domain/center';
import { latestStandings, parseStanding, saveStanding } from '../domain/standings';
import { createRestorePoint } from '../backup/archive';
import { PcsLink } from './pcs';
import { stageLabel } from './state';
import { confirmDialog } from './dialogs';

export const KIND_LABEL = Object.fromEntries(STANDING_KINDS.map((k) => [k.key, k.label])) as Record<StandingKind, string>;
const PCS_SUFFIX: Record<StandingKind, string> = { etappe: '', gc: '-gc', punkte: '-points', berg: '-kom', nachwuchs: '-youth' };

/** PCS-Seite zur Rangliste (nur Link, öffnet im Fenster „pcs“). */
export function pcsStandingUrl(race: Race, stage: Stage, kind: StandingKind): string | undefined {
  const base = race.pcsUrl?.match(/^https:\/\/www\.procyclingstats\.com\/race\/[^/]+\/\d{4}/)?.[0];
  if (!base) return undefined;
  if (race.kind === 'eintages') return `${base}/result`;
  return `${base}/stage-${stage.number}${PCS_SUFFIX[kind]}`;
}

/** Rennen → Klassemente: Ranglisten nach jeder Etappe einfügen. */
export function StandingsEditor({ race }: { race: Race }) {
  const stages = useLiveQuery(() => raceStages(race.id), [race.id]) ?? [];
  const entries = useLiveQuery(() => raceEntries(race.id), [race.id]) ?? [];
  const [num, setNum] = useState<number | null>(null);
  const [kind, setKind] = useState<StandingKind>(race.kind === 'eintages' ? 'etappe' : 'gc');
  const [text, setText] = useState('');
  const stage = stages.find((s) => s.number === num) ?? [...stages].reverse().find((s) => s.standings && Object.keys(s.standings).length) ?? stages[0];
  const parsed = useMemo(() => (text.trim() ? parseStanding(text, entries) : []), [text, entries]);
  if (!stage) return null;
  const kinds = race.kind === 'eintages' ? STANDING_KINDS.filter((k) => k.key === 'etappe') : STANDING_KINDS;
  const saved = stage.standings?.[kind] ?? [];
  const pcs = pcsStandingUrl(race, stage, kind);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row">
        {race.kind !== 'eintages' && (
          <select value={stage.number} onChange={(e) => { setNum(Number(e.target.value)); setText(''); }} aria-label="Nach Etappe">
            {stages.map((s) => <option key={s.id} value={s.number}>nach {stageLabel(s)}{s.standings && Object.keys(s.standings).length ? ' ✓' : ''}</option>)}
          </select>
        )}
        {kinds.map((k) => (
          <button key={k.key} className={`chip ${kind === k.key ? 'flag' : ''}`} onClick={() => { setKind(k.key); setText(''); }}>
            {k.label}{stage.standings?.[k.key]?.length ? ' ✓' : ''}
          </button>
        ))}
        <span className="grow" />
        {pcs ? <PcsLink url={pcs}>PCS: {KIND_LABEL[kind]}</PcsLink> : <span className="small muted">Für den PCS-Knopf oben die PCS-Adresse des Rennens erfassen.</span>}
      </div>
      <p className="small muted">Rangliste auf PCS (oder einer anderen Seite) markieren, kopieren und hier einfügen. Erkannt werden Rang, Fahrer (über die Startliste) und die letzte Zeit bzw. Zahl der Zeile als Rückstand oder Punkte. „,,“ gilt als gleiche Zeit.</p>
      <textarea rows={4} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Rangliste einfügen" placeholder={'1\tPOGAČAR Tadej\tUAE Team Emirates\t21:14:05\n2\tVINGEGAARD Jonas\tVisma | Lease a Bike\t+0:42'} />
      {parsed.length > 0 && (
        <>
          <p className="small">Erkannt: <b>{parsed.length} Plätze</b>{parsed.some((p) => !p.bib) ? <span className="warn"> · {parsed.filter((p) => !p.bib).length} ohne Startlisten-Treffer</span> : null}</p>
          <StandingTable rows={parsed.slice(0, 15)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn small primary" onClick={async () => { if (saved.length) await createRestorePoint(`Vor Klassement ${KIND_LABEL[kind]} ${stageLabel(stage)}`); await saveStanding(stage, kind, parsed); setText(''); }}>
              {KIND_LABEL[kind]} nach {stageLabel(stage, race.kind)} übernehmen
            </button>
            <button className="btn small" onClick={() => setText('')}>Verwerfen</button>
          </div>
        </>
      )}
      {!parsed.length && saved.length > 0 && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <h3 className="grow" style={{ margin: 0 }}>{KIND_LABEL[kind]} nach {stageLabel(stage, race.kind)} · {saved.length} Plätze</h3>
            <button className="btn small danger" onClick={async () => { if (await confirmDialog(`${KIND_LABEL[kind]} nach ${stageLabel(stage)} löschen?`, 'Löschen')) await saveStanding(stage, kind, []); }}>Löschen</button>
          </div>
          <StandingTable rows={saved.slice(0, 30)} />
        </>
      )}
    </div>
  );
}

function StandingTable({ rows, onPick, entries, max }: { rows: { rank: number; name: string; bib?: string; team?: string; value?: string }[]; onPick?: (e: Entry) => void; entries?: Entry[]; max?: number }) {
  return (
    <table className="tbl standing">
      <tbody>
        {rows.slice(0, max ?? rows.length).map((r) => {
          const e = entries?.find((x) => (r.bib && x.bib === r.bib) || x.name === r.name);
          return (
            <tr key={`${r.rank}-${r.name}`} className={onPick && e ? 'pick' : ''} onClick={onPick && e ? () => onPick(e) : undefined}>
              <td className="rk">{r.rank}.</td>
              <td className="bibc">{r.bib ?? ''}</td>
              <td>{r.name}{!onPick && r.team ? <span className="muted small"> · {r.team}</span> : null}{!r.bib && !onPick ? <span className="warn small"> (nicht in Startliste)</span> : null}</td>
              <td className="val">{r.value ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** LIVE: Klassemente (neuester Stand bis zur aktuellen Etappe), Fahrer anklickbar. */
export function StandingsLive({ race, stage, entries, onPick }: { race: Race; stage: Stage; entries: Entry[]; onPick: (e: Entry) => void }) {
  const stages = useLiveQuery(() => raceStages(race.id), [race.id]) ?? [];
  const latest = latestStandings(stages, stage.number);
  const [kind, setKind] = useState<StandingKind | null>(null);
  if (!latest.length) return null;
  const cur = latest.find((l) => l.kind === kind) ?? latest.find((l) => l.kind === 'gc') ?? latest[0];
  const leaders = latest.filter((l) => l.kind !== 'etappe' && l.rows[0]);
  return (
    <div className="panel standings-live">
      <div className="row" style={{ gap: 4 }}>
        <h2 className="grow" style={{ margin: 0 }}>Klassemente</h2>
        {latest.map((l) => <button key={l.kind} className={`chip ${l.kind === cur.kind ? 'flag' : ''}`} onClick={() => setKind(l.kind)}>{STANDING_KINDS.find((k) => k.key === l.kind)!.short}</button>)}
      </div>
      {leaders.length > 0 && (
        <p className="small" style={{ margin: '4px 0' }}>
          {leaders.map((l, i) => <span key={l.kind}>{i > 0 && ' · '}<span className="muted">{KIND_LABEL[l.kind]}:</span> <b>{l.rows[0].name.split(' ').slice(1).join(' ') || l.rows[0].name}</b></span>)}
        </p>
      )}
      <div className="small muted">{KIND_LABEL[cur.kind]} nach {stageLabel(cur.stage, race.kind)}</div>
      <StandingTable rows={cur.rows} entries={entries} onPick={onPick} max={10} />
    </div>
  );
}
