import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive } from '../db/db';
import { TOPIC_KINDS, type Topic, type TopicKind } from '../domain/types';
import { allRiders, createTopic, deleteTopic, updateTopic } from '../domain/center';
import { normalize } from '../domain/text';
import { toPlain } from '../domain/richtext';
import { RichField, RichView } from './rich';
import { CommitInput } from './inputs';
import { confirmDialog } from './dialogs';
import { go, useCurrent } from './state';

const kindLabel = (k: TopicKind) => TOPIC_KINDS.find((x) => x.key === k)?.label ?? k;

export function TopicsView({ id }: { id?: string }) {
  const topics = useLiveQuery(async () => alive(await db.topics.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), []) ?? [];
  const races = useLiveQuery(async () => alive(await db.races.toArray()), []) ?? [];
  const riders = useLiveQuery(allRiders, []) ?? [];
  const cur = useCurrent();
  const [kind, setKind] = useState<TopicKind | ''>('');
  const [raceId, setRaceId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [starred, setStarred] = useState(false);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const n = normalize(q);
    return topics.filter((t) => (!kind || t.kind === kind) && (!raceId || t.raceId === raceId) && (!riderId || t.riderIds.includes(riderId)) && (!starred || t.starred)
      && (!n || normalize(`${t.title} ${toPlain(t.body)} ${t.source ?? ''}`).includes(n)));
  }, [topics, kind, raceId, riderId, starred, q]);
  const add = async (k: TopicKind) => {
    const t = await createTopic({ kind: k, raceId: raceId || cur.race?.id, riderIds: riderId ? [riderId] : [] });
    go(`themen-${t.id}`);
  };

  return (
    <main>
      <div className="panel">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Themen <span className="muted small">Statistiken, Geschichten, Hintergründe, Notizen, Zitate</span></h2>
          {TOPIC_KINDS.map((k) => <button key={k.key} className="btn small" onClick={() => add(k.key)}>+ {k.label}</button>)}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Themen durchsuchen" style={{ width: 240 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as TopicKind | '')} aria-label="Art"><option value="">Alle Arten</option>{TOPIC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          <select value={raceId} onChange={(e) => setRaceId(e.target.value)} aria-label="Rennen"><option value="">Alle Rennen</option>{races.map((r) => <option key={r.id} value={r.id}>{r.name} {r.year}</option>)}</select>
          <select value={riderId} onChange={(e) => setRiderId(e.target.value)} aria-label="Fahrer"><option value="">Alle Fahrer</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <label className="check"><input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} /> nur ★</label>
          <span className="muted small">{shown.length} von {topics.length}</span>
        </div>
      </div>
      {id && <TopicEditor key={id} id={id} />}
      <div style={{ marginTop: 12 }}>
        {shown.length ? <TopicCards topics={shown} activeId={id} /> : <div className="panel empty-state">{topics.length ? 'Keine Treffer.' : 'Noch keine Themen. Lege oben eine Statistik, Geschichte, einen Hintergrund, eine Notiz oder ein Zitat an.'}</div>}
      </div>
    </main>
  );
}

