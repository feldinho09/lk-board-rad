// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { sanitize, toPlain, isRich, plainToHtml, toEditorHtml } from './richtext';

describe('Formatierter Text', () => {
  it('behält fett, kursiv, unterstrichen, Listen, Einzug', () => {
    const h = sanitize('<div><b>Fett</b> <strong>stark</strong> <i>k</i> <em>e</em> <u>u</u><ul><li>eins<ul><li>zwei</li></ul></li></ul><blockquote>eingerückt</blockquote></div>');
    expect(h).toBe('<div><b>Fett</b> <b>stark</b> <i>k</i> <i>e</i> <u>u</u><ul><li>eins<ul><li>zwei</li></ul></li></ul><blockquote>eingerückt</blockquote></div>');
  });

  it('entfernt Skripte, Ereignis-Attribute, Links, Bilder und fremde Stile', () => {
    const h = sanitize('<div onclick="x()">a<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><span style="position:fixed;color:red">b</span><iframe src="https://evil"></iframe></div>');
    expect(h).toBe('<div>alinkb</div>');
    expect(h).not.toMatch(/script|onerror|onclick|href|iframe|style/);
  });

  it('Markierung nur in Palettenfarben; execCommand-rgb wird normalisiert, fremde Farben entfernt', () => {
    expect(sanitize('<div><span style="background-color: rgb(255, 224, 102);">wichtig</span></div>')).toBe('<div><span style="background-color:#ffe066">wichtig</span></div>');
    expect(sanitize('<div><span style="background-color: rgb(255, 168, 168);">Sturz</span></div>')).toBe('<div><span style="background-color:#ffa8a8">Sturz</span></div>');
    expect(sanitize('<div><span style="background-color: rgb(1, 2, 3);">x</span></div>')).toBe('<div>x</div>');
    expect(sanitize('<div><mark>Word-Markierung</mark></div>')).toContain('background-color:#ffe066');
    expect(sanitize('<div><span style="background-color: transparent;">weg</span></div>')).toBe('<div>weg</div>');
  });

  it('Formatierung per Stil (aus anderen Programmen eingefügt) wird zu Tags', () => {
    expect(sanitize('<div><span style="font-weight: 700">f</span><span style="font-style: italic">k</span></div>')).toBe('<div><b>f</b><i>k</i></div>');
  });

  it('leerer Editor ist leer; Klartext bleibt Klartext', () => {
    expect(sanitize('<div><br></div>')).toBe('');
    expect(isRich('Normaler Text mit <Zeichen>')).toBe(false);
    expect(isRich('<div><b>x</b></div>')).toBe(true);
    expect(toPlain('Alt & schlicht')).toBe('Alt & schlicht');
    expect(plainToHtml('a < b\nzweite')).toBe('<div>a &lt; b<br>zweite</div>');
    expect(toEditorHtml('<div><script>x</script>ok</div>')).toBe('<div>ok</div>');
  });

  it('Klartext für Suche/Export: Aufzählungen und Zeilen bleiben lesbar', () => {
    expect(toPlain('<div><b>Titel</b><ul><li>eins<ul><li>zwei</li></ul></li><li>drei</li></ul>Ende</div>')).toBe('Titel\n• eins\n  • zwei\n• drei\nEnde');
  });
});

describe('Stern-Zeilen für LIVE', () => {
  it('holt ★-Zeilen nach oben und lässt den Rest stehen', async () => {
    const { splitStarred } = await import('./richtext');
    const r = splitStarred('<div><ul><li>★ Wichtig</li><li>Normal</li><li>Mit <b>Unterpunkt</b><ul><li>★ tief</li></ul></li></ul><div>★ Absatz</div>Ende</div>');
    expect(r.starred).toEqual(['Wichtig', 'tief', 'Absatz']);
    expect(r.rest).toContain('Normal');
    expect(r.rest).toContain('Unterpunkt');
    expect(r.rest).toContain('Ende');
    expect(r.rest).not.toContain('★');
    expect(splitStarred('Klartext\n★ oben').starred).toEqual(['<div>oben</div>']);
    expect(splitStarred('')).toEqual({ starred: [], rest: '' });
  });
});
