/** Wikidata-Abgleich mit nachgebildeten API-Antworten (kein Netz im Test). */
import { describe, it, expect } from 'vitest';
import { lookupRiders, applyLookup, lookupChanged, shortIntro, wdDate, wdQuantity, type Fetcher } from './wikidata';
import type { Rider } from '../domain/types';

const rider = (id: string, first: string, last: string, extra: Partial<Rider> = {}): Rider => ({
  id, rev: 1, createdAt: '', updatedAt: '', firstName: first, lastName: last, displayName: `${first} ${last}`,
  aliases: [], keyFacts: [], tags: [], externalIds: [], searchTokens: [], ...extra,
});
const time = (t: string, precision = 11) => ({ mainsnak: { datavalue: { value: { time: t, precision } } } });
const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const str = (s: unknown) => ({ mainsnak: { datavalue: { value: s } } });

const SEARCH: Record<string, unknown[]> = {
  'Jonas Brändli': [{ id: 'Q1', label: 'Jonas Brändli' }, { id: 'Q9', label: 'Jonas Brändli' }],
  'Luca Bianchi': [{ id: 'Q2', label: 'Luca Bianchi' }, { id: 'Q3', label: 'Luca Bianchi' }],
  'Anna Muster': [],
  'Lars Ovrebo': [{ id: 'Q5', label: 'Lars Øvrebø' }],
};
const ENT: Record<string, unknown> = {
  Q1: {
    descriptions: { de: { value: 'Schweizer Radrennfahrer' } }, labels: { de: { value: 'Jonas Brändli' } },
    claims: {
      P569: [time('+1998-04-12T00:00:00Z')], P1532: [item('Q39')], P27: [item('Q39')],
      P2048: [str({ amount: '+1.82', unit: 'http://www.wikidata.org/entity/Q11573' })], P2067: [str({ amount: '+68', unit: 'http://www.wikidata.org/entity/Q11570' })],
      P551: [item('Q72')], P1663: [str('jonas-brandli')],
    },
    sitelinks: { dewiki: { title: 'Jonas Brändli' } },
  },
  Q72: { labels: { de: { value: 'Zürich' } }, claims: {} },
  Q9: { descriptions: { de: { value: 'Schweizer Politiker' } }, labels: { de: { value: 'Jonas Brändli' } }, claims: { P569: [time('+1960-01-01T00:00:00Z')] } },
  Q2: { descriptions: { en: { value: 'Italian cyclist' } }, labels: { en: { value: 'Luca Bianchi' } }, claims: { P569: [time('+1997-00-00T00:00:00Z', 9)], P27: [item('Q38')] } },
  Q3: { descriptions: { en: { value: 'Italian racing cyclist' } }, labels: { en: { value: 'Luca Bianchi' } }, claims: { P569: [time('+2004-05-02T00:00:00Z')], P27: [item('Q38')] } },
  Q5: { descriptions: { en: { value: 'Norwegian racing cyclist' } }, labels: { en: { value: 'Lars Øvrebø' } }, claims: { P569: [time('+2001-09-03T00:00:00Z')], P27: [item('Q20')] } },
  Q39: { labels: { de: { value: 'Schweiz' } }, claims: { P984: [str('SUI')], P298: [str('CHE')] } },
  Q38: { labels: { de: { value: 'Italien' } }, claims: { P984: [str('ITA')], P298: [str('ITA')] } },
  Q20: { labels: { de: { value: 'Norwegen' } }, claims: { P298: [str('NOR')] } },
};
const calls: string[] = [];
const fake: Fetcher = async (url) => {
  calls.push(url);
  const u = new URL(url);
  const p = u.searchParams;
  expect(p.get('origin')).toBe('*');
  if (u.hostname === 'de.wikipedia.org') {
    expect(p.get('exintro')).toBe('1');
    return { query: { pages: { '1': { title: 'Jonas Brändli', extract: 'Jonas Brändli (* 12. April 1998 in Zürich) ist ein Schweizer Radrennfahrer, der vor allem als Zeitfahrer bekannt ist.\nZweiter Absatz.' } } } };
  }
  if (p.get('action') === 'wbsearchentities') return { search: SEARCH[p.get('search')!] ?? [] };
  const ids = p.get('ids')!.split('|');
  return { entities: Object.fromEntries(ids.map((id) => [id, ENT[id] ?? { missing: '' }])) };
};

