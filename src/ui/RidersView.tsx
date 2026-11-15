import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../db/db';
import { RIDER_SECTIONS, type Rider } from '../domain/types';
import { normalize } from '../domain/text';
import {
  ageOn, allRiders, createRider, createTopic, daysSince, deleteRider, pcsRiderUrl, pcsSlugFrom, saveRiderSection, splitName, updateRider,
} from '../domain/center';
import { pageMatchesRider, parsePcsRiderPages, pcsPagePatch } from '../import/pcsRider';
import { createRestorePoint } from '../backup/archive';
import { RichField } from './rich';
import { PcsLink } from './pcs';
import { confirmDialog, promptDialog } from './dialogs';
import { fmtDate, go, useCurrent } from './state';
import { TopicCards } from './TopicsView';
import { CommitInput } from './inputs';

export function RidersView({ id }: { id?: string }) {
  const riders = useLiveQuery(allRiders, []) ?? [];
  const cur = useCurrent();
  const inRace = useLiveQuery(async () => cur.race ? new Set(alive(await db.entries.where('raceId').equals(cur.race.id).toArray()).map((e) => e.riderId).filter(Boolean) as string[]) : new Set<string>(), [cur.race?.id]) ?? new Set<string>();
  const [q, setQ] = useState('');
  const [onlyRace, setOnlyRace] = useState(false);
  const list = useMemo(() => {
    const n = normalize(q);
    return riders.filter((r) => (!n || normalize(`${r.name} ${r.team ?? ''} ${r.nation ?? ''}`).includes(n)) && (!onlyRace || inRace.has(r.id)));
  }, [riders, q, onlyRace, inRace]);

  const add = async () => {
    const name = await promptDialog('Name des Fahrers (z. B. „Tadej Pogačar“):');
    if (!name?.trim()) return;
    const r = await createRider({ ...splitName(name.trim()), name: name.trim() });
    go(`fahrer-${r.id}`);
  };

  return (
    <main className="split">
      <aside className="panel sidelist">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Fahrer <span className="muted small">{riders.length}</span></h2>
          <button className="btn small primary" onClick={add}>+ Fahrer</button>
        </div>
        <input type="search" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Fahrer filtern" />
        {cur.race && <label className="check small"><input type="checkbox" checked={onlyRace} onChange={(e) => setOnlyRace(e.target.checked)} /> nur im Rennen {cur.race.name}</label>}
        <ul>
          {list.map((r) => (
            <li key={r.id}>
              <a href={`#fahrer-${r.id}`} className={r.id === id ? 'on' : ''}>
                {inRace.has(r.id) && <span className="dot" title="im gewählten Rennen" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--flag)', display: 'inline-block' }} />}
                <span>{r.name}</span><span className="meta">{[r.nation, r.team].filter(Boolean).join(' · ')}</span>
              </a>
            </li>
          ))}
          {!list.length && <li className="muted small" style={{ padding: 8 }}>{riders.length ? 'Kein Treffer.' : 'Noch keine Fahrer. Lege die wichtigsten Fahrer selbst an – oder aus der Startliste eines Rennens.'}</li>}
        </ul>
      </aside>
      <section>
        {id ? <RiderEditor id={id} /> : <div className="panel empty-state">Fahrer links auswählen oder neu anlegen.<br /><span className="small">Profile bleiben von Rennen zu Rennen erhalten: Sobald ein Fahrer in einer Startliste steht, ist sein Profil dort verknüpft.</span></div>}
      </section>
    </main>
  );
}

const FIELDS: { key: keyof Rider; label: string; type?: 'number' | 'date'; width?: number }[] = [
  { key: 'firstName', label: 'Vorname' }, { key: 'lastName', label: 'Nachname' }, { key: 'nation', label: 'Nation (IOC, z. B. SUI)' }, { key: 'team', label: 'Team' },
  { key: 'birthDate', label: 'Geburtsdatum', type: 'date' }, { key: 'birthPlace', label: 'Geburtsort' }, { key: 'residence', label: 'Wohnort' },
  { key: 'heightCm', label: 'Grösse (cm)', type: 'number' }, { key: 'weightKg', label: 'Gewicht (kg)', type: 'number' },
  { key: 'riderType', label: 'Fahrertyp' }, { key: 'pronunciation', label: 'Aussprache' },
];

