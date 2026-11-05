import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, mutate, newRecord } from '../db/db';
import type { Note, Stage, Versioned } from '../domain/types';
import { RichText } from './RichText';

type Kind = 'statistik' | 'thema';
const TITLE: Record<Kind, string> = { statistik: 'Statistiken', thema: 'Themen' };
const HINT: Record<Kind, string> = {
  statistik: 'Zahlen, Rekorde, Vergleiche – z. B. Siege, Durchschnittstempo, Bilanz am Schlussanstieg …',
  thema: 'Geschichten und Gesprächsstoff – z. B. Duelle, Comebacks, Wetter, Strecke …',
};

/** Eigene Sammlung „Statistiken“ oder „Themen“: ein Dokument fürs ganze Rennen und eines je Etappe. */
export function TopicDocs({ kind, editionId, stage }: { kind: Kind; editionId: string; stage: Stage | null }) {
  return (
    <div className="panel topic-docs">
      <h2>{TITLE[kind]}</h2>
      <TopicDoc kind={kind} editionId={editionId} title="Ganzes Rennen" />
      {stage && <TopicDoc kind={kind} editionId={editionId} stageId={stage.id} title={stage.label} />}
    </div>
  );
}

function TopicDoc({ kind, editionId, stageId, title }: { kind: Kind; editionId: string; stageId?: string; title: string }) {
  const note = useLiveQuery(
    async () => alive(await db.notes.where('refId').equals(editionId).toArray()).find((n) => n.scope === 'edition' && n.kind === kind && (n.stageId ?? null) === (stageId ?? null)) ?? null,
    [editionId, kind, stageId],
  );
  const [state, setState] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);
  const noteRef = useRef<Note | null | undefined>(note);
  noteRef.current = note;

  const save = async (html: string) => {
    latest.current = null;
    const cur = noteRef.current;
    if ((cur?.text ?? '') === html) { setState('saved'); return; }
    try {
      await mutate(['notes'], async (w) => {
        if (cur) await w.put('notes', { ...cur, text: html });
        else await w.put('notes', newRecord<Omit<Note, keyof Versioned>>({ scope: 'edition', refId: editionId, editionId, stageId, kind, text: html, toldInEditions: [], priority: false, private: true }) as Note);
      });
      setState('saved');
    } catch { setState('error'); }
  };
  // Während des Tippens nach kurzer Pause speichern (nicht erst beim Verlassen)
  const onInput = (html: string) => {
    latest.current = html;
    setState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (latest.current != null) void save(latest.current); }, 1200);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (latest.current != null) void save(latest.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (note === undefined) return null;
  return (
    <section className="topic-doc">
      <div className="topic-head">
        <h3>{title}</h3>
        <span className={`small ${state === 'error' ? 'err' : 'muted'}`}>
          {state === 'pending' ? 'wird gespeichert …' : state === 'error' ? '✕ Nicht gespeichert – Text bleibt im Feld' : note ? `✓ gespeichert ${new Date(note.updatedAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
      <RichText label={`${TITLE[kind]} ${title}`} placeholder={HINT[kind]} value={note?.text ?? ''} onInput={onInput} onChange={(h) => { if (timer.current) clearTimeout(timer.current); void save(h); }} />
    </section>
  );
}
