// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { pcsRiderLinks } from './pcsPaste';

describe('PCS-Fahrer-Links aus eingefügtem HTML', () => {
  it('liest Kennungen aus den Links und ordnet sie der Startliste zu', () => {
    
    const html = '<ul><li>1<a href="rider/tadej-pogacar">POGAČAR Tadej</a></li><li>21<a href="https://www.procyclingstats.com/rider/jonas-vingegaard-rasmussen/">VINGEGAARD Jonas</a></li><li><a href="team/uae-team-emirates-2026">UAE</a></li><li><a href="rider/x/statistics">Stat</a></li></ul>';
    expect(pcsRiderLinks(html)).toEqual([{ name: 'POGAČAR Tadej', slug: 'tadej-pogacar' }, { name: 'VINGEGAARD Jonas', slug: 'jonas-vingegaard-rasmussen' }]);
    expect(pcsRiderLinks('')).toEqual([]);
  });
});

