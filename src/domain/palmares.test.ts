/** Palmarès-Auswertung mit echten Tissot-Daten (Pogačar, Kooij; abgerufen 13.11.2026). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { keyFactsFromPalmares, palmaresSummary, yearsText } from './palmares';
import { getPalmares, type JsonFetcher } from '../import/tissot';

const raw = (n: string) => JSON.parse(readFileSync(new URL(`../import/fixtures/tissot/${n}`, import.meta.url), 'utf8'));
const f: JsonFetcher = async (p) => (p === '/athletes/palmares/10014972740' ? raw('palmares-pogacar.json') : p === '/athletes/palmares/10022711017' ? raw('palmares-kooij.json') : null);

describe('Palmarès', () => {
  it('Jahreszahlen kompakt', () => {
    expect(yearsText([2025, 2021, 2022, 2023])).toBe('2021–2023, 2025');
    expect(yearsText([2020, 2021])).toBe('2020, 2021');
    expect(yearsText([2024])).toBe('2024');
  });

  it('liest das Tissot-Palmarès (neueste zuerst)', async () => {
    const p = (await getPalmares('10014972740', f))!;
    expect(p.length).toBeGreaterThan(300);
    expect(p[0]).toMatchObject({ year: 2026, rank: 1 });
    expect(p.find((e) => e.race === 'Tour de France' && e.detail === 'General classification' && e.year === 2020)).toBeTruthy();
    expect(await getPalmares('0', f)).toBeNull();
  });

  it('Schlüsselfakten: Grand-Tour-Gesamtsiege vor WM vor Monumenten', async () => {
    const facts = keyFactsFromPalmares((await getPalmares('10014972740', f))!);
    expect(facts).toHaveLength(3);
    expect(facts[0]).toMatch(/^Gesamtsieg Tour de France 2020, 2021, 2024–2026$|^Gesamtsieg Tour de France 2020/);
    expect(facts.join(' | ')).toMatch(/Gesamtsieg Giro d’Italia 2024|Weltmeister Strasse/);
    // „Vuelta a Andalucía“ ist nicht die Vuelta; Pogačar hat die Vuelta nie gewonnen
    expect(keyFactsFromPalmares((await getPalmares('10014972740', f))!, 10).join(' | ')).not.toMatch(/Gesamtsieg Vuelta/);
  });

  it('Sprinter: Etappensiege', async () => {
    const p = (await getPalmares('10022711017', f))!;
    const facts = keyFactsFromPalmares(p);
    expect(facts.join(' | ')).toMatch(/Etappensieg(e)? Tour de France/);
    const s = palmaresSummary(p);
    expect(s.wins).toBeGreaterThan(5);
    expect(s.podiums).toBeGreaterThanOrEqual(s.wins);
  });
});