describe('Wikidata', () => {
  it('Datum nur so genau wie die Quelle', () => {
    expect(wdDate({ time: '+1998-04-12T00:00:00Z', precision: 11 })).toBe('1998-04-12');
    expect(wdDate({ time: '+1997-00-00T00:00:00Z', precision: 9 })).toBe('1997');
    expect(wdDate({ time: '+1900-00-00T00:00:00Z', precision: 7 })).toBeUndefined();
  });

  it('eindeutiger Radsportler → sicher; Politiker gleichen Namens wird ignoriert; IOC-Kürzel', async () => {
    const [r] = await lookupRiders([rider('a', 'Jonas', 'Brändli')], { fetcher: fake });
    expect(r).toMatchObject({ status: 'sicher', chosen: { qid: 'Q1', birthDate: '1998-04-12', nationality: 'SUI' }, conflicts: [] });
  });

  it('zwei Radsportler gleichen Namens → mehrdeutig; vorhandener Jahrgang entscheidet', async () => {
    const [a, b] = await lookupRiders([rider('a', 'Luca', 'Bianchi'), rider('b', 'Luca', 'Bianchi', { birthDate: '2004' })], { fetcher: fake });
    expect(a.status).toBe('mehrdeutig');
    expect(b).toMatchObject({ status: 'sicher', chosen: { qid: 'Q3', birthDate: '2004-05-02' } });
  });

  it('nicht gefunden; Widerspruch zur vorhandenen Nation → nicht automatisch', async () => {
    const res = await lookupRiders([rider('a', 'Anna', 'Muster'), rider('b', 'Lars', 'Ovrebo', { nationality: 'DEN' })], { fetcher: fake });
    expect(res[0].status).toBe('nicht_gefunden');
    expect(res[1].status).toBe('mehrdeutig'); // NOR widerspricht DEN
    expect(res[1].candidates[0].nationality).toBe('NOR'); // ISO, wenn kein IOC-Code vorhanden
  });

  it('Übernahme füllt nur leere Felder, ergänzt Jahrgang zum Datum, speichert Quelle und ID', async () => {
    const [r] = await lookupRiders([rider('a', 'Jonas', 'Brändli')], { fetcher: fake });
    const before = rider('a', 'Jonas', 'Brändli', { birthDate: '1998', nationality: 'SUI', sources: 'Startliste' });
    const after = applyLookup(before, r.chosen!, false, '2026-11-05');
    expect(after.birthDate).toBe('1998-04-12');
    expect(after.externalIds).toEqual([{ ns: 'wikidata', value: 'Q1' }]);
    expect(after.sources).toBe('Startliste; Wikidata Q1 (abgerufen 2026-11-05)');
    const keep = applyLookup(rider('a', 'Jonas', 'Brändli', { nationality: 'LIE' }), r.chosen!, false);
    expect(keep.nationality).toBe('LIE');
    expect(applyLookup(rider('a', 'Jonas', 'Brändli', { nationality: 'LIE' }), r.chosen!, true).nationality).toBe('SUI');
  });

  it('Zusatzinfos: Kurzbio aus Wikipedia, Grösse, Gewicht, Wohnort, PCS-Kennung – nur leere Felder', async () => {
    const [r] = await lookupRiders([rider('a', 'Jonas', 'Brändli')], { fetcher: fake, extras: true });
    expect(r.chosen).toMatchObject({ heightCm: 182, weightKg: 68, residence: 'Zürich', pcsId: 'jonas-brandli', wiki: { lang: 'de', title: 'Jonas Brändli' } });
    expect(r.chosen!.intro).toMatch(/^Jonas Brändli \(\* 12\. April 1998 in Zürich\) ist ein Schweizer Radrennfahrer/);
    const base = rider('a', 'Jonas', 'Brändli');
    const a = applyLookup(base, r.chosen!, false, '2026-11-13', { bio: true, physical: true });
    expect(a).toMatchObject({ heightCm: 182, weightKg: 68, residence: 'Zürich' });
    expect(a.bio).toMatch(/^<div>Jonas Brändli/);
    expect(a.externalIds).toEqual([{ ns: 'wikidata', value: 'Q1' }, { ns: 'pcs', value: 'jonas-brandli' }]);
    expect(a.sources).toBe('Wikidata Q1 (abgerufen 2026-11-13); Kurzbio: Wikipedia de „Jonas Brändli“ (CC BY-SA)');
    expect(lookupChanged(base, a)).toBe(true);
    // eigene Kurzbio und vorhandene Werte bleiben
    const own = applyLookup(rider('a', 'Jonas', 'Brändli', { bio: '<div>Mein Text</div>', heightCm: 180 }), r.chosen!, true, '2026-11-13', { bio: true, physical: true });
    expect(own.bio).toBe('<div>Mein Text</div>');
    expect(own.heightCm).toBe(180);
    // ohne Auswahl keine Zusatzfelder
    expect(applyLookup(base, r.chosen!, false, '2026-11-13').bio).toBeUndefined();
  });

  it('Mengen und Einleitung', () => {
    expect(wdQuantity({ amount: '+176', unit: 'http://www.wikidata.org/entity/Q174728' }, 'height')).toBe(176);
    expect(wdQuantity({ amount: '+1.76', unit: 'http://www.wikidata.org/entity/Q11573' }, 'height')).toBe(176);
    expect(wdQuantity({ amount: '+150', unit: 'http://www.wikidata.org/entity/Q100995' }, 'weight')).toBeUndefined(); // Pfund
    expect(wdQuantity({ amount: '+17.6', unit: 'http://www.wikidata.org/entity/Q11573' }, 'height')).toBeUndefined(); // unplausibel
    const long = 'Satz eins ist hier. '.repeat(60);
    const s = shortIntro(long)!;
    expect(s.length).toBeLessThanOrEqual(700);
    expect(s.endsWith('.')).toBe(true);
    expect(shortIntro('kurz')).toBeUndefined();
  });

  it('lädt Einträge gebündelt (höchstens 50 je Anfrage)', async () => {
    calls.length = 0;
    const many = Array.from({ length: 120 }, (_, i) => rider(String(i), 'Jonas', 'Brändli'));
    await lookupRiders(many, { fetcher: fake });
    const getCalls = calls.filter((u) => u.includes('wbgetentities'));
    expect(getCalls.length).toBe(2); // 1× Fahrer (Q1, Q9 dedupliziert) + 1× Länder
  });
});
