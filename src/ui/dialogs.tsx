import { useEffect, useRef, useState } from 'react';

/**
 * Eigene Bestätigungs- und Eingabedialoge statt window.confirm/prompt
 * (in der Artefakt-Sandbox gesperrt, im Live-Betrieb ohnehin störend).
 */
type Req =
  | { kind: 'confirm'; message: string; ok: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => (push ? push({ kind: 'confirm', message, ok, resolve }) : resolve(false)));
}
export function promptDialog(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => (push ? push({ kind: 'prompt', message, value, resolve }) : resolve(null)));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    push = (r) => { setReq(r); if (r.kind === 'prompt') setVal(r.value); };
    return () => { push = null; };
  }, []);
  useEffect(() => { if (req) (req.kind === 'prompt' ? input.current : okBtn.current)?.focus(); }, [req]);
  if (!req) return null;
  const close = (result: boolean) => {
    if (req.kind === 'confirm') req.resolve(result);
    else req.resolve(result ? val : null);
    setReq(null);
  };
  return (
    <div className="dialog-backdrop" onClick={() => close(false)}>
      <div className="dialog" role="alertdialog" aria-label={req.message} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } }}>
        <p style={{ whiteSpace: 'pre-wrap' }}>{req.message}</p>
        {req.kind === 'prompt' && (
          <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close(true)} style={{ width: '100%' }} aria-label="Eingabe" />
        )}
        <div className="row">
          <button ref={okBtn} onClick={() => close(true)}>{req.kind === 'confirm' ? req.ok : 'OK'}</button>
          <button className="link" onClick={() => close(false)}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
