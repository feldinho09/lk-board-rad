/**
 * Formatierter Text (fett, kursiv, unterstrichen, Markierung, Aufzählung, Einzug).
 *
 * Gespeichert wird bereinigtes HTML mit einer festen Erlaubnisliste. Alles andere –
 * Skripte, Links, Bilder, fremde Stile, Ereignis-Attribute – wird entfernt. Das gilt beim
 * Speichern, beim Einfügen aus der Zwischenablage UND bei jeder Anzeige (auch Daten aus
 * Sicherungen oder Importen gelten als nicht vertrauenswürdig, Bauplan 14).
 * Bisheriger reiner Text bleibt gültig und wird unverändert als Text angezeigt.
 */

export const HIGHLIGHTS = [
  { name: 'Gelb', hex: '#fff1a8' },
  { name: 'Grün', hex: '#c6f2c6' },
  { name: 'Rot', hex: '#ffc9c9' },
  { name: 'Blau', hex: '#cde3ff' },
] as const;

const KEEP = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SPAN']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK', 'SELECT', 'TEXTAREA', 'BUTTON', 'INPUT']);

/** Ist der gespeicherte Wert formatierter Text (HTML aus dem Editor) oder alter Klartext? */
export function isRich(v: string | undefined | null): boolean {
  return !!v && /^\s*<(p|div|ul|ol|b|strong|i|em|u|span|blockquote|br)[\s>/]/i.test(v);
}

function toHex(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
function paletteHex(color: string): string | null {
  const hex = toHex(color);
  return hex && HIGHLIGHTS.some((h) => h.hex === hex) ? hex : null;
}

/** Bereinigt HTML auf die Erlaubnisliste. Braucht DOMParser (Browser oder Test-DOM). */
export function sanitize(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r')!;
  const clean = (node: Node): Node[] => {
    if (node.nodeType === 3) return [doc.createTextNode(node.textContent ?? '')];
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) return [];
    const kids = [...el.childNodes].flatMap(clean);
    // Markierung: nur Hintergrundfarben aus der Palette (execCommand liefert <span style>, Word/Browser oft <mark>/<font>)
    let bg: string | null = null;
    const style = (el as HTMLElement).style;
    if (style?.backgroundColor) bg = paletteHex(style.backgroundColor);
    if (!bg && tag === 'MARK') bg = HIGHLIGHTS[0].hex;
    if (bg) {
      const span = doc.createElement('span');
      span.setAttribute('style', `background-color:${bg}`);
      kids.forEach((k) => span.appendChild(k));
      // Fett/kursiv/unterstrichen, die per Stil statt Tag gesetzt wurden, beibehalten
      const w = wrapInlineStyles(el, span);
      return Array.isArray(w) ? w : [w];
    }
    if (!KEEP.has(tag) || tag === 'SPAN') {
      // unbekanntes oder stilfreies Element: Inhalt behalten, Hülle weg (Block-Elemente als Absatz)
      const wrapped = wrapInlineStyles(el, null, kids);
      if (/^(H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|TABLE|TR|PRE|ADDRESS|FIGURE)$/.test(tag)) {
        const p = doc.createElement('div');
        (Array.isArray(wrapped) ? wrapped : [wrapped]).forEach((k) => p.appendChild(k));
        return [p];
      }
      return Array.isArray(wrapped) ? wrapped : [wrapped];
    }
    const out = doc.createElement(tag === 'STRONG' ? 'b' : tag === 'EM' ? 'i' : tag.toLowerCase());
    kids.forEach((k) => out.appendChild(k));
    return [out];
  };
  function wrapInlineStyles(src: Element, inner: Element | null, kids?: Node[]): Node | Node[] {
    const st = (src as HTMLElement).style;
    let node: Node | Node[] = inner ?? kids ?? [];
    const wrap = (tag: string) => {
      const w = doc.createElement(tag);
      (Array.isArray(node) ? node : [node]).forEach((k) => w.appendChild(k));
      node = w;
    };
    if (st) {
      if (/^(bold|[6-9]00)$/.test(st.fontWeight)) wrap('b');
      if (st.fontStyle === 'italic') wrap('i');
      if (/underline/.test(st.textDecoration || (st as unknown as Record<string, string>).textDecorationLine || '')) wrap('u');
    }
    return node;
  }
  const out = doc.createElement('div');
  [...root.childNodes].flatMap(clean).forEach((k) => out.appendChild(k));
  const result = out.innerHTML.replace(/(<br>\s*)+$/, '').trim();
  // Leerer Editor („<div><br></div>“) gilt als leer
  return (out.textContent ?? '').trim() === '' ? '' : `<div>${result}</div>`.replace(/^<div><div>([\s\S]*)<\/div><\/div>$/, '<div>$1</div>');
}

/** Klartext für Suche, CSV, Notfallübersicht, Fehlerberichte. Aufzählungen als „• “. */
export function toPlain(v: string | undefined | null): string {
  if (!v) return '';
  if (!isRich(v)) return v;
  const doc = new DOMParser().parseFromString(`<div>${v}</div>`, 'text/html');
  const lines: string[] = [];
  let cur = '';
  const flush = () => { if (cur.trim()) lines.push(cur.trimEnd()); cur = ''; };
  const walk = (n: Node, depth: number) => {
    if (n.nodeType === 3) { cur += n.textContent; return; }
    if (n.nodeType !== 1) return;
    const tag = (n as Element).tagName;
    if (tag === 'BR') { flush(); return; }
    const block = /^(DIV|P|LI|BLOCKQUOTE|UL|OL)$/.test(tag);
    if (block) flush();
    if (tag === 'LI') cur = '  '.repeat(Math.max(0, depth - 1)) + '• ';
    n.childNodes.forEach((c) => walk(c, depth + (tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE' ? 1 : 0)));
    if (block) flush();
  };
  walk(doc.body.firstChild!, 0);
  flush();
  return lines.join('\n');
}

/** Klartext → HTML für den Editor (Zeilenumbrüche bleiben erhalten). */
export function plainToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc ? `<div>${esc.split('\n').join('<br>')}</div>` : '';
}

export function toEditorHtml(v: string | undefined | null): string {
  return isRich(v) ? sanitize(v!) : plainToHtml(v ?? '');
}
