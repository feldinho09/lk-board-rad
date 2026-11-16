import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../db/db';
import { RACE_SECTIONS, STATUS_LABEL, type Entry, type EntryStatus, type Race, type Stage } from '../domain/types';
import {
  addRidersToRace, addStage, applyStartlist, createRace, displayName, entryPcsUrl, nameMatchKey, createTopic, deleteRace, pcsRaceUrl, profileFromEntry, profilesByLastRace,
  raceEntries, raceStages, removeEntry, removeStage, saveRaceSection, setEntryStatus, updateEntry, updateRace, updateStage, type StartlistResult,
} from '../domain/center';
import { parsePcsStartlist, pcsRiderLinks } from '../import/pcsPaste';
import { createRestorePoint } from '../backup/archive';
import { normalize } from '../domain/text';
import { RichField } from './rich';
import { PcsLink } from './pcs';
import { CommitInput } from './inputs';
import { confirmDialog } from './dialogs';
import { fmtDate, go, PROFILE_LABEL, stageLabel, useCurrent } from './state';
import { TopicCards } from './TopicsView';

export function RacesView({ id }: { id?: string }) {
  const races = useLiveQuery(async () => alive(await db.races.toArray()).sort((a, b) => (b.startDate ?? String(b.year)).localeCompare(a.startDate ?? String(a.year))), []) ?? [];
  const [adding, setAdding] = useState(false);
  return (
    <main className="split">
      <aside className="panel sidelist">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Rennen</h2>
          <button className="btn small primary" onClick={() => setAdding(true)}>+ Rennen</button>
        </div>
        <ul>
          {races.map((r) => (
            <li key={r.id}><a href={`#rennen-${r.id}`} className={r.id === id ? 'on' : ''}><span>{r.name}</span><span className="meta">{r.startDate ? fmtDate(r.startDate) : r.year}</span></a></li>
          ))}
          {!races.length && <li className="muted small" style={{ padding: 8 }}>Noch kein Rennen.</li>}
        </ul>
      </aside>
      <section>
        {adding ? <NewRace onDone={(rid) => { setAdding(false); if (rid) go(`rennen-${rid}`); }} />
          : id ? <RaceEditor id={id} /> : <div className="panel empty-state">Rennen links auswählen oder neu anlegen.</div>}
      </section>
    </main>
  );
}

function NewRace({ onDone }: { onDone: (id?: string) => void }) {
  const cur = useCurrent();
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear() + (new Date().getMonth() > 9 ? 1 : 0));
  const [kind, setKind] = useState<Race['kind']>('rundfahrt');
  const [start, setStart] = useState('');
  const [n, setN] = useState(21);
  const [pcs, setPcs] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    const r = await createRace({ name, year, kind, startDate: start || undefined, stageCount: n, pcsUrl: pcs.trim() || undefined });
    cur.setRace(r.id);
    onDone(r.id);
  };
  return (
    <div className="panel">
      <h2>Neues Rennen</h2>
      <div className="fields">
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tour de France" autoFocus /></label>
        <label className="field">Jahr<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label className="field">Art<select value={kind} onChange={(e) => setKind(e.target.value as Race['kind'])}><option value="rundfahrt">Rundfahrt</option><option value="eintages">Eintagesrennen</option></select></label>
        <label className="field">Startdatum<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {kind === 'rundfahrt' && <label className="field">Anzahl Etappen<input type="number" min={1} max={30} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>}
        <label className="field" style={{ gridColumn: 'span 2' }}>PCS-Adresse (optional)<input value={pcs} onChange={(e) => setPcs(e.target.value)} placeholder="https://www.procyclingstats.com/race/tour-de-france/2026" /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={create} disabled={!name.trim()}>Anlegen</button>
        <button className="btn" onClick={() => onDone()}>Abbrechen</button>
      </div>
    </div>
  );
}

