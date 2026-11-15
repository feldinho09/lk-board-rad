import { useEffect, useRef, useState } from 'react';
import { searchAll, type Hit } from '../domain/center';
import { go } from './state';

const KIND = { rider: 'Fahrer', race: 'Rennen', topic: 'Thema' } as const;

/** Suche über alles (Strg K): Fahrer, Rennen, Themen – auch in Texten, akzentunabhängig. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { let stop = false; void searchAll(q).then((h) => { if (!stop) { setHits(h); setI(0); } }); return () => { stop = true; }; }, [q]);
  const open = (h: Hit) => { go(`${h.kind === 'rider' ? 'fahrer' : h.kind === 'race' ? 'rennen' : 'themen'}-${h.id}`); onClose(); };
  return (
    <div className="qsearch" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Suche">
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fahrer, Rennen, Themen, Stichwort …" aria-label="Suchbegriff"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter' && hits[i]) open(hits[i]);
          }} />
        <ul>
          {hits.map((h, k) => (
            <li key={`${h.kind}-${h.id}`}><button className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => open(h)}>
              <span className="muted small" style={{ minWidth: 60 }}>{KIND[h.kind]}</span><span className="grow">{h.title}</span><span className="muted small">{h.sub}</span>
            </button></li>
          ))}
          {q && !hits.length && <li className="muted" style={{ padding: 8 }}>Nichts gefunden.</li>}
        </ul>
      </div>
    </div>
  );
}
