import { useEffect, useRef, useState } from 'react';
import { search, type SearchHit } from '../domain/search';
import { useApp } from './state';

/** Ereignis, mit dem globale Tastenkürzel die Live-Suche öffnen (optional mit erstem Zeichen). */
export const LIVE_SEARCH_EVENT = 'lk-live-search';
export function openLiveSearch(initial = ''): void {
  window.dispatchEvent(new CustomEvent(LIVE_SEARCH_EVENT, { detail: initial }));
}

/**
 * Zentrale Suche im Live-Modus: immer sichtbar über der Fahrerkarte.
 * Startnummer tippen + Enter = Fahrer gewählt. Esc leert und verlässt das Feld.
 * Treffer außerhalb des Rennens öffnen nichts im Live-Modus (kein Seitenwechsel mitten im Rennen).
 */
export function LiveSearch() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsFor, setHitsFor] = useState('');
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const initial = (e as CustomEvent<string>).detail ?? '';
      setQ(initial);
      setOpen(true);
      input.current?.focus();
    };
    window.addEventListener(LIVE_SEARCH_EVENT, on);
    return () => window.removeEventListener(LIVE_SEARCH_EVENT, on);
  }, []);

  useEffect(() => {
    let cancel = false;
    if (!q.trim()) { setHits([]); setHitsFor(q); return; }
    search(q, app.editionId, 8).then((h) => { if (!cancel) { setHits(h); setHitsFor(q); setIdx(0); } });
    return () => { cancel = true; };
  }, [q, app.editionId]);

  const done = () => { setQ(''); setHits([]); setOpen(false); input.current?.blur(); };
  const choose = (h: SearchHit) => {
    if (h.participation) { app.select(h.rider.id); done(); }
    else if (app.mode !== 'live') { location.hash = `#fahrer-${h.rider.id}`; done(); }
  };

  return (
    <div className="live-search" role="search">
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Verzögert schließen (Klick auf Treffer), aber nicht, wenn das Feld inzwischen wieder fokussiert ist
        onBlur={() => setTimeout(() => { if (document.activeElement !== input.current) setOpen(false); }, 150)}
        placeholder="Startnummer oder Name – einfach tippen (Ziffer, S oder /)"
        aria-label="Fahrer suchen"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Escape') { e.preventDefault(); done(); }
          if (e.key === 'Enter') {
            e.preventDefault();
            // Nie auf veraltete Treffer reagieren (schnelles Tippen + Enter)
            if (hitsFor === q) { if (hits[idx]) choose(hits[idx]); }
            else void search(q, app.editionId, 8).then((h) => h[0] && choose(h[0]));
          }
        }}
      />
      {open && q.trim() !== '' && (
        <ul className="hits live-hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.rider.id} role="option" aria-selected={i === idx} className={`${i === idx ? 'sel' : ''} ${h.participation ? '' : 'outside'}`} onMouseDown={() => choose(h)}>
              <span className="bib">{h.participation?.bib ?? '—'}</span>
              <span className="name">{h.rider.displayName}</span>
              <span className="muted">{h.participation?.teamName ?? 'nicht in diesem Rennen'}</span>
            </li>
          ))}
          {hits.length === 0 && hitsFor === q && <li className="muted">Keine Treffer</li>}
        </ul>
      )}
    </div>
  );
}