function RaceEditor({ id }: { id: string }) {
  const race = useLiveQuery(() => db.races.get(id), [id]);
  const cur = useCurrent();
  const [tab, setTab] = useState<'uebersicht' | 'etappen' | 'startliste'>('uebersicht');
  const counts = useLiveQuery(async () => {
    const es = alive(await db.entries.where('raceId').equals(id).toArray());
    return { entries: es.length, profiles: es.filter((e) => e.riderId).length };
  }, [id]);
  if (race === undefined) return null;
  if (!race || race.deleted) return <div className="panel empty-state">Dieses Rennen existiert nicht (mehr).</div>;
  return (
    <>
      <div className="panel">
        <div className="row">
          <h1 className="grow" style={{ fontSize: '2rem' }}>{race.name} {race.year}</h1>
          {cur.race?.id !== race.id && <button className="btn small" onClick={() => cur.setRace(race.id)}>Als aktuelles Rennen wählen</button>}
          <PcsLink url={pcsRaceUrl(race)}>PCS-Rennseite</PcsLink>
          <button className="btn small danger" onClick={async () => { if (await confirmDialog(`${race.name} ${race.year} mit Etappen und Startliste löschen? Fahrerprofile bleiben erhalten.`, 'Löschen')) { await createRestorePoint(`Vor Löschen von ${race.name}`); await deleteRace(race.id); go('rennen'); } }}>Löschen</button>
        </div>
        <div className="fields" style={{ marginTop: 8 }}>
          <label className="field">Name<CommitInput value={race.name} onCommit={(v) => v.trim() && updateRace(race.id, { name: v.trim() })} /></label>
          <label className="field">Jahr<CommitInput type="number" value={race.year} onCommit={(v) => Number(v) && updateRace(race.id, { year: Number(v) })} /></label>
          <label className="field">Start<CommitInput type="date" value={race.startDate} onCommit={(v) => updateRace(race.id, { startDate: v || undefined })} /></label>
          <label className="field">Ende<CommitInput type="date" value={race.endDate} onCommit={(v) => updateRace(race.id, { endDate: v || undefined })} /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}>PCS-Adresse<CommitInput value={race.pcsUrl} placeholder="https://www.procyclingstats.com/race/…" onCommit={(v) => updateRace(race.id, { pcsUrl: v.trim() || undefined })} /></label>
        </div>
        <div className="subtabs" role="tablist">
          <button role="tab" className={tab === 'uebersicht' ? 'on' : ''} onClick={() => setTab('uebersicht')}>Übersicht</button>
          <button role="tab" className={tab === 'etappen' ? 'on' : ''} onClick={() => setTab('etappen')}>{race.kind === 'eintages' ? 'Strecke' : 'Etappen'}</button>
          <button role="tab" className={tab === 'startliste' ? 'on' : ''} onClick={() => setTab('startliste')}>Startliste {counts ? <span className="muted small">{counts.entries} · {counts.profiles} Profile</span> : null}</button>
        </div>
        {tab === 'uebersicht' && <RaceSections race={race} />}
        {tab === 'etappen' && <Stages race={race} />}
        {tab === 'startliste' && <Startlist race={race} />}
      </div>
      {tab === 'uebersicht' && <RaceTopics race={race} />}
    </>
  );
}

function RaceSections({ race }: { race: Race }) {
  return (
    <>
      {RACE_SECTIONS.map((s) => (
        <div className="section" key={s.key}>
          <div className="section-head"><h3>{s.label}</h3><span className="hint">{s.hint}</span></div>
          <RichField label={`${s.label} – ${race.name}`} value={race.sections[s.key]} onSave={(h) => saveRaceSection(race.id, s.key, h)} placeholder={s.hint} />
        </div>
      ))}
    </>
  );
}

function RaceTopics({ race }: { race: Race }) {
  const topics = useLiveQuery(async () => alive(await db.topics.where('raceId').equals(race.id).toArray()), [race.id]) ?? [];
  return (
    <div className="panel">
      <div className="row"><h2 className="grow">Themen zum Rennen</h2>
        <button className="btn small" onClick={async () => { const t = await createTopic({ kind: 'statistik', raceId: race.id }); go(`themen-${t.id}`); }}>+ Thema</button>
      </div>
      {topics.length ? <TopicCards topics={topics} /> : <p className="muted small">Statistiken, Geschichten und Zitate mit Bezug zu diesem Rennen erscheinen hier und in LIVE.</p>}
    </div>
  );
}

