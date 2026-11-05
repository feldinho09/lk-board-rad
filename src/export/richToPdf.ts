/**
 * Formatierten Text (bereinigtes HTML aus dem Editor) in pdfmake-Inhalte umwandeln:
 * fett, kursiv, unterstrichen, Markierung, Aufzählung, Nummerierung, Einzug.
 * Alter Klartext wird unverändert als Text übernommen.
 */
import { isRich, sanitize } from '../domain/richtext';

export type PdfRun = { text: string; bold?: boolean; italics?: boolean; decoration?: 'underline'; background?: string };
export type PdfBlock =
  | { text: PdfRun[]; margin?: number[] }
  | { ul: PdfBlock[]; margin?: number[] }
  | { ol: PdfBlock[]; margin?: number[] }
  | { stack: PdfBlock[]; margin?: number[] };

interface Style { bold?: boolean; italics?: boolean; underline?: boolean; background?: string }

export function richToPdf(value: string | undefined | null): PdfBlock[] {
  if (!value) return [];
  if (!isRich(value)) return value.split('\n').map((l) => ({ text: [{ text: l }] }));
  const doc = new DOMParser().parseFromString(`<div>${sanitize(value)}</div>`, 'text/html');
  return blocksOf(doc.body.firstChild as Element, {});
}

function blocksOf(parent: Node, style: Style): PdfBlock[] {
  const out: PdfBlock[] = [];
  let runs: PdfRun[] = [];
  const flush = () => {
    // führende/abschließende Leerzeilen einer Zeile entfernen, leere Zeilen auslassen
    if (runs.some((r) => r.text.trim() !== '')) out.push({ text: runs });
    runs = [];
  };
  const inline = (n: Node, st: Style) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (t) runs.push(run(t, st));
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName;
    if (tag === 'BR') { flush(); return; }
    if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = [...el.children].filter((c) => c.tagName === 'LI' || c.tagName === 'UL' || c.tagName === 'OL').map((li) => {
        const inner = li.tagName === 'LI' ? blocksOf(li, st) : blocksOf({ childNodes: [li] } as unknown as Node, st);
        return inner.length === 1 ? inner[0] : { stack: inner };
      });
      out.push(tag === 'UL' ? { ul: items } : { ol: items });
      return;
    }
    if (tag === 'BLOCKQUOTE') { flush(); out.push({ stack: blocksOf(el, st), margin: [14, 0, 0, 0] }); return; }
    if (tag === 'DIV' || tag === 'P' || tag === 'LI') { flush(); out.push(...blocksOf(el, st)); return; }
    const next: Style = { ...st };
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM') next.italics = true;
    if (tag === 'U') next.underline = true;
    const bg = (el as HTMLElement).style?.backgroundColor;
    if (bg) next.background = toHex(bg) ?? next.background;
    el.childNodes.forEach((c) => inline(c, next));
  };
  parent.childNodes.forEach((c) => inline(c, style));
  flush();
  return out;
}

function run(text: string, st: Style): PdfRun {
  const r: PdfRun = { text };
  if (st.bold) r.bold = true;
  if (st.italics) r.italics = true;
  if (st.underline) r.decoration = 'underline';
  if (st.background) r.background = st.background;
  return r;
}

function toHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : null;
}
