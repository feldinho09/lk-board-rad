import { useEffect, useRef, useState } from 'react';
import { search, type SearchHit } from '../domain/search';
import { useApp } from './state';

export function SearchDialog({ onClose, initial = '' }: { onClose: () => void; initial?: string }) {
  const app = useApp();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsFor, setHitsFor] = useState('');
  const [idx, setIdx] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let cancel = false;
    const t0 = performance.now();
    search(q, app.editionId).then((h) => {
      if (cancel) return;
      setHits(h);
      setHitsFor(q);
      setIdx(0);
      setMs(Math.round(performance.now() - t0));
    });
    return () => { cancel = true; };
  }, [q, app.editionId]);

  const choose = (h: SearchHit) => {
    if (h.participation) {
      app.select(h.rider.id);
      location.hash = '#live';
    } else location.hash = `#fahrer-${h.rider.id}`;
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog search" role="dialog" aria-label="Suche" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Startnummer oder Name (auch ohne Akzente)"
          aria-label="Suchbegriff"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter') {
              // Nie auf veraltete Treffer reagieren: bei schneller Eingabe erst aktuelle Suche abwarten
              if (hitsFor === q) { if (hits[idx]) choose(hits[idx]); }
              else void search(q, app.editionId).then((h) => h[0] && choose(h[0]));
            }
            if (e.key === 'Escape') onClose();
          }}
        />
        <ul className="hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.rider.id} role="option" aria-selected={i === idx} className={i === idx ? 'sel' : ''} onMouseDown={() => choose(h)}>
              <span className="bib">{h.participation?.bib ?? '—'}</span>
              <span className="name">{h.rider.displayName}</span>
              <span className="muted">{h.participation?.teamName ?? (h.rider.nationality ?? '')}</span>
              <span className="tag">{h.reason === 'startnummer' ? 'Startnummer' : h.reason === 'name_im_rennen' ? 'im Rennen' : 'Datenbank'}</span>
            </li>
          ))}
          {q && hits.length === 0 && <li className="muted">Keine Treffer</li>}
        </ul>
        {ms != null && q && <div className="muted small">{hits.length} Treffer · {ms} ms</div>}
      </div>
    </div>
  );
}