function Stages({ race }: { race: Race }) {
  const stages = useLiveQuery(() => raceStages(race.id), [race.id]) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <table className="tbl">
        <thead><tr><th>Nr.</th><th>Datum</th><th>Start</th><th>Ziel</th><th>km</th><th>Profil</th><th>Notizen</th><th /></tr></thead>
        <tbody>
          {stages.map((s) => (
            <StageRow key={s.id} s={s} race={race} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        </tbody>
      </table>
      {race.kind === 'rundfahrt' && <button className="btn small" style={{ marginTop: 8 }} onClick={() => addStage(race.id)}>+ Etappe</button>}
    </>
  );
}

function StageRow({ s, race, open, onToggle }: { s: Stage; race: Race; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td style={{ width: 70 }}>{race.kind === 'rundfahrt' ? <CommitInput type="number" value={s.number} style={{ width: 56 }} onCommit={(v) => updateStage(s.id, { number: Number(v) })} aria-label="Etappennummer" /> : '–'}</td>
        <td><CommitInput type="date" value={s.date} onCommit={(v) => updateStage(s.id, { date: v || undefined })} aria-label="Datum" /></td>
        <td><CommitInput value={s.start} onCommit={(v) => updateStage(s.id, { start: v.trim() || undefined })} aria-label="Start" /></td>
        <td><CommitInput value={s.finish} onCommit={(v) => updateStage(s.id, { finish: v.trim() || undefined })} aria-label="Ziel" /></td>
        <td style={{ width: 90 }}><CommitInput type="number" value={s.distanceKm} style={{ width: 80 }} onCommit={(v) => updateStage(s.id, { distanceKm: v ? Number(v) : undefined })} aria-label="Distanz" /></td>
        <td>
          <select value={s.profile ?? ''} onChange={(e) => updateStage(s.id, { profile: (e.target.value || undefined) as Stage['profile'] })} aria-label="Profil">
            <option value="">–</option>
            {Object.entries(PROFILE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </td>
        <td><button className="btn small" onClick={onToggle} aria-expanded={open}>{s.notes ? '✎ Notizen' : '+ Notizen'}</button></td>
        <td>{race.kind === 'rundfahrt' && <button className="btn small danger" title="Etappe entfernen" onClick={async () => { if (await confirmDialog(`${stageLabel(s)} entfernen?`, 'Entfernen')) await removeStage(s.id); }}>✕</button>}</td>
      </tr>
      {open && (
        <tr><td colSpan={8}>
          <RichField label={`Notizen ${stageLabel(s, race.kind)}`} value={s.notes} onSave={(h) => updateStage(s.id, { notes: h })} placeholder="Schlüsselstellen, Anstiege, Wind, Zielankunft, Favoriten …" minLines={4} />
        </td></tr>
      )}
    </>
  );
}

function Startlist({ race }: { race: Race }) {
  const entries = useLiveQuery(() => raceEntries(race.id), [race.id]) ?? [];
  const [paste, setPaste] = useState(false);
  const [carry, setCarry] = useState(false);
  const [q, setQ] = useState('');
  const shown = useMemo(() => { const n = normalize(q); return n ? entries.filter((e) => normalize(`${e.bib ?? ''} ${e.name} ${e.team ?? ''}`).includes(n)) : entries; }, [entries, q]);
  return (
    <>
      <div className="row">
        <PcsLink url={race.pcsUrl ? `${race.pcsUrl.replace(/\/$/, '')}/startlist` : pcsRaceUrl(race)}>PCS-Startliste</PcsLink>
        <button className="btn small primary" onClick={() => { setPaste(!paste); setCarry(false); }}>Startliste einfügen …</button>
        <button className="btn small" onClick={() => { setCarry(!carry); setPaste(false); }}>Profil-Fahrer übernehmen …</button>
        <span className="grow" />
        <input type="search" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Startliste filtern" style={{ width: 200 }} />
      </div>
      {paste && <StartlistPaste race={race} onDone={() => setPaste(false)} />}
      {carry && <CarryRiders race={race} entries={entries} onDone={() => setCarry(false)} />}
      {entries.length ? (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>Nr.</th><th>Name</th><th>Team</th><th>PCS</th><th>Profil</th><th>Status</th><th /></tr></thead>
          <tbody>{shown.map((e) => <EntryRow key={e.id} e={e} race={race} />)}</tbody>
        </table>
      ) : <p className="muted" style={{ marginTop: 12 }}>Noch keine Startliste. Öffne die Startliste auf PCS, kopiere sie (Strg A, Strg C) und füge sie hier ein – oder übernimm deine Profil-Fahrer.</p>}
    </>
  );
}

function EntryRow({ e, race }: { e: Entry; race: Race }) {
  const [note, setNote] = useState(false);
  return (
    <>
      <tr className={e.status !== 'aktiv' ? 'out' : ''}>
        <td style={{ width: 70 }}><CommitInput value={e.bib} style={{ width: 56 }} onCommit={(v) => updateEntry(e.id, { bib: v.trim() || undefined })} aria-label={`Startnummer ${e.name}`} /></td>
        <td>{e.riderId ? <a href={`#fahrer-${e.riderId}`}>{e.name}</a> : e.name}</td>
        <td className="small">{e.team}</td>
        <td>{e.pcsSlug ? <PcsLink url={entryPcsUrl(e)} title={`PCS-Fahrerseite (${e.pcsSlug})`} /> : <span className="muted small" title="Kein Link zur PCS-Fahrerseite. Startliste direkt aus PCS kopieren und neu einfügen.">–</span>}</td>
        <td>{e.riderId ? <span className="chip flag">Profil</span> : <button className="btn small" onClick={async () => { const r = await profileFromEntry(e.id); go(`fahrer-${r.id}`); }}>+ Profil</button>}</td>
        <td>
          <select value={e.status} onChange={(ev) => setEntryStatus(e.id, ev.target.value as EntryStatus)} aria-label={`Status ${e.name}`}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn small" onClick={() => setNote(!note)} aria-expanded={note} title="Notiz zu diesem Fahrer bei diesem Rennen">{e.note ? '✎ Notiz' : '+ Notiz'}</button>{' '}
          <button className="btn small danger" title="Aus der Startliste entfernen" onClick={async () => { if (await confirmDialog(`${e.name} aus der Startliste von ${race.name} entfernen?`, 'Entfernen')) await removeEntry(e.id); }}>✕</button>
        </td>
      </tr>
      {note && <tr><td colSpan={6}><RichField label={`Notiz ${e.name} bei ${race.name}`} value={e.note} onSave={(h) => updateEntry(e.id, { note: h })} placeholder="Rolle im Team, Ziel bei diesem Rennen …" /></td></tr>}
    </>
  );
}

function StartlistPaste({ race, onDone }: { race: Race; onDone: () => void }) {
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [removeMissing, setRemoveMissing] = useState(false);
  const [res, setRes] = useState<StartlistResult | null>(null);
  const parsed = useMemo(() => (text.trim() ? parsePcsStartlist(text) : null), [text]);
  // PCS-Kennungen aus den mitkopierten Links (Name → Kennung)
  const slugs = useMemo(() => new Map(pcsRiderLinks(html).map((l) => [nameMatchKey(displayName(l.name)), l.slug])), [html]);
  const withSlug = parsed ? parsed.entries.filter((e) => slugs.has(nameMatchKey(displayName(e.name)))).length : 0;
  const apply = async () => {
    if (!parsed) return;
    await createRestorePoint(`Vor Startliste ${race.name}`);
    setRes(await applyStartlist(race.id, parsed.entries.map((e) => ({ bib: e.bib, name: e.name, team: e.team, pcsSlug: slugs.get(nameMatchKey(displayName(e.name))) })), { removeMissing }));
    setText(''); setHtml('');
  };
  return (
    <div className="banner">
      <p className="small" style={{ marginTop: 0 }}>Öffne die Startliste auf PCS (Knopf „PCS-Startliste“), drücke dort <b>Strg A</b> und <b>Strg C</b> und füge sie hier mit <b>Strg V</b> ein. Bestehende Einträge, Notizen und Status bleiben erhalten; Profile werden über den Namen verknüpft.</p>
      <textarea rows={4} style={{ width: '100%' }} value={text} onChange={(e) => { setText(e.target.value); setRes(null); if (!e.target.value.trim()) setHtml(''); }} onPaste={(e) => { const h = e.clipboardData.getData('text/html'); if (h) setHtml(h); }} placeholder="Kopierte PCS-Startliste …" aria-label="PCS-Startliste einfügen" autoFocus />
      {text.trim() && !parsed && <p className="warn small">Keine PCS-Startliste erkannt. Bitte die ganze Startlisten-Seite mit Strg A kopieren.</p>}
      {parsed && (
        <p className="small">
          Erkannt: <b>{parsed.entries.length} Fahrer</b> in {parsed.teams.length} Teams{parsed.meta.raceName ? ` – ${parsed.meta.raceName} ${parsed.meta.year ?? ''}` : ''}.
          {' '}{withSlug ? `${withSlug} mit Link zur PCS-Fahrerseite.` : <span className="warn">Ohne Links zu den PCS-Fahrerseiten – bitte direkt aus der PCS-Seite kopieren und mit Strg V einfügen (nicht als reiner Text).</span>}
          {parsed.warnings.map((w, i) => <span key={i} className="warn"> {w}</span>)}
        </p>
      )}
      {parsed && <label className="check small"><input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} /> Fahrer entfernen, die nicht mehr in der Liste stehen</label>}
      {res && <p className="small okc">Übernommen: {res.added} neu, {res.updated} aktualisiert, {res.unchanged} unverändert{res.removed ? `, ${res.removed} entfernt` : ''}. {res.withProfile} Fahrer mit Profil{res.linked ? ` (${res.linked} neu verknüpft)` : ''}.</p>}
      <div className="row">
        <button className="btn primary small" disabled={!parsed} onClick={apply}>Übernehmen</button>
        <button className="btn small" onClick={onDone}>Schliessen</button>
      </div>
    </div>
  );
}

/** Profil-Fahrer in dieses Rennen übernehmen (wenn sie starten). Zuletzt gefahrene zuerst. */
function CarryRiders({ race, entries, onDone }: { race: Race; entries: Entry[]; onDone: () => void }) {
  const list = useLiveQuery(profilesByLastRace, []) ?? [];
  const inRace = new Set(entries.map((e) => e.riderId).filter(Boolean));
  const avail = list.filter((x) => !inRace.has(x.rider.id));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const shown = avail.filter((x) => !q || normalize(`${x.rider.name} ${x.rider.team ?? ''}`).includes(normalize(q)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = async () => { await addRidersToRace(race.id, [...sel]); setSel(new Set()); onDone(); };
  return (
    <div className="banner">
      <p className="small" style={{ marginTop: 0 }}>Wähle die Profil-Fahrer, die bei {race.name} starten. Ihre Profile (Aktuell, Erfolge, Persönliches …) sind damit in LIVE verfügbar. Steht der Fahrer schon ohne Profil in der Startliste, wird er verknüpft.</p>
      <div className="row">
        <input type="search" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Profile filtern" />
        <button className="btn small" onClick={() => setSel(new Set(shown.map((x) => x.rider.id)))}>alle angezeigten</button>
        <button className="btn small" onClick={() => setSel(new Set())}>keine</button>
      </div>
      <div style={{ columns: '260px', marginTop: 8 }}>
        {shown.map(({ rider, lastRace }) => (
          <label key={rider.id} className="check" style={{ display: 'flex', breakInside: 'avoid' }}>
            <input type="checkbox" checked={sel.has(rider.id)} onChange={() => toggle(rider.id)} /> {rider.name}
            <span className="muted small">{[rider.team, lastRace ? `zuletzt ${lastRace.name} ${lastRace.year}` : null].filter(Boolean).join(' · ')}</span>
          </label>
        ))}
        {!shown.length && <p className="muted small">{list.length ? 'Alle Profil-Fahrer sind schon im Rennen.' : 'Noch keine Profile angelegt.'}</p>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary small" disabled={!sel.size} onClick={apply}>{sel.size} übernehmen</button>
        <button className="btn small" onClick={onDone}>Schliessen</button>
      </div>
    </div>
  );
}
