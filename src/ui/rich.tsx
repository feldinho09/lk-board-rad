import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HIGHLIGHTS, STAR, isRich, sanitize, splitStarred, toEditorHtml } from '../domain/richtext';

/**
 * Formatierbares Textfeld wie im MotoGP Command Center: Die Formatierungsleiste erscheint
 * schwebend über der Markierung (siehe FormatToolbar). Speichert beim Tippen (verzögert)
 * und beim Verlassen; externe Änderungen werden übernommen, solange man nicht tippt.
 */
export function RichField({ value, onSave, label, placeholder, minLines = 3, big }: {
  value: string | undefined;
  onSave: (html: string) => unknown;
  label: string;
  placeholder?: string;
  minLines?: number;
  big?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(value ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(!value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused) return;
    if ((value ?? '') !== last.current || el.innerHTML === '') {
      el.innerHTML = toEditorHtml(value ?? '');
      last.current = value ?? '';
      setEmpty(!value);
    }
  }, [value, focused]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = () => {
    clearTimeout(timer.current);
    const html = sanitize(ref.current?.innerHTML ?? '');
    if (html !== last.current) { last.current = html; void onSave(html); }
  };
  const changed = () => {
    setEmpty(!(ref.current?.textContent ?? '').trim());
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  };

  return (
    <div
      ref={ref}
      className={`rich ${big ? 'big' : ''} ${empty ? 'empty' : ''}`}
      style={{ minHeight: `${minLines * 1.5 + 1}em` }}
      contentEditable
      suppressContentEditableWarning
      data-hl=""
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-placeholder={placeholder ?? ''}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); save(); }}
      onInput={changed}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { e.preventDefault(); listAction(e.shiftKey ? 'out' : 'in'); changed(); }
        if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLElement).blur(); }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (html) document.execCommand('insertHTML', false, sanitize(html));
        else document.execCommand('insertText', false, text);
      }}
    />
  );
}

