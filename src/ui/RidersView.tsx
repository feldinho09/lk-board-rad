import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate, newRecord } from '../db/db';
import type { Note, Rider } from '../domain/types';
import { normalize, riderSearchTokens } from '../domain/text';
import { toPlain } from '../domain/richtext';
import { RichText, RichView } from './RichText';
import { WikidataPanel } from './WikidataPanel';
import { useApp } from './state';
import { confirmDialog } from './dialogs';

type F<T> = Omit<T, 'id' | 'rev' | 'createdAt' | 'updatedAt'>;

export function RidersView({ id }: { id?: string }) {
  return id ? <RiderDetail id={id} /> : <RiderList />;
}

function RiderList() {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const total = useLiveQuery(() => db.riders.count(), []) ?? 0;
  const list = useLiveQuery(async () => {
    const nq = normalize(q);
    const base = nq ? db.riders.where('searchTokens').startsWith(nq.split(' ')[0]) : db.riders.orderBy('lastName');
    const rows = await base.limit(400).toArray();
    const seen = new Set<string>();
    return alive(rows).filter((r) => !seen.has(r.id) && seen.add(r.id) && (showArchived || !r.archived) && !r.mergedInto).slice(0, 200);
  }, [q, showArchived]) ?? [];

  const create = async () => {
    const r = newRecord<F<Rider>>({ firstName: '', lastName: 'Neuer Fahrer', displayName: 'Neuer Fahrer', aliases: [], keyFacts: [], tags: [], externalIds: [], searchTokens: ['neuer', 'fahrer', 'neuer fahrer'] }) as Rider;
    await mutate(['riders'], (w) => w.put('riders', r));
    location.hash = `#fahrer-${r.id}`;
  };

  return (
    <div className="page">
      <h1>Fahrer <span className="muted">({total} im Bestand)</span></h1>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name filtern (auch ohne Akzente)" aria-label="Fahrer filtern" />
        <label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte</label>
        <button onClick={create}>+ Fahrer</button>
      </div>
      <WikidataPanel />
      <table className="table">
        <thead><tr><th>Name</th><th>Nation</th><th>Geburt</th><th>Typ</th><th>Aussprache</th></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td><a href={`#fahrer-${r.id}`}>{r.displayName}</a>{r.archived && <span className="tag">archiviert</span>}</td>
              <td>{r.nationality ?? '–'}</td><td>{r.birthDate ?? 'unbekannt'}</td><td>{r.riderType ?? '–'}</td><td>{r.pronunciation ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 200 && <p className="muted">Nur die ersten 200 Treffer – Filter verfeinern.</p>}
    </div>
  );
}

