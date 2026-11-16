// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { matchPcsSlugs, pcsRiderLinks, slugFromHref } from './pcsPaste';

describe('PCS-Fahrer-Links aus eingefügtem HTML', () => {
  it('liest Kennungen aus relativen und absoluten Links, Startnummer aus dem Listeneintrag', () => {
    const html = '<ul><li>1<a href="rider/tadej-pogacar">POGAČAR Tadej</a></li>'
      + '<li><span>21</span> <span class="flag"></span><a href="https://www.procyclingstats.com/rider/jonas-vingegaard-rasmussen/">VINGEGAARD Jonas</a></li>'
      + '<li><a href="team/uae-team-emirates-2026">UAE</a></li><li><a href="/rider/tadej-pogacar/statistics">Stat</a></li></ul>';
    expect(pcsRiderLinks(html)).toEqual([
      { name: 'POGAČAR Tadej', slug: 'tadej-pogacar', bib: '1' },
      { name: 'VINGEGAARD Jonas', slug: 'jonas-vingegaard-rasmussen', bib: '21' },
    ]);
    expect(pcsRiderLinks('')).toEqual([]);
    expect(slugFromHref('https://www.procyclingstats.com/rider/ben-o-connor?x=1')).toBe('ben-o-connor');
    expect(slugFromHref('race/tour-de-france/2026')).toBeUndefined();
  });

  it('ordnet zu: Name, sonst Startnummer, sonst Namensteile in der Kennung', () => {
    const entries = [
      { bib: '1', name: 'POGAČAR Tadej' },
      { bib: '21', name: 'VINGEGAARD Jonas' },
      { bib: '5', name: 'O\'CONNOR Ben' },
      { bib: '7', name: 'UNBEKANNT Max' },
    ];
    const links = [
      { name: 'Pogačar Tadej', slug: 'tadej-pogacar' },                 // Linktext in anderer Schreibweise
      { name: '', slug: 'jonas-vingegaard-rasmussen', bib: '21' },      // Linktext leer, Nummer passt
      { name: 'Ben', slug: 'ben-o-connor' },                            // nur Kennung passt
    ];
    expect(matchPcsSlugs(entries, links)).toEqual(['tadej-pogacar', 'jonas-vingegaard-rasmussen', 'ben-o-connor', undefined]);
  });
});