/** Formatierten Text anzeigen (immer bereinigt). */
export function RichView({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  if (!isRich(value)) return <div className={`rich-view plain ${className ?? ''}`}>{value}</div>;
  return <div className={`rich-view ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: sanitize(value) }} />;
}

/** LIVE: Stern-Zeilen zuoberst (hervorgehoben), danach der übrige Text. */
export function LiveText({ value, emptyText }: { value?: string | null; emptyText?: string }) {
  const { starred, rest } = splitStarred(value);
  if (!starred.length && !rest) return emptyText ? <p className="muted small">{emptyText}</p> : null;
  return (
    <div className="live-text">
      {starred.length > 0 && (
        <ul className="starred">{starred.map((h, i) => <li key={i} dangerouslySetInnerHTML={{ __html: sanitize(`<div>${h}</div>`) }} />)}</ul>
      )}
      {rest && <RichView value={rest} />}
    </div>
  );
}

// ------------------------------------------------------------------ Befehle

const activeEditor = (): HTMLElement | null => {
  const sel = document.getSelection();
  const n = sel?.anchorNode;
  const el = (n instanceof HTMLElement ? n : n?.parentElement) ?? null;
  return el?.closest('[data-hl][contenteditable]') as HTMLElement | null;
};

function fire(el: HTMLElement | null) { el?.dispatchEvent(new Event('input', { bubbles: true })); }

export function listAction(kind: 'bullet' | 'in' | 'out' | 'star') {
  const ed = activeEditor();
  if (!ed) return;
  if (kind === 'bullet') document.execCommand('insertUnorderedList');
  else if (kind === 'in') document.execCommand('indent');
  else if (kind === 'out') document.execCommand('outdent');
  else toggleStar(ed);
  fire(ed);
}

/** ★ am Anfang der aktuellen Zeile setzen bzw. entfernen. */
function toggleStar(ed: HTMLElement) {
  const sel = document.getSelection();
  if (!sel?.anchorNode) return;
  let node: Node | null = sel.anchorNode;
  // Zeile = nächster Listenpunkt/Absatz innerhalb des Feldes; sonst Textzeile direkt im Feld
  let block: HTMLElement | null = (node instanceof HTMLElement ? node : node.parentElement)?.closest('li, div, p') as HTMLElement | null;
  if (!block || block === ed || !ed.contains(block)) {
    // Text direkt im Feld: in einen Absatz einpacken
    while (node && node.parentNode !== ed) node = node.parentNode;
    if (!node) return;
    const div = document.createElement('div');
    ed.insertBefore(div, node);
    div.appendChild(node);
    block = div;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  if (first && first.data.trimStart().startsWith(STAR)) first.data = first.data.replace(/^\s*★\s?/, '');
  else if (first) first.data = `${STAR} ${first.data.trimStart()}`;
  else block.prepend(document.createTextNode(`${STAR} `));
}

export function formatAction(kind: 'bold' | 'italic' | 'clear' | string) {
  const ed = activeEditor();
  if (!ed) return;
  if (kind === 'bold' || kind === 'italic') document.execCommand(kind);
  else if (kind === 'clear') {
    document.execCommand('removeFormat');
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('hiliteColor', false, 'transparent');
  } else {
    const h = HIGHLIGHTS.find((x) => x.key === kind);
    if (h) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('hiliteColor', false, h.hex);
      document.execCommand('styleWithCSS', false, 'false');
    }
  }
  fire(ed);
}

/**
 * Schwebende Formatierungsleiste (einmal in der App): erscheint über der Markierung bzw.
 * am Cursor, solange ein formatierbares Feld den Fokus hat.
 */
export function FormatToolbar() {
  const [pos, setPos] = useState<{ top: number; left: number; sel: boolean; b: boolean; i: boolean } | null>(null);
  const holding = useRef(false);
  useEffect(() => {
    const update = () => {
      if (holding.current) return;
      const sel = document.getSelection();
      const ed = activeEditor();
      if (!sel || !ed || document.activeElement !== ed) { setPos(null); return; }
      const collapsed = sel.isCollapsed;
      const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : new DOMRect();
      const box = ed.getBoundingClientRect();
      const top0 = r.height ? r.top : box.top;
      const top = top0 > 60 ? top0 - 48 : (r.height ? r.bottom : box.bottom) + 8;
      const left = Math.max(8, Math.min((r.width || r.left ? r.left : box.left) - 10, window.innerWidth - 640));
      setPos({ top, left, sel: !collapsed, b: document.queryCommandState('bold'), i: document.queryCommandState('italic') });
    };
    const later = () => setTimeout(update, 0);
    document.addEventListener('selectionchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  if (!pos) return null;
  const btn = 'fmt-btn';
  return (
    <div className="fmt-bar" role="toolbar" aria-label="Formatieren" style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => { e.preventDefault(); holding.current = true; }} onMouseUp={() => { holding.current = false; }}>
      <button className={btn} title="Aufzählungszeichen ein/aus" aria-label="Aufzählungszeichen ein oder aus" onClick={() => listAction('bullet')}>• ≡</button>
      <button className={btn} title="Einzug kleiner (Umschalt+Tab)" aria-label="Einzug kleiner" onClick={() => listAction('out')}>⇤</button>
      <button className={btn} title="Einzug grösser (Tab)" aria-label="Einzug grösser" onClick={() => listAction('in')}>⇥</button>
      <button className={btn} title="Stern: Punkt in LIVE nach oben (★ am Zeilenanfang ein/aus)" aria-label="Stern ein oder aus" onClick={() => listAction('star')}>★</button>
      {pos.sel && (
        <>
          <span className="fmt-sep" />
          <button className={`${btn} b ${pos.b ? 'on' : ''}`} title="Fett (Strg+B)" aria-label="Fett" aria-pressed={pos.b} onClick={() => formatAction('bold')}>B</button>
          <button className={`${btn} i ${pos.i ? 'on' : ''}`} title="Kursiv (Strg+I)" aria-label="Kursiv" aria-pressed={pos.i} onClick={() => formatAction('italic')}>I</button>
          <span className="fmt-sep" />
          {HIGHLIGHTS.map((h) => (
            <button key={h.key} className="fmt-hl" style={{ backgroundColor: h.hex }} title={`Leuchtstift ${h.name}: ${h.meaning}`} aria-label={`Leuchtstift ${h.name}: ${h.meaning}`} onClick={() => formatAction(h.key)}>{h.meaning}</button>
          ))}
          <span className="fmt-sep" />
          <button className={btn} title="Alle Formatierungen entfernen" aria-label="Formatierung entfernen" onClick={() => formatAction('clear')}>✕</button>
        </>
      )}
    </div>
  );
}
