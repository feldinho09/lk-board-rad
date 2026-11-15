import { useEffect, useRef, useState } from 'react';

/**
 * Eingabefeld, das beim Verlassen (oder Enter) speichert. Änderungen von aussen werden
 * übernommen, solange das Feld nicht bearbeitet wird – kein Fokusverlust beim Tabben.
 */
export function CommitInput({ value, onCommit, type = 'text', ...rest }: {
  value: string | number | undefined;
  onCommit: (v: string) => void;
  type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value == null ? '' : String(value)); }, [value]);
  return (
    <input {...rest} type={type} value={v}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { focused.current = false; if (v !== (value == null ? '' : String(value))) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value == null ? '' : String(value)); setTimeout(() => (e.target as HTMLInputElement).blur()); } }} />
  );
}

/** Mehrzeiliges Feld, das beim Verlassen speichert; wächst mit dem Inhalt. */
export function CommitTextarea({ value, onCommit, ...rest }: {
  value: string | undefined;
  onCommit: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!focused.current) setV(value ?? ''); }, [value]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } }, [v]);
  return (
    <textarea {...rest} ref={ref} rows={1} value={v}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { focused.current = false; if (v !== (value ?? '')) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { setV(value ?? ''); setTimeout(() => (e.target as HTMLTextAreaElement).blur()); } }} />
  );
}

/** Uhrzeit, die jede `everyMs` neu rendert. */
export function useNow(everyMs = 15000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}
