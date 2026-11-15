import { useEffect, useState } from 'react';

/** Hell/Dunkel: Wahl wird im Browser gemerkt (localStorage, nur Anzeige-Einstellung). */
export type Theme = 'dark' | 'light';
const KEY = 'rcc-theme';
export function readTheme(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* privat */ }
  return 'dark';
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f3ef' : '#1a1d21');
}
export function ThemeToggle() {
  const [t, setT] = useState<Theme>(readTheme);
  useEffect(() => { applyTheme(t); try { localStorage.setItem(KEY, t); } catch { /* egal */ } }, [t]);
  return (
    <button className="btn small" onClick={() => setT(t === 'dark' ? 'light' : 'dark')} title={t === 'dark' ? 'Zur Hell-Ansicht wechseln' : 'Zur Dunkel-Ansicht wechseln'} aria-label={t === 'dark' ? 'Hell-Ansicht' : 'Dunkel-Ansicht'}>
      {t === 'dark' ? '☀ Hell' : '☾ Dunkel'}
    </button>
  );
}
