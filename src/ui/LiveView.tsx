import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate, newRecord, nowIso } from '../db/db';
import type {
  ClassificationKind, ClassificationStanding, Edition, Note, Participation, RaceEvent, RaceGroup, Rider, Stage,
} from '../domain/types';
import { CLASSIFICATION_LABEL, START_STATUS_LABEL } from '../domain/types';
import { resolveStanding } from '../domain/standings';
import { ageAt, formatClock, formatDuration, formatGap } from '../domain/text';
import { useApp, isTyping } from './state';
import { currentRaceClockSec } from './RaceClock';

export function bibSort(a: { bib: string }, b: { bib: string }): number {
  const na = Number(a.bib), nb = Number(b.bib);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.bib.localeCompare(b.bib, 'de', { numeric: true });
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function LiveView() {
  const app = useApp();
  const edition = useLiveQuery(() => (app.editionId ? db.editions.get(app.editionId) : undefined), [app.editionId]);
  const stages = useLiveQuery(() => (app.editionId ? db.stages.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? [];
  const parts = useLiveQuery(() => (app.editionId ? db.participations.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? [];
  const riders = useLiveQuery(async () => {
    const rs = await db.riders.bulkGet(parts.map((p) => p.riderId));
    return new Map(rs.filter((r): r is Rider => !!r).map((r) => [r.id, r]));
  }, [parts]) ?? new Map<string, Rider>();
  const standings = useLiveQuery(() => (app.editionId ? db.standings.where('editionId').equals(app.editionId).toArray().then(alive) : []), [app.editionId]) ?? [];

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.order - b.order), [stages]);
  const stage = useMemo(() => {
    if (!sortedStages.length) return null;
    const chosen = sortedStages.find((s) => s.id === app.stageId);
    if (chosen) return chosen;
    const withResults = sortedStages.filter((s) => standings.some((st) => st.stageId === s.id && st.kind === 'etappe'));
    return withResults[withResults.length - 1] ?? sortedStages[0];
  }, [sortedStages, app.stageId, standings]);

  if (!app.editionId || !edition) {
    return (
      <div className="empty">
        <h2>Kein aktives Rennen</h2>
        <p>Oben ein Rennen wählen, unter <a href="#rennen">Rennen</a> anlegen oder dort das Demo-Rennen laden.</p>
      </div>
    );
  }

  return (
    <div className="live">
      <section className="col-left" aria-label="Startliste">
        <StartList parts={parts} riders={riders} />
      </section>
      <section className="col-mid" aria-label="Fahrerkarte">
        <RiderCards edition={edition} parts={parts} riders={riders} stage={stage} stages={sortedStages} standings={standings} />
      </section>
      <section className="col-right" aria-label="Rennsituation">
        {stage && <StandingsPanel stage={stage} stages={sortedStages} standings={standings} riders={riders} />}
        <GroupsPanel editionId={edition.id} stageId={stage?.id} riders={riders} parts={parts} />
      </section>
      <section className="bottom" aria-label="Notizen und Ereignisse">
        <EventsPanel editionId={edition.id} stageId={stage?.id} riders={riders} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Startliste
function StartList({ parts, riders }: { parts: Participation[]; riders: Map<string, Rider> }) {
  const app = useApp();
  const [team, setTeam] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [status, setStatus] = useState<'alle' | 'aktiv' | 'aus'>('alle');
  const listRef = useRef<HTMLUListElement>(null);
  const teams = useMemo(() => [...new Set(parts.map((p) => p.teamName))].sort(), [parts]);
  const out = (p: Participation) => ['DNS', 'DNF', 'DSQ', 'OTL', 'HD'].includes(p.status);
  // Feste Sortierung nach Startnummer – eingehende Daten sortieren nie um
  const visible = useMemo(() => parts
    .filter((p) => (!team || p.teamName === team) && (!onlyFav || p.favorite) && (status === 'alle' || (status === 'aus' ? out(p) : !out(p))))
    .sort(bibSort), [parts, team, onlyFav, status]);
  const filtered = team || onlyFav || status !== 'alle';

  const move = (dir: number) => {
    const i = visible.findIndex((p) => p.riderId === app.selectedRiderId);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + dir))];
    if (next) {
      app.select(next.riderId);
      listRef.current?.querySelector(`[data-rider="${next.riderId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <div className="panel startlist">
      <div className="panel-head">
        <h2>Startliste <span className="muted">({visible.length}/{parts.length})</span></h2>
      </div>
      <div className="filters">
        <select aria-label="Team-Filter" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Alle Teams</option>
          {teams.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="Status-Filter" value={status} onChange={(e) => setStatus(e.target.value as never)}>
          <option value="alle">Alle</option><option value="aktiv">Im Rennen</option><option value="aus">Ausgeschieden</option>
        </select>
        <label><input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> ★</label>
        {filtered && <button className="link" onClick={() => { setTeam(''); setOnlyFav(false); setStatus('alle'); }}>Filter zurücksetzen</button>}
      </div>
      {filtered && <div className="filter-note">Filter aktiv</div>}
      <ul
        ref={listRef}
        className="riders"
        tabIndex={0}
        role="listbox"
        aria-label="Fahrer"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        }}
      >
        {visible.map((p) => {
          const r = riders.get(p.riderId);
          const sel = app.selectedRiderId === p.riderId;
          return (
            <li key={p.id} data-rider={p.riderId} role="option" aria-selected={sel} className={`${sel ? 'sel' : ''} ${out(p) ? 'out' : ''}`} onClick={() => app.select(p.riderId)}>
              <span className="bib">{p.bib}</span>
              <span className="name">{p.overrides.displayName ?? r?.displayName ?? '?'}</span>
              <span className="team">{p.teamName}</span>
              <span className="flags">
                {p.favorite && <span title="Favorit" aria-label="Favorit">★</span>}
                {app.pinned.includes(p.riderId) && <span title="Angeheftet" aria-label="Angeheftet">📌</span>}
                {out(p) && <span className="st" title={START_STATUS_LABEL[p.status]}>{p.status}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Fahrerkarten
interface CardProps {
  edition: Edition;
  parts: Participation[];
  riders: Map<string, Rider>;
  stage: Stage | null;
  stages: Stage[];
  standings: ClassificationStanding[];
}

function RiderCards(props: CardProps) {
  const app = useApp();
  const sel = app.selectedRiderId;
  const compare = app.pinned.filter((id) => id !== sel);
  const selPart = props.parts.find((p) => p.riderId === sel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || !sel) return;
      if (e.key === 'p' || e.key === 'P') app.togglePin(sel);
      if ((e.key === 'f' || e.key === 'F') && selPart) void mutate(['participations'], (w) => w.put('participations', { ...selPart, favorite: !selPart.favorite }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, selPart, app]);

  if (!sel) return <div className="panel empty-card"><p>Fahrer in der Startliste wählen oder mit <kbd>Strg K</kbd> suchen.</p></div>;
  return (
    <div className="cards">
      <RiderCard {...props} riderId={sel} primary />
      {compare.length > 0 && (
        <div className="compare">
          <h3>Vergleich / angeheftet</h3>
          <div className="compare-grid">
            {compare.map((id) => <RiderCard key={id} {...props} riderId={id} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function RiderCard({ edition, parts, riders, stage, stages, standings, riderId, primary }: CardProps & { riderId: string; primary?: boolean }) {
  const app = useApp();
  const r = riders.get(riderId);
  const p = parts.find((x) => x.riderId === riderId);
  const notes = useLiveQuery(() => db.notes.where('refId').anyOf([riderId, p?.id ?? '-']).toArray().then(alive), [riderId, p?.id]) ?? [];
  const [details, setDetails] = useState(false);
  const [fix, setFix] = useState(false);
  if (!r) return null;
  const pron = p?.overrides.pronunciation ?? r.pronunciation;
  const age = ageAt(r.birthDate, stage?.date ?? edition.startDate);
  const res = (kind: ClassificationKind) => {
    if (!stage) return null;
    const st = resolveStanding(kind, stage.id, stages, standings, formatClock);
    const row = st.standing?.rows.find((x) => x.riderId === riderId);
    return { st, row };
  };
  const stageRes = res('etappe');
  const gcRes = res('gc');
  const facts = [...r.keyFacts, ...notes.filter((n) => n.priority).map((n) => n.text)].slice(0, 3);
  const pinned = app.pinned.includes(riderId);

  return (
    <article className={`panel card ${primary ? 'primary' : ''}`} aria-label={`Fahrerkarte ${r.displayName}`}>
      <header className="card-head">
        <span className="big-bib">{p?.bib ?? '—'}</span>
        <div>
          <h2 className="rider-name">{p?.overrides.displayName ?? r.displayName}</h2>
          <div className="team-line">{p?.teamName ?? '–'} · {r.nationality ?? '–'}{age ? ` · ${age} J.` : ''}</div>
        </div>
        <div className="card-actions">
          <button onClick={() => app.togglePin(riderId)} aria-pressed={pinned} title="Anheften (P)">{pinned ? 'Lösen' : 'Anheften'}</button>
          {p && <button onClick={() => mutate(['participations'], (w) => w.put('participations', { ...p, favorite: !p.favorite }))} aria-pressed={p.favorite} title="Favorit (F)">{p.favorite ? '★ Favorit' : '☆ Favorit'}</button>}
        </div>
      </header>
      <div className="pron">
        <span className="label">Aussprache</span> <strong>{pron || 'nicht hinterlegt'}</strong>
        {p?.overrides.pronunciation && <span className="tag" title="Nur in diesem Rennen">Rennkorrektur</span>}
        {primary && <button className="link" onClick={() => setFix((v) => !v)}>Schnellkorrektur</button>}
      </div>
      {fix && p && <QuickFix rider={r} part={p} onDone={() => setFix(false)} />}
      <div className="role">{r.riderType ?? 'Fahrertyp unbekannt'}{p && p.status !== 'aktiv' && p.status !== 'gemeldet' && <span className="st"> · {START_STATUS_LABEL[p.status]}</span>}</div>
      {facts.length > 0 ? <ol className="facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ol> : <p className="muted">Keine Schlüsselfakten hinterlegt.</p>}
      {stage && (
        <dl className="results">
          <div><dt>{stage.label}</dt><dd>{stageRes?.row ? (stageRes.row.rank ? `${stageRes.row.rank}. ${formatGap(stageRes.row.gapSec)}` : stageRes.row.status ?? '–') : stageRes?.st.standing ? 'nicht klassiert' : 'kein Ergebnis'}</dd></div>
          <div><dt>{gcRes?.st.stage ? `Gesamt nach ${gcRes.st.stage.label}` : 'Gesamt'}</dt><dd>{gcRes?.row ? (gcRes.row.rank ? `${gcRes.row.rank}. ${formatGap(gcRes.row.gapSec)}` : gcRes.row.status ?? '–') : 'kein Stand'}</dd></div>
        </dl>
      )}
      {primary && (
        <>
          <button className="link" onClick={() => setDetails((v) => !v)} aria-expanded={details}>{details ? 'Details ausblenden' : 'Details anzeigen'}</button>
          {details && (
            <div className="details">
              {r.strengths && <p><span className="label">Stärken</span> {r.strengths}</p>}
              {r.bio && <p><span className="label">Kurzbio</span> {r.bio}</p>}
              <NotesList notes={notes} editionId={edition.id} />
              <p className="muted small">Quellen: {r.sources ?? '–'} {r.lastVerifiedAt ? `· geprüft ${r.lastVerifiedAt}` : ''}</p>
              <a href={`#fahrer-${r.id}`}>Profil bearbeiten</a>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function NotesList({ notes, editionId }: { notes: Note[]; editionId: string }) {
  if (!notes.length) return <p className="muted">Keine Notizen.</p>;
  return (
    <ul className="notes">
      {notes.map((n) => {
        const told = n.toldInEditions.includes(editionId);
        return (
          <li key={n.id} className={told ? 'told' : ''}>
            {n.text}
            <button className="link" onClick={() => mutate(['notes'], (w) => w.put('notes', { ...n, toldInEditions: told ? n.toldInEditions.filter((x) => x !== editionId) : [...n.toldInEditions, editionId] }))}>
              {told ? '✓ erzählt' : 'als erzählt markieren'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Schnellkorrektur der Aussprache: Geltungsbereich vor dem Speichern sichtbar, Standard = dieses Rennen. */
function QuickFix({ rider, part, onDone }: { rider: Rider; part: Participation; onDone: () => void }) {
  const [val, setVal] = useState(part.overrides.pronunciation ?? rider.pronunciation ?? '');
  const [scope, setScope] = useState<'rennen' | 'profil'>('rennen');
  const save = async () => {
    if (scope === 'rennen') await mutate(['participations'], (w) => w.put('participations', { ...part, overrides: { ...part.overrides, pronunciation: val } }));
    else await mutate(['riders'], (w) => w.put('riders', { ...rider, pronunciation: val }));
    onDone();
  };
  return (
    <div className="quickfix">
      <input value={val} onChange={(e) => setVal(e.target.value)} aria-label="Aussprache" />
      <label><input type="radio" checked={scope === 'rennen'} onChange={() => setScope('rennen')} /> nur dieses Rennen</label>
      <label><input type="radio" checked={scope === 'profil'} onChange={() => setScope('profil')} /> allgemeines Fahrerprofil</label>
      <button onClick={save}>Speichern</button>
      <button className="link" onClick={onDone}>Abbrechen</button>
    </div>
  );
}

// ---------------------------------------------------------------- Wertungen
const COVERAGE_TXT = { vollstaendig: 'vollständig', teilweise: 'teilweise', nicht_veroeffentlicht: 'noch nicht veröffentlicht', nicht_verfuegbar: 'nicht verfügbar', fehlgeschlagen: 'Abruf fehlgeschlagen' } as const;
const KINDS: ClassificationKind[] = ['etappe', 'gc', 'punkte', 'berg', 'nachwuchs', 'team'];

function StandingsPanel({ stage, stages, standings, riders }: { stage: Stage; stages: Stage[]; standings: ClassificationStanding[]; riders: Map<string, Rider> }) {
  const app = useApp();
  const [kind, setKind] = useState<ClassificationKind>('etappe');
  const resolved = resolveStanding(kind, stage.id, stages, standings, formatClock);
  // Gerade gelesene Rangliste bleibt stehen, bis der Nutzer einen neuen Stand übernimmt
  const [shownId, setShownId] = useState<string | null>(null);
  const key = `${kind}|${stage.id}`;
  const [shownKey, setShownKey] = useState(key);
  useEffect(() => { setShownKey(key); setShownId(resolved.standing?.id ?? null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (shownKey === key && shownId ? standings.find((s) => s.id === shownId) : null) ?? resolved.standing;
  const newer = resolved.standing && shown && resolved.standing.id !== shown.id;
  const showLabel = shown && shown.id === resolved.standing?.id ? resolved.label : shown ? `${CLASSIFICATION_LABEL[kind]} – älterer Stand, Abruf ${formatClock(shown.fetchedAt)}` : resolved.label;

  return (
    <div className="panel standings">
      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k} role="tab" aria-selected={k === kind} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
            {({ etappe: 'Etappe', gc: 'Gesamt', punkte: 'Punkte', berg: 'Berg', nachwuchs: 'Nachwuchs', team: 'Team' } as const)[k]}
          </button>
        ))}
      </div>
      <div className={`standing-label ${resolved.exact ? '' : 'stale'}`}>{showLabel}</div>
      {shown && <div className="muted small">Status: {shown.sourceStatus === 'vorlaeufig' ? 'vorläufig' : shown.sourceStatus === 'quelle_bestaetigt' ? 'bei der Quelle als bestätigt geführt' : 'unbekannt'} · Abdeckung: {COVERAGE_TXT[shown.coverage]} · Rev. {shown.sourceRevision}</div>}
      {newer && <button className="new-standing" onClick={() => setShownId(resolved.standing!.id)}>Neuer Stand verfügbar – übernehmen</button>}
      {shown ? (
        <table className="table compact">
          <thead><tr><th>#</th><th>{kind === 'team' ? 'Team' : 'Fahrer'}</th><th>{shown.unit === 'punkte' ? 'Punkte' : 'Rückstand'}</th></tr></thead>
          <tbody>
            {shown.rows.map((row, i) => {
              const r = row.riderId ? riders.get(row.riderId) : undefined;
              return (
                <tr key={i} className={row.riderId && row.riderId === app.selectedRiderId ? 'sel' : ''} onClick={() => row.riderId && app.select(row.riderId)}>
                  <td>{row.rank ?? row.status ?? '–'}</td>
                  <td>{row.teamName ?? r?.displayName ?? '(unbekannt)'}</td>
                  <td>{shown.unit === 'punkte' ? row.points ?? '–' : row.rank === 1 ? formatDuration(row.timeSec) : row.sameTimeAsPrevious ? 'gl. Zeit' : formatGap(row.gapSec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="muted">Kein Stand vorhanden.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Renngruppen
function GroupsPanel({ editionId, stageId, riders, parts }: { editionId: string; stageId?: string; riders: Map<string, Rider>; parts: Participation[] }) {
  const app = useApp();
  const groups = (useLiveQuery(() => db.groups.where('editionId').equals(editionId).toArray().then(alive), [editionId]) ?? [])
    .filter((g) => g.stageId === stageId).sort((a, b) => a.order - b.order);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const addGroup = (name: string) => mutate(['groups'], (w) => w.put('groups', newRecord({ editionId, stageId, name, order: groups.length, riderIds: [], gapSec: null } as Omit<RaceGroup, 'id' | 'rev' | 'createdAt' | 'updatedAt'>)));
  const setGap = (g: RaceGroup, v: string) => {
    const parts2 = v.split(':').map(Number);
    const sec = v.trim() === '' ? null : parts2.some(isNaN) ? undefined : parts2.reduce((a, p) => a * 60 + p, 0);
    if (sec === undefined) return;
    void mutate(['groups'], (w) => w.put('groups', { ...g, gapSec: sec, measuredAt: nowIso(), source: 'eigene Beobachtung' }));
  };
  const toggleMember = (g: RaceGroup, id: string) =>
    mutate(['groups'], (w) => w.put('groups', { ...g, riderIds: g.riderIds.includes(id) ? g.riderIds.filter((x) => x !== id) : [...g.riderIds, id] }));
  const bibOf = (id: string) => parts.find((p) => p.riderId === id)?.bib ?? '?';

  return (
    <div className="panel groups">
      <div className="panel-head">
        <h2>Renngruppen</h2>
        <div>
          {['Spitze', 'Verfolger', 'Feld'].filter((n) => !groups.some((g) => g.name === n)).map((n) => (
            <button key={n} className="small" onClick={() => addGroup(n)}>+ {n}</button>
          ))}
        </div>
      </div>
      {groups.length === 0 && <p className="muted">Noch keine Gruppen erfasst.</p>}
      {groups.map((g, i) => {
        const ageMin = g.measuredAt ? (Date.now() - new Date(g.measuredAt).getTime()) / 60000 : null;
        return (
          <div key={g.id} className="group">
            <div className="group-head">
              <strong>{g.name}</strong> <span className="muted">({g.riderIds.length})</span>
              {i > 0 && (
                <label className="gap">
                  Abstand <input defaultValue={g.gapSec != null ? formatDuration(g.gapSec) : ''} key={g.gapSec ?? 'x'} placeholder="m:ss" aria-label={`Abstand ${g.name}`} onBlur={(e) => setGap(g, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                </label>
              )}
              {g.measuredAt && <span className={`small ${ageMin! > 5 ? 'stale' : 'muted'}`}>{ageMin! > 5 ? 'VERALTET · ' : ''}gemessen {formatClock(g.measuredAt)}</span>}
              <button className="link" onClick={() => mutate(['groups'], (w) => w.remove('groups', g.id))} aria-label={`Gruppe ${g.name} entfernen`}>✕</button>
            </div>
            <div className="members">
              {g.riderIds.map((id) => (
                <button key={id} className="chip" onClick={() => toggleMember(g, id)} title="Aus Gruppe entfernen">{bibOf(id)} {riders.get(id)?.lastName}</button>
              ))}
              {app.selectedRiderId && !g.riderIds.includes(app.selectedRiderId) && (
                <button className="chip add" onClick={() => toggleMember(g, app.selectedRiderId!)}>+ {riders.get(app.selectedRiderId)?.lastName}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Ereignisse
function EventsPanel({ editionId, stageId, riders }: { editionId: string; stageId?: string; riders: Map<string, Rider> }) {
  const app = useApp();
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);
  useEffect(() => { if (open && focusOnOpen.current) { focusOnOpen.current = false; input.current?.focus(); } }, [open]);
  const events = (useLiveQuery(() => db.events.where('editionId').equals(editionId).reverse().sortBy('at').then(alive), [editionId]) ?? []).slice(0, 50);
  const [undoId, setUndoId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        // Fokus sofort setzen, damit unmittelbar folgende Tastenanschläge nicht verloren gehen
        if (input.current) input.current.focus();
        else { setOpen(true); focusOnOpen.current = true; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = async () => {
    if (!text.trim()) return;
    const ev = newRecord({
      editionId, stageId, at: nowIso(), raceClockSec: currentRaceClockSec(), text: text.trim(),
      riderIds: app.selectedRiderId ? [app.selectedRiderId] : [], source: 'eigene Beobachtung', confirmed: false,
    } as Omit<RaceEvent, 'id' | 'rev' | 'createdAt' | 'updatedAt'>);
    try {
      await mutate(['events'], (w) => w.put('events', ev));
      setText(''); // erst nach bestätigtem Speichern leeren
      setError(null);
      setUndoId(ev.id);
    } catch (e) {
      setError('Nicht gespeichert – Text bleibt erhalten: ' + String(e));
    }
  };

  return (
    <div className="panel events">
      <div className="panel-head">
        <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? '▾' : '▸'} Ereignisse & Notizen</button>
      </div>
      {open && (
        <>
          <div className="event-input">
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') input.current?.blur(); }}
              placeholder={`Ereignis notieren (Enter)${app.selectedRiderId ? ` – verknüpft mit ${riders.get(app.selectedRiderId)?.displayName ?? ''}` : ''}`}
              aria-label="Ereignis notieren"
            />
            <button onClick={add}>Speichern</button>
            {undoId && <button className="link" onClick={async () => { await mutate(['events'], (w) => w.remove('events', undoId)); setUndoId(null); }}>Rückgängig</button>}
          </div>
          {error && <div className="err small" role="alert">{error}</div>}
          <ul className="event-list">
            {events.map((e) => (
              <li key={e.id}>
                <span className="time">{fmtTime(e.at).split(' ').pop()}</span>
                {e.raceClockSec != null && <span className="muted"> [{formatDuration(e.raceClockSec)}]</span>}
                {' '}{e.text}
                {e.riderIds.length > 0 && <span className="muted"> · {e.riderIds.map((id) => riders.get(id)?.lastName).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
