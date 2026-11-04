import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../db/db';
import { CLASSIFICATION_LABEL, type ClassificationKind } from '../domain/types';
import { formatDuration, formatGap } from '../domain/text';
import type { PcsRanking } from '../import/pcsPaste';
import { resolveRanking, saveRanking, type ResolvedRanking, type SaveRankingResult } from '../import/pcsRankingCommit';
import { splitFullName } from '../import/matching';

export function pcsDisplayName(name: string): string {
  const s = splitFullName(name);
  return `${s.first} ${s.last}`.trim();
}

const KINDS: ClassificationKind[] = ['etappe', 'gc', 'punkte', 'berg', 'nachwuchs', 'team'];

/** Vorschau und Speichern einer manuell kopierten PCS-Rangliste. */
export function PcsRankingPanel({ ranking, editionId }: { ranking: PcsRanking; editionId: string }) {
  const stages = (useLiveQuery(() => (editionId ? db.stages.where('editionId').equals(editionId).toArray().then(alive) : []), [editionId]) ?? [])
    .sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState('');
  const [kind, setKind] = useState<ClassificationKind>(ranking.kind);
  const [generalConfirmed, setGeneralConfirmed] = useState(ranking.kindCertain);
  const [resolved, setResolved] = useState<ResolvedRanking | null>(null);
  const [applyStatus, setApplyStatus] = useState(true);
  const [result, setResult] = useState<SaveRankingResult | null>(null);
  const [error, setError] = useState('');

  // Etappe vorschlagen: gleiche Nummer bzw. bei Eintagesrennen die einzige Etappe
  useEffect(() => {
    if (!stages.length || stageId) return;
    const n = ranking.meta.stageNumber;
    const guess = stages.length === 1 ? stages[0]
      : stages.find((s) => n != null && s.order === n) ?? stages.find((s) => ranking.meta.stageLabel && s.label.toLowerCase().includes(ranking.meta.stageLabel.toLowerCase()));
    if (guess) setStageId(guess.id);
  }, [stages, stageId, ranking]);
  useEffect(() => { setResult(null); if (editionId) void resolveRanking(editionId, { ...ranking, kind }).then(setResolved); }, [editionId, ranking, kind]);

  const unit = kind === 'punkte' || kind === 'berg' ? 'punkte' : ranking.unit;
  const unitMismatch = unit !== ranking.unit;
  const label = useMemo(() => {
    const st = stages.find((s) => s.id === stageId);
    if (!st) return '';
    return kind === 'etappe' ? `${CLASSIFICATION_LABEL.etappe} ${st.label}` : `${CLASSIFICATION_LABEL[kind]} nach ${st.label}`;
  }, [stages, stageId, kind]);
  const canSave = !!editionId && !!stageId && !!resolved && generalConfirmed && !unitMismatch;

  const save = async () => {
    if (!resolved) return;
    setError('');
    try { setResult(await saveRanking({ editionId, stageId, kind, unit, resolved, applyStatus })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <fieldset className="form">
      <legend>2 · ProCyclingStats-Rangliste (manuell kopiert)</legend>
      <div className="wide">
        <strong>{ranking.meta.raceName} {ranking.meta.year}</strong>{ranking.meta.stageLabel ? ` · ${ranking.meta.stageLabel}` : ''}{ranking.meta.route ? ` · ${ranking.meta.route}` : ''}
        {' · '}{ranking.rows.length} Zeilen · erkannt als <strong>{CLASSIFICATION_LABEL[ranking.kind]}</strong>
        {ranking.warnings.map((w) => <div key={w} className="warn small">⚠ {w}</div>)}
      </div>
      {!editionId && <p className="err wide">Oben zuerst das Zielrennen wählen.</p>}
      <label>Etappe / Lauf
        <select value={stageId} onChange={(e) => { setStageId(e.target.value); setResult(null); }}>
          <option value="">– wählen –</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label>Wertung
        <select value={kind} onChange={(e) => setKind(e.target.value as ClassificationKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{CLASSIFICATION_LABEL[k]}</option>)}
        </select>
      </label>
      {label && <div className="wide">Wird gespeichert als: <strong>{label}</strong> · Quelle „PCS (manuell kopiert)“, Zeitpunkt jetzt</div>}
      {unitMismatch && <p className="err wide">Diese Liste enthält {ranking.unit === 'zeit' ? 'Zeiten' : 'Punkte'} – das passt nicht zur gewählten Wertung.</p>}
      {!ranking.kindCertain && (
        <label className="wide confirm">
          <input type="checkbox" checked={generalConfirmed} onChange={(e) => setGeneralConfirmed(e.target.checked)} />
          Auf PCS war der Reiter „General“ (Gesamtstand) gewählt, nicht „Today“. Der kopierte Text verrät das nicht sicher.
        </label>
      )}
      {resolved && (
        <div className="wide">
          <p className="small">
            {kind === 'team' ? `${resolved.rows.length} Teams.` : <>
              {resolved.rows.length - resolved.unresolved.length} von {resolved.rows.length} Fahrern den Teilnehmern dieses Rennens zugeordnet.
              {resolved.unresolved.length > 0 && <> <span className="warn">{resolved.unresolved.length} ohne Zuordnung</span> (bleiben mit PCS-Namen in der Rangliste; vorher die Startliste importieren): {resolved.unresolved.slice(0, 8).join(', ')}{resolved.unresolved.length > 8 ? ' …' : ''}</>}
            </>}
          </p>
          {resolved.outUpdates.length > 0 && (
            <label className="confirm"><input type="checkbox" checked={applyStatus} onChange={(e) => setApplyStatus(e.target.checked)} />
              Ausfälle in den Teilnehmerstatus übernehmen: {resolved.outUpdates.map((u) => `${u.status}`).join(', ')} ({resolved.outUpdates.length})</label>
          )}
          <div className="scroll-x">
            <table className="table compact">
              <thead><tr><th>#</th><th>Vorher</th><th>{kind === 'team' ? 'Team' : 'Fahrer'}</th><th>{unit === 'punkte' ? 'Punkte' : 'Rückstand'}</th><th>Quelle</th></tr></thead>
              <tbody>
                {resolved.rows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    <td>{r.rank ?? r.status}</td><td className="muted">{r.prevRank ?? ''}</td>
                    <td>{r.teamName ?? (r.name ? pcsDisplayName(r.name) : '')}{r.riderId ? '' : kind !== 'team' ? ' ⚠' : ''}</td>
                    <td>{unit === 'punkte' ? r.points ?? '–' : r.rank === 1 ? formatDuration(r.timeSec) : r.sameTimeAsPrevious ? 'gl. Zeit' : formatGap(r.gapSec)}</td>
                    <td className="muted">{r.sourceValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resolved.rows.length > 12 && <p className="muted small">… und {resolved.rows.length - 12} weitere</p>}
          </div>
        </div>
      )}
      <button disabled={!canSave} onClick={save}>Wertungsstand speichern</button>
      {result && (
        <div className="wide banner ok" style={{ margin: 0 }}>
          {result.outcome === 'gespeichert' ? `Gespeichert als Revision ${result.revision}.` : `Unverändert gegenüber Revision ${result.revision} – nichts doppelt gespeichert.`}
          {result.statusUpdates > 0 && ` ${result.statusUpdates} Teilnehmerstatus aktualisiert.`}
          {' '}In der Live-Ansicht erscheint ein neuer Stand als „Neuer Stand verfügbar“, ohne die gerade gelesene Liste zu ersetzen.
        </div>
      )}
      {error && <div className="wide banner err">{error}</div>}
    </fieldset>
  );
}
