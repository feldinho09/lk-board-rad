import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HIGHLIGHTS, isRich, sanitize, toEditorHtml } from '../domain/richtext';

/**
 * Editor für formatierten Text. Werkzeugleiste: fett, kursiv, unterstrichen, Markierung
 * (4 Farben / entfernen), Aufzählung, Nummerierung, Einzug vergrößern/verkleinern.
 * Tastatur: Strg/Cmd+B/I/U, Tab / Umschalt+Tab = Einzug (in Listen), Esc verlässt das Feld.
 * Eingefügter Text wird bereinigt. Der Wert wird beim Verlassen des Feldes gemeldet
 * (und optional während des Tippens, siehe onInput).
 */
export function RichText({
  value, onChange, onInput, placeholder, label, compact, autoFocus,
}: {
  value: string;
  onChange: (html: string) => void;
  onInput?: (html: string) => void;
  placeholder?: string;
  label: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSent = useRef<string>(value);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(!value);

  // Externe Änderungen übernehmen, aber nie während der Nutzer tippt (kein Cursor-Springen).
  // useLayoutEffect: Inhalt steht vor dem ersten Zeichnen im Feld (kein kurzes Leer-Aufblitzen).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused) return;
    if (value !== lastSent.current || el.innerHTML === '') {
      el.innerHTML = toEditorHtml(value);
      lastSent.current = value;
      setEmpty(!value);
    }
  }, [value, focused]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const current = () => sanitize(ref.current?.innerHTML ?? '');
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, cmd === 'hiliteColor' ? 'true' : 'false');
    document.execCommand(cmd, false, arg);
    const html = current();
    setEmpty(!html);
    onInput?.(html);
  };
  const commit = () => {
    const html = current();
    if (html !== lastSent.current) { lastSent.current = html; onChange(html); }
  };

  const btn = (title: string, cmd: string, content: React.ReactNode, arg?: string) => (
    <button type="button" className="rt-btn" title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); exec(cmd, arg); }}>{content}</button>
  );

  return (
    <div className={`rt ${compact ? 'compact' : ''} ${focused ? 'focused' : ''}`}>
      <div className="rt-toolbar" role="toolbar" aria-label={`Formatierung ${label}`}>
        {btn('Fett (Strg+B)', 'bold', <b>F</b>)}
        {btn('Kursiv (Strg+I)', 'italic', <i>K</i>)}
        {btn('Unterstrichen (Strg+U)', 'underline', <u>U</u>)}
        <span className="rt-sep" />
        {HIGHLIGHTS.map((h) => (
          <button key={h.hex} type="button" className="rt-btn rt-color" title={`Markieren: ${h.name}`} aria-label={`Markieren ${h.name}`}
            style={{ background: h.hex }} onMouseDown={(e) => { e.preventDefault(); exec('hiliteColor', h.hex); }} />
        ))}
        {btn('Markierung entfernen', 'hiliteColor', <span className="rt-nocolor">⌀</span>, 'transparent')}
        <span className="rt-sep" />
        {btn('Aufzählung', 'insertUnorderedList', '•≡')}
        {btn('Nummerierung', 'insertOrderedList', '1.')}
        {btn('Einzug verkleinern (Umschalt+Tab)', 'outdent', '⇤')}
        {btn('Einzug vergrößern (Tab)', 'indent', '⇥')}
      </div>
      <div
        ref={ref}
        className={`rt-area ${empty ? 'empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder ?? ''}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onInput={() => { const h = current(); setEmpty(!h); onInput?.(h); }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); }
          if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLElement).blur(); }
        }}
        onPaste={(e) => {
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          e.preventDefault();
          if (html) document.execCommand('insertHTML', false, sanitize(html));
          else document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}

/** Anzeige formatierter oder alter Klartext-Werte – immer bereinigt. */
export function RichView({ value, className, inline }: { value?: string | null; className?: string; inline?: boolean }) {
  if (!value) return null;
  const Tag = inline ? 'span' : 'div';
  if (!isRich(value)) return <Tag className={`rt-view plain ${className ?? ''}`}>{value}</Tag>;
  return <Tag className={`rt-view ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: sanitize(value) }} />;
}