/** Kompakte Karten (Themen-Liste, Fahrerprofil, Rennseite). */
export function TopicCards({ topics, activeId }: { topics: Topic[]; activeId?: string }) {
  const names = useLiveQuery(async () => {
    const ids = [...new Set(topics.flatMap((t) => t.riderIds))];
    const rs = await db.riders.bulkGet(ids);
    const races = await db.races.bulkGet([...new Set(topics.map((t) => t.raceId).filter(Boolean) as string[])]);
    return { riders: new Map(rs.filter(Boolean).map((r) => [r!.id, r!.name])), races: new Map(races.filter(Boolean).map((r) => [r!.id, `${r!.name} ${r!.year}`])) };
  }, [topics.map((t) => t.id + t.rev).join()]);
  return (
    <div className="cards">
      {topics.map((t) => (
        <a key={t.id} href={`#themen-${t.id}`} className={`card ${t.id === activeId ? 'on' : ''}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
          <div className="row" style={{ gap: 6 }}>
            <span className={`kind ${t.kind}`}>{kindLabel(t.kind)}</span>
            {t.starred && <span style={{ color: 'var(--accent)' }} title="In LIVE hervorgehoben">★</span>}
            <span className="grow" />
            {t.raceId && names?.races.get(t.raceId) && <span className="muted small">{names.races.get(t.raceId)}{t.stageNumber != null ? ` · Etappe ${t.stageNumber}` : ''}</span>}
          </div>
          {t.title && <h3>{t.title}</h3>}
          <div style={{ maxHeight: '7.5em', overflow: 'hidden' }}><RichView value={t.body} /></div>
          {(t.riderIds.length > 0 || t.source) && (
            <div className="muted small" style={{ marginTop: 4 }}>{t.riderIds.map((r) => names?.riders.get(r)).filter(Boolean).join(', ')}{t.source ? `${t.riderIds.length ? ' · ' : ''}Quelle: ${t.source}` : ''}</div>
          )}
        </a>
      ))}
    </div>
  );
}

function TopicEditor({ id }: { id: string }) {
  const t = useLiveQuery(() => db.topics.get(id), [id]);
  const races = useLiveQuery(async () => alive(await db.races.toArray()), []) ?? [];
  const riders = useLiveQuery(allRiders, []) ?? [];
  const [add, setAdd] = useState('');
  if (t === undefined) return null;
  if (!t || t.deleted) return <div className="panel empty-state">Dieser Eintrag existiert nicht (mehr).</div>;
  const linked = t.riderIds.map((r) => riders.find((x) => x.id === r)).filter(Boolean);
  const cands = add ? riders.filter((r) => !t.riderIds.includes(r.id) && normalize(r.name).includes(normalize(add))).slice(0, 8) : [];
  return (
    <div className="panel" style={{ marginTop: 12, borderColor: 'var(--flag)' }}>
      <div className="row">
        <select value={t.kind} onChange={(e) => updateTopic(t.id, { kind: e.target.value as TopicKind })} aria-label="Art">{TOPIC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <CommitInput value={t.title} placeholder="Titel" className="grow" style={{ fontSize: '1.15rem', fontWeight: 600 }} onCommit={(v) => updateTopic(t.id, { title: v.trim() })} aria-label="Titel" autoFocus={!t.title} />
        <button className={`btn small ${t.starred ? 'primary' : ''}`} onClick={() => updateTopic(t.id, { starred: !t.starred })} aria-pressed={!!t.starred} title="In LIVE hervorheben">★ {t.starred ? 'hervorgehoben' : 'hervorheben'}</button>
        <button className="btn small" onClick={() => go('themen')}>Schliessen</button>
        <button className="btn small danger" onClick={async () => { if (await confirmDialog('Diesen Eintrag löschen?', 'Löschen')) { await deleteTopic(t.id); go('themen'); } }}>Löschen</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <RichField label="Text" value={t.body} onSave={(h) => updateTopic(t.id, { body: h })} placeholder={t.kind === 'zitat' ? '«Zitat …»' : 'Text …'} minLines={5} big />
      </div>
      <div className="fields" style={{ marginTop: 10 }}>
        <label className="field">Rennen
          <select value={t.raceId ?? ''} onChange={(e) => updateTopic(t.id, { raceId: e.target.value || undefined, stageNumber: undefined })}>
            <option value="">– kein bestimmtes –</option>{races.map((r) => <option key={r.id} value={r.id}>{r.name} {r.year}</option>)}
          </select>
        </label>
        {t.raceId && <label className="field">Etappe (optional)<CommitInput type="number" value={t.stageNumber} onCommit={(v) => updateTopic(t.id, { stageNumber: v === '' ? undefined : Number(v) })} /></label>}
        <label className="field" style={{ gridColumn: 'span 2' }}>{t.kind === 'zitat' ? 'Wer, wann, wo' : 'Quelle'}<CommitInput value={t.source} onCommit={(v) => updateTopic(t.id, { source: v.trim() || undefined })} /></label>
      </div>
      <div style={{ marginTop: 10 }}>
        <span className="small muted">Fahrer: </span>
        {linked.map((r) => <span key={r!.id} className="chip" style={{ marginRight: 4 }}>{r!.name}<button aria-label={`${r!.name} entfernen`} onClick={() => updateTopic(t.id, { riderIds: t.riderIds.filter((x) => x !== r!.id) })}>✕</button></span>)}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <input placeholder="+ Fahrer verknüpfen" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Fahrer verknüpfen" style={{ height: 30 }} />
          {cands.length > 0 && (
            <div className="panel" style={{ position: 'absolute', zIndex: 20, top: 32, left: 0, minWidth: 240, padding: 4 }}>
              {cands.map((r) => <button key={r.id} className="linkbtn" style={{ display: 'block', padding: 4, textDecoration: 'none', color: 'var(--paint)' }} onClick={() => { void updateTopic(t.id, { riderIds: [...t.riderIds, r.id] }); setAdd(''); }}>{r.name}</button>)}
            </div>
          )}
        </span>
      </div>
    </div>
  );
}