function RiderDetail({ id }: { id: string }) {
  const app = useApp();
  const rider = useLiveQuery(() => db.riders.get(id), [id]);
  const parts = useLiveQuery(() => db.participations.where('riderId').equals(id).toArray().then(alive), [id]) ?? [];
  const editions = useLiveQuery(async () => new Map((await db.editions.bulkGet(parts.map((p) => p.editionId))).filter(Boolean).map((e) => [e!.id, e!])), [parts]) ?? new Map();
  const notes = useLiveQuery(() => db.notes.where('refId').equals(id).toArray().then(alive), [id]) ?? [];
  const [draft, setDraft] = useState<Rider | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteKey, setNoteKey] = useState(0);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (rider && (!draft || draft.id !== rider.id)) setDraft(rider); }, [rider]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rider || !draft) return <p>Fahrer nicht gefunden.</p>;
  if (rider.mergedInto) return <p>Dieser Datensatz wurde zusammengeführt. <a href={`#fahrer-${rider.mergedInto}`}>Zum aktuellen Profil</a></p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(rider);
  const set = (patch: Partial<Rider>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    const displayName = draft.displayName.trim() || `${draft.firstName} ${draft.lastName}`.trim();
    const next = { ...draft, displayName, searchTokens: riderSearchTokens(draft.firstName, draft.lastName, displayName, draft.aliases), keyFacts: draft.keyFacts.filter(Boolean).slice(0, 3) };
    await mutate(['riders'], (w) => w.put('riders', next));
    setMsg('Lokal gespeichert. Bereits laufende und archivierte Rennen behalten ihre Teilnahmedaten (Team, Startnummer).');
  };
  const addNote = async () => {
    if (!toPlain(noteText).trim()) return;
    await mutate(['notes'], (w) => w.put('notes', newRecord<F<Note>>({ scope: 'rider', refId: id, text: noteText, toldInEditions: [], priority: false, private: true }) as Note));
    setNoteKey((k) => k + 1);
    setNoteText('');
  };

  return (
    <div className="page">
      <p><a href="#fahrer">← Fahrer</a></p>
      <h1>{rider.displayName}</h1>
      <fieldset className="form grid2">
        <legend>Profil (rennunabhängig)</legend>
        <label>Vorname <input value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} /></label>
        <label>Nachname <input value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} /></label>
        <label>Angezeigter Name <input value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} /></label>
        <label>Aliasnamen (Komma) <input value={draft.aliases.join(', ')} onChange={(e) => set({ aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
        <label>Aussprache <input value={draft.pronunciation ?? ''} onChange={(e) => set({ pronunciation: e.target.value })} /></label>
        <label>Nationalität <input value={draft.nationality ?? ''} onChange={(e) => set({ nationality: e.target.value || undefined })} /></label>
        <label>Geburtsdatum oder -jahr <input value={draft.birthDate ?? ''} placeholder="JJJJ oder JJJJ-MM-TT – leer lassen, wenn unbekannt" onChange={(e) => set({ birthDate: e.target.value || undefined })} /></label>
        <label>Geburtsort <input value={draft.birthPlace ?? ''} onChange={(e) => set({ birthPlace: e.target.value || undefined })} /></label>
        <label>Fahrertyp <input value={draft.riderType ?? ''} onChange={(e) => set({ riderType: e.target.value || undefined })} /></label>
        <label>Tags (Komma) <input value={draft.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
        <div className="wide rt-field"><span className="rt-label">Stärken</span>
          <RichText label="Stärken" compact value={draft.strengths ?? ''} onInput={(h) => set({ strengths: h || undefined })} onChange={(h) => set({ strengths: h || undefined })} />
        </div>
        <div className="wide rt-field"><span className="rt-label">Kurzbiografie</span>
          <RichText label="Kurzbiografie" value={draft.bio ?? ''} onInput={(h) => set({ bio: h || undefined })} onChange={(h) => set({ bio: h || undefined })} />
        </div>
        {[0, 1, 2].map((i) => {
          const setFact = (h: string) => { const k = [...draft.keyFacts]; k[i] = h; set({ keyFacts: k }); };
          return (
            <div key={i} className="wide rt-field"><span className="rt-label">Schlüsselfakt {i + 1}</span>
              <RichText label={`Schlüsselfakt ${i + 1}`} compact value={draft.keyFacts[i] ?? ''} onInput={setFact} onChange={setFact} />
            </div>
          );
        })}
        <label>Quellen <input value={draft.sources ?? ''} onChange={(e) => set({ sources: e.target.value || undefined })} /></label>
        <label>Zuletzt geprüft <input type="date" value={draft.lastVerifiedAt ?? ''} onChange={(e) => set({ lastVerifiedAt: e.target.value || undefined })} /></label>
        <div className="wide muted small">Externe IDs: {rider.externalIds.length ? rider.externalIds.map((e) => `${e.ns}:${e.value}`).join(', ') : 'keine'}</div>
      </fieldset>
      <div className="row">
        <button disabled={!dirty} onClick={save}>Speichern</button>
        {dirty && <button className="link" onClick={() => setDraft(rider)}>Verwerfen</button>}
        <button className="link" disabled={app.mode === 'live'} onClick={() => mutate(['riders'], (w) => w.put('riders', { ...rider, archived: !rider.archived }))}>{rider.archived ? 'Archivierung aufheben' : 'Archivieren'}</button>
        {msg && <span className="ok small">{msg}</span>}
      </div>

      <h2>Notizen</h2>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id}>
            {editNote === n.id
              ? <RichText label="Notiz bearbeiten" autoFocus value={n.text} onChange={(h) => { setEditNote(null); if (h && h !== n.text) void mutate(['notes'], (w) => w.put('notes', { ...n, text: h })); }} />
              : <RichView value={n.text} />}
            {n.private && <span className="tag">privat</span>}
            {editNote !== n.id && <button className="link" onClick={() => setEditNote(n.id)}>bearbeiten</button>}
            <button className="link" onClick={() => mutate(['notes'], (w) => w.put('notes', { ...n, priority: !n.priority }))}>{n.priority ? '★ Schlüsselfakt' : 'als Schlüsselfakt'}</button>
            <button className="link" onClick={async () => { if (await confirmDialog('Notiz löschen?', 'Löschen')) await mutate(['notes'], (w) => w.remove('notes', n.id)); }}>löschen</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <div style={{ flex: 1 }}><RichText key={noteKey} label="Neue Notiz" placeholder="Hintergrundnotiz – mit Formatierung" value="" onInput={setNoteText} onChange={setNoteText} /></div>
        <button onClick={addNote}>Notiz hinzufügen</button>
      </div>

      <h2>Teilnahmen</h2>
      <table className="table">
        <thead><tr><th>Rennen</th><th>Nr.</th><th>Team damals</th><th>Status</th></tr></thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}><td><a href={`#rennen-${p.editionId}`}>{editions.get(p.editionId)?.name}</a></td><td>{p.bib}</td><td>{p.teamName}</td><td>{p.status}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
