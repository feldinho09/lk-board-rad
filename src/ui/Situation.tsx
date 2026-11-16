import { useState } from 'react';
import type { Entry, SituationGroup, Stage } from '../domain/types';
import { moveBib, newGroup, parseBibs, updateSituation } from '../domain/situation';
import { CommitInput } from './inputs';

const shortName = (n: string) => { const p = n.split(' '); return p.length > 1 ? p.slice(1).join(' ') : n; };
const PRESETS = ['Spitze', 'Verfolger', 'Feld'];

/**
 * LIVE: Rennsituation – Gruppen mit Abstand und Startnummern. Ein Klick auf einen Fahrer
 * öffnet seine Karte. Startnummern einfach tippen: „11 21 22“.
 */
export function Situation({ stage, entries, onPick, selected }: { stage: Stage; entries: Entry[]; onPick: (e: Entry) => void; selected?: Entry }) {
  const groups = stage.situation?.groups ?? [];
  const [edit, setEdit] = useState(false);
  const upd = (fn: (g: SituationGroup[]) => SituationGroup[]) => updateSituation(stage.id, fn);
  const patch = (id: string, p: Partial<SituationGroup>) => upd((gs) => gs.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const at = stage.situation?.at ? new Date(stage.situation.at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : null;
  const byBib = new Map(entries.filter((e) => e.bib).map((e) => [e.bib!, e]));

  if (!groups.length && !edit) {
    return (
      <div className="situation empty">
        <span className="muted small">Rennsituation:</span>
        {PRESETS.map((l) => <button key={l} className="btn small" onClick={() => upd(() => PRESETS.slice(0, PRESETS.indexOf(l) + 1).map(newGroup))}>+ {l}</button>)}
      </div>
    );
  }
  return (
    <div className="situation" aria-label="Rennsituation">
      <div className="sit-groups">
        {groups.map((g, i) => (
          <div className="sit-group" key={g.id}>
            <div className="sit-head">
              {edit ? (
                <>
                  <CommitInput value={g.label} aria-label="Gruppe" style={{ width: 110 }} onCommit={(v) => patch(g.id, { label: v.trim() || g.label })} />
                  <CommitInput value={g.gap} aria-label={`Abstand ${g.label}`} placeholder={i ? '+1:30' : ''} style={{ width: 80 }} onCommit={(v) => patch(g.id, { gap: v.trim() || undefined })} />
                  <button className="btn small danger" aria-label={`${g.label} entfernen`} onClick={() => upd((gs) => gs.filter((x) => x.id !== g.id))}>✕</button>
                </>
              ) : (
                <>
                  <b>{g.label}</b>
                  {g.gap && <span className="sit-gap">{g.gap}</span>}
                  {g.bibs.length > 0 && <span className="muted small">{g.bibs.length}</span>}
                </>
              )}
            </div>
            <div className="sit-riders">
              {g.bibs.map((b) => {
                const e = byBib.get(b);
                return (
                  <button key={b} className={`sit-rider ${e?.riderId ? 'profile' : ''} ${selected && e?.id === selected.id ? 'on' : ''}`} onClick={() => e && onPick(e)} title={e ? `${e.name}${e.team ? ` · ${e.team}` : ''}` : 'nicht in der Startliste'}>
                    <span className="bib">{b}</span> {e ? shortName(e.name) : '?'}
                  </button>
                );
              })}
              {selected?.bib && !g.bibs.includes(selected.bib) && (
                <button className="sit-add" title={`${selected.name} in „${g.label}“`} aria-label={`${selected.name} in ${g.label}`} onClick={() => upd((gs) => moveBib(gs, selected.bib!, g.id))}>+ {selected.bib}</button>
              )}
            </div>
            {edit && <CommitInput value={g.bibs.join(' ')} aria-label={`Startnummern ${g.label}`} placeholder="Startnummern, z. B. 11 21 22" style={{ width: '100%', marginTop: 4 }} onCommit={(v) => upd((gs) => { let next = gs; for (const b of parseBibs(v)) next = moveBib(next, b, g.id); return next.map((x) => (x.id === g.id ? { ...x, bibs: parseBibs(v) } : x)); })} />}
            {edit ? <CommitInput value={g.note} aria-label={`Notiz ${g.label}`} placeholder="Notiz" style={{ width: '100%', marginTop: 4 }} onCommit={(v) => patch(g.id, { note: v.trim() || undefined })} />
              : g.note && <div className="small muted">{g.note}</div>}
          </div>
        ))}
      </div>
      <div className="sit-tools">
        {at && <span className="small muted">Stand {at}</span>}
        <button className={`btn small ${edit ? 'primary' : ''}`} onClick={() => setEdit(!edit)}>{edit ? 'Fertig' : 'Bearbeiten'}</button>
        {edit && <button className="btn small" onClick={() => upd((gs) => [...gs, newGroup(`Gruppe ${gs.length + 1}`)])}>+ Gruppe</button>}
      </div>
    </div>
  );
}

/** In welcher Gruppe fährt die Startnummer? */
export const groupOf = (stage: Stage | undefined, bib?: string) => (bib ? stage?.situation?.groups.find((g) => g.bibs.includes(bib)) : undefined);
