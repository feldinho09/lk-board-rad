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
