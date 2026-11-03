import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getDevice, setDevice } from '../db/db';

export type Mode = 'bearbeiten' | 'live';

interface AppState {
  ready: boolean;
  storageError: string | null;
  editionId: string | null;
  stageId: string | null;
  mode: Mode;
  selectedRiderId: string | null;
  pinned: string[];
  pinLimit: number;
  fontScale: 'normal' | 'gross';
  theme: 'dunkel' | 'hell' | 'kontrast';
  setEdition(id: string | null): void;
  setStage(id: string | null): void;
  setMode(m: Mode): void;
  select(riderId: string | null): void;
  togglePin(riderId: string): void;
  setFontScale(f: 'normal' | 'gross'): void;
  setTheme(t: 'dunkel' | 'hell' | 'kontrast'): void;
}

const Ctx = createContext<AppState | null>(null);

/** Gerätebezogene Arbeitszustände – getrennt vom fachlichen Datenbestand. */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [mode, setModeS] = useState<Mode>('bearbeiten');
  const [selectedRiderId, setSelected] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [fontScale, setFontScaleS] = useState<'normal' | 'gross'>('normal');
  const [theme, setThemeS] = useState<'dunkel' | 'hell' | 'kontrast'>('dunkel');
  const pinLimit = 4;

  useEffect(() => {
    (async () => {
      try {
      setEditionId(await getDevice('activeEditionId', null));
      setStageId(await getDevice('activeStageId', null));
      setModeS(await getDevice('mode', 'bearbeiten'));
      setPinned(await getDevice('pinned', []));
      setFontScaleS(await getDevice('fontScale', 'normal'));
      setThemeS(await getDevice('theme', 'dunkel'));
      } catch (e) {
        setStorageError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.font = fontScale;
  }, [theme, fontScale]);

  const setEdition = useCallback((id: string | null) => {
    setEditionId(id);
    setStageId(null);
    setSelected(null);
    void setDevice('activeEditionId', id);
    void setDevice('activeStageId', null);
  }, []);
  const setStage = useCallback((id: string | null) => {
    setStageId(id);
    void setDevice('activeStageId', id);
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeS(m);
    void setDevice('mode', m);
  }, []);
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= pinLimit ? prev : [...prev, id];
      void setDevice('pinned', next);
      return next;
    });
  }, []);
  const setFontScale = useCallback((f: 'normal' | 'gross') => { setFontScaleS(f); void setDevice('fontScale', f); }, []);
  const setTheme = useCallback((t: 'dunkel' | 'hell' | 'kontrast') => { setThemeS(t); void setDevice('theme', t); }, []);

  return (
    <Ctx.Provider value={{
      ready, storageError, editionId, stageId, mode, selectedRiderId: selectedRiderId, pinned, pinLimit, fontScale, theme,
      setEdition, setStage, setMode, select: setSelected, togglePin, setFontScale, setTheme,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppStateProvider fehlt');
  return c;
}

/** Einfaches Hash-Routing: funktioniert offline aus index.html ohne Server-Rewrite. */
export function useRoute(): [string[], (path: string) => void] {
  // Nur schlichte #name-Anker (Artefakt-Sandbox erlaubt kein #/pfad): #live, #rennen, #rennen-<uuid>
  const parse = () => {
    const h = location.hash.replace(/^#\/?/, '') || 'live';
    const i = h.indexOf('-');
    return i < 0 ? [h] : [h.slice(0, i), h.slice(i + 1)];
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (p: string) => { location.hash = '#' + p; }];
}

/** Tastenkürzel nicht auslösen, während Text eingegeben wird. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
