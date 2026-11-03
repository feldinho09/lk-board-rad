/**
 * PDF-Textebene lesen (pdf.js, Apache-2.0). Läuft vollständig lokal im Browser,
 * auch offline. Es wird nur die Textebene gelesen (kein Rendering, keine Formulare/XFA,
 * keine eingebetteten Schriften als FontFace). pdf.js 6 nutzt kein eval; die CSP
 * der App verbietet es zusätzlich (script-src 'self').
 */
import type { PdfTextItem } from './pdfLayout';

export async function readPdfText(data: ArrayBuffer | Uint8Array): Promise<PdfTextItem[]> {
  // Legacy-Build: läuft auch in älteren Browsern (Modern-Build verlangt z. B. Promise.try)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const task = pdfjs.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
  if (doc.numPages > 60) throw new Error(`PDF hat ${doc.numPages} Seiten – für eine Startliste ungewöhnlich, bitte prüfen.`);
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const h = Math.hypot(a, b) || it.height;
      const font = (it.fontName ?? '') + ' ' + (styles[it.fontName]?.fontFamily ?? '');
      items.push({ page: p, str: it.str, x: e, y: f, w: it.width, h, bold: /bold|black|heavy/i.test(font) });
    }
  }
  return items;
  } finally {
    await task.destroy();
  }
}