function RiderEditor({ id }: { id: string }) {
  const r = useLiveQuery(() => db.riders.get(id), [id]);
  const topics = useLiveQuery(async () => alive(await db.topics.where('riderIds').equals(id).toArray()), [id]) ?? [];
  const races = useLiveQuery(async () => {
    const es = alive(await db.entries.where('riderId').equals(id).toArray());
    const rs = (await db.races.bulkGet(es.map((e) => e.raceId))).filter((x) => x && !x.deleted);
    return rs.map((race, i) => ({ race: race!, entry: es[i] })).sort((a, b) => (b.race.startDate ?? '').localeCompare(a.race.startDate ?? ''));
  }, [id]) ?? [];
  if (r === undefined) return null;
  if (!r || r.deleted) return <div className="panel empty-state">Dieser Fahrer existiert nicht (mehr).</div>;

  const saveField = (key: keyof Rider, raw: string, type?: string) => {
    const v = raw.trim();
    const val = type === 'number' ? (v ? Number(v.replace(',', '.')) : undefined) : v || undefined;
    if ((r[key] ?? undefined) === val) return;
    if ((key === 'firstName' || key === 'lastName') && !v) return;
    void updateRider(r.id, { [key]: val } as Partial<Rider>);
  };
  const age = ageOn(r.birthDate, new Date().toISOString().slice(0, 10));
  const stale = daysSince(r.aktuellAt);

  return (
    <>
      <div className="panel">
        <div className="row">
          <h1 className="grow" style={{ fontSize: '2rem' }}>{r.name}</h1>
          <PcsLink url={pcsRiderUrl(r)}>PCS-Seite</PcsLink>
          <button className="btn small danger" onClick={async () => { if (await confirmDialog(`${r.name} löschen? Startlisten behalten den Namen.`, 'Löschen')) { await createRestorePoint(`Vor Löschen von ${r.name}`); await deleteRider(r.id); go('fahrer'); } }}>Löschen</button>
        </div>
        <p className="muted" style={{ margin: '2px 0 10px' }}>{[r.nation, r.team, age != null ? `${age} Jahre` : null, r.riderType].filter(Boolean).join(' · ') || 'Noch keine Angaben'}</p>
        <div className="fields">
          {FIELDS.map((f) => (
            <label key={`${r.id}-${f.key}`} className="field">{f.label}
              <CommitInput type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={r[f.key] as string | number | undefined} onCommit={(v) => saveField(f.key, v, f.type)} />
            </label>
          ))}
          <label key={`${r.id}-pcs`} className="field">PCS-Adresse oder -Kennung
            <CommitInput value={r.pcsSlug} placeholder="tadej-pogacar" onCommit={(v) => { const s = pcsSlugFrom(v) ?? (v.trim() || undefined); if (s !== r.pcsSlug) void updateRider(r.id, { pcsSlug: s }); }} />
          </label>
        </div>
        <PcsPaste rider={r} />
      </div>

      <div className="panel">
        {RIDER_SECTIONS.map((s) => (
          <div className="section" key={s.key}>
            <div className="section-head">
              <h3>{s.label}</h3><span className="hint">{s.hint}</span>
              {s.key === 'aktuell' && r.aktuellAt && <span className={`small ${stale != null && stale > 14 ? 'warn' : 'muted'}`} style={{ marginLeft: 'auto' }}>zuletzt geändert {fmtDate(r.aktuellAt)}{stale != null && stale > 0 ? ` (vor ${stale} ${stale === 1 ? 'Tag' : 'Tagen'})` : ''}</span>}
            </div>
            <RichField label={`${s.label} – ${r.name}`} value={r.sections[s.key]} onSave={(h) => saveRiderSection(r.id, s.key, h)} placeholder={s.hint} minLines={s.key === 'aktuell' ? 4 : 3} />
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="row"><h2 className="grow">Themen zu {r.name}</h2>
          <button className="btn small" onClick={async () => { const t = await createTopic({ kind: 'notiz', riderIds: [r.id] }); go(`themen-${t.id}`); }}>+ Thema</button>
        </div>
        {topics.length ? <TopicCards topics={topics} /> : <p className="muted small">Noch keine Statistiken, Geschichten oder Zitate mit diesem Fahrer verknüpft.</p>}
      </div>

      <div className="panel">
        <h2>Rennen</h2>
        {races.length ? (
          <ul>{races.map(({ race, entry }) => <li key={entry.id}><a href={`#rennen-${race.id}`}>{race.name} {race.year}</a>{entry.bib ? ` · Nr. ${entry.bib}` : ''}{entry.team ? ` · ${entry.team}` : ''}</li>)}</ul>
        ) : <p className="muted small">Noch in keiner Startliste. Füge die Startliste eines Rennens ein – Profile werden über den Namen automatisch verknüpft.</p>}
      </div>
    </>
  );
}

/** Kopierte PCS-Fahrerseite einfügen: füllt nur leere Felder und Abschnitte. */
function PcsPaste({ rider }: { rider: Rider }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState('');
  const page = useMemo(() => parsePcsRiderPages(text)[0], [text]);
  const matches = page ? pageMatchesRider(page, rider) : false;
  const res = page ? pcsPagePatch(rider, page) : null;
  const apply = async () => {
    if (!res || !res.changes.length) return;
    await createRestorePoint(`Vor PCS-Übernahme ${rider.name}`);
    await updateRider(rider.id, res.patch);
    setMsg(`Übernommen: ${res.changes.join(', ')}.`); setText(''); setForce(false); setOpen(false);
  };
  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <div className="row">
          <button className="btn small" onClick={() => { setOpen(true); setMsg(''); }}>PCS-Seite einfügen …</button>
          {msg && <span className="small okc">{msg}</span>}
        </div>
      ) : (
        <div className="banner">
          <p className="small" style={{ marginTop: 0 }}>Öffne die PCS-Seite von {rider.name} (Knopf oben), drücke dort <b>Strg A</b> und <b>Strg C</b> und füge sie hier mit <b>Strg V</b> ein. Gefüllt werden nur leere Felder und leere Abschnitte (Erfolge, Person, Persönliches) – nichts Eigenes wird überschrieben.</p>
          <textarea rows={3} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Kopierte PCS-Fahrerseite …" aria-label="PCS-Fahrerseite einfügen" autoFocus />
          {text.trim() && !page && <p className="warn small">Keine PCS-Fahrerseite erkannt (die Zeile „Name:“ fehlt). Bitte die ganze Seite mit Strg A kopieren.</p>}
          {page && !matches && <label className="check warn small"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Die Seite gehört zu „{page.name}“{page.birthDate ? ` (${page.birthDate.slice(0, 4)})` : ''}, nicht eindeutig zu {rider.name}. Trotzdem übernehmen</label>}
          {res && <p className="small">{res.changes.length ? <>Wird ergänzt: {res.changes.join(', ')}</> : 'Nichts Neues – alle Felder sind schon ausgefüllt.'}</p>}
          <div className="row">
            <button className="btn primary small" disabled={!res?.changes.length || (!matches && !force)} onClick={apply}>Übernehmen</button>
            <button className="btn small" onClick={() => { setOpen(false); setText(''); }}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}
