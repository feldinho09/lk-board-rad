/**
 * PCS-Fahrerseite (Strg A / Strg C): erfundene Fahrer im Aufbau der echten Seite.
 * Gegen zwei echte Kopien wurde lokal geprüft (nicht im Repository, PCS-Nutzungsbedingungen).
 */
import { describe, it, expect } from 'vitest';
import { pcsPagePatch, pageMatchesRider, parsePcsRiderPages, riderTypeFrom, teamSpans, topResultDe } from './pcsRider';
import type { Rider } from '../domain/types';

const PAGE_A = `
search
Home
Races▼
Jonas Brändli»
Team Alpenblick
Info

Name:Jonas Brändli
Date of birth:12thApril 1998 (28)
Nationality:Switzerland
Weight:68kgHeight:1.82m
Place of birth:Zürich
Specialties
1200Oneday
900GC
2100TT
150Sprint
800Climber
1300Hills
INSTASTRAVA
PCS Ranking41UCI World55
Visits:▼120this week
follow
Top results
3x GC Tour de Romandie  ('22, '23, '24)
2x World Championships ME - ITT  ('24, '25)
2x stage Tour de France  ('23, '25)
  Strade Bianche  ('21)
2nd GC Tour de Suisse  ('20)
5th Il Lombardia  ('19)
Major jerseys worn
3
1
more
Teams
2028Team Alpenblick (WT)
2027Team Alpenblick (WT)
2026Team Alpenblick (WT)
2025Team Alpenblick (WT)
2024Team Bergwerk (WT)
2023Team Bergwerk (WT)
2019Team Jura (CT)
Program
No races on program.
Key statistics
11WinsGC (3) Oneday races (1) ITT (4)
Family
Mia Brändli (Sister)
Grand Tours
`;

const PAGE_B = `
Name:Luca Bianchi
Date of birth:2ndMay 2004 (22)
Nationality:Italy
Weight:70kg
Place of birth:Bergamo
Specialties
10Oneday
5GC
Top results
3rd stage Giro d'Italia  ('25)
Teams
2026Squadra Lago (PRT)
Program
Key statistics
0Wins
`;

const rider = (first: string, last: string, extra: Partial<Rider> = {}): Rider => ({
  id: first, firstName: first, lastName: last, name: `${first} ${last}`, sections: {}, searchKey: '', rev: 1, createdAt: '', updatedAt: '', ...extra,
} as Rider);

describe('PCS-Fahrerseite', () => {
  it('liest Stammdaten, Spezialitäten, Teams, Siege, Familie', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    expect(p).toMatchObject({
      name: 'Jonas Brändli', birthDate: '1998-04-12', nationality: 'SUI', birthPlace: 'Zürich', heightCm: 182, weightKg: 68, wins: 11, family: ['Mia Brändli (Schwester)'],
    });
    expect(p.teams[0]).toEqual({ year: 2028, team: 'Team Alpenblick', level: 'WT' });
    expect(p.teams).toHaveLength(7);
    expect(riderTypeFrom(p)).toBe('Zeitfahrer');
  });

  it('übersetzt Top-Ergebnisse', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    expect(p.topResults).toEqual([
      '3× Gesamtsieg Tour de Romandie (2022–2024)',
      '2× Weltmeister Zeitfahren (2024, 2025)',
      '2 Etappensiege Tour de France (2023, 2025)',
      'Sieg Strade Bianche (2021)',
      '2. Gesamt Tour de Suisse (2020)',
      '5. Il Lombardia (2019)',
    ]);
    expect(topResultDe(" stage Tour Alsace  ('22)")).toBe('1 Etappensieg Tour Alsace (2022)');
    expect(topResultDe("3x Ronde van Vlaanderen ME  ('23, '25, '26)")).toBe('3× Sieg Ronde van Vlaanderen (2023, 2025, 2026)');
    expect(topResultDe('Kein Ergebnis')).toBeNull();
  });

  it('mehrere Seiten auf einmal; fehlende Angaben bleiben leer', () => {
    const pages = parsePcsRiderPages(PAGE_A + '\n' + PAGE_B);
    expect(pages.map((p) => p.name)).toEqual(['Jonas Brändli', 'Luca Bianchi']);
    expect(pages[1]).toMatchObject({ nationality: 'ITA', weightKg: 70, wins: 0 });
    expect(pages[1].heightCm).toBeUndefined();
    expect(parsePcsRiderPages('irgendein Text')).toEqual([]);
  });

  it('Zuordnung über Namen (akzentfrei) und Jahrgang', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    expect(pageMatchesRider(p, rider('Jonas', 'Brandli'))).toBe(true);
    expect(pageMatchesRider(p, rider('Jonas', 'Brandli', { birthDate: '1998' }))).toBe(true);
    expect(pageMatchesRider(p, rider('Jonas', 'Brandli', { birthDate: '2001-01-01' }))).toBe(false);
    expect(pageMatchesRider(p, rider('Jonas', 'Muster'))).toBe(false);
  });

  it('Übernahme: nur leere Felder und leere Abschnitte, Akzente', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    const { patch, changes } = pcsPagePatch(rider('Jonas', 'Brandli', { nation: 'LIE', heightCm: 180 }), p, 2026);
    expect(patch).toMatchObject({ name: 'Jonas Brändli', firstName: 'Jonas', lastName: 'Brändli', weightKg: 68, birthDate: '1998-04-12', riderType: 'Zeitfahrer', birthPlace: 'Zürich', team: 'Team Alpenblick' });
    expect(patch.nation).toBeUndefined();
    expect(patch.heightCm).toBeUndefined();
    expect(patch.sections?.erfolge).toBe('<div><ul><li>11 Profisiege (laut PCS)</li><li>3× Gesamtsieg Tour de Romandie (2022–2024)</li><li>2× Weltmeister Zeitfahren (2024, 2025)</li><li>2 Etappensiege Tour de France (2023, 2025)</li><li>Sieg Strade Bianche (2021)</li><li>2. Gesamt Tour de Suisse (2020)</li><li>5. Il Lombardia (2019)</li></ul></div>');
    expect(patch.sections?.person).toBe('<div><b>Teams</b></div><div><ul><li>2025–2026 Team Alpenblick (Vertrag bis 2028)</li><li>2023–2024 Team Bergwerk</li><li>2019 Team Jura</li></ul></div>');
    expect(patch.sections?.persoenlich).toContain('Mia Brändli (Schwester)');
    expect(changes).toEqual(expect.arrayContaining(['Schreibweise Jonas Brändli', 'Persönliches (Familie)']));
    // eigene Texte bleiben
    const own = pcsPagePatch(rider('Jonas', 'Brändli', { riderType: 'Allrounder', sections: { erfolge: '<div>Eigene Liste</div>' } }), p, 2026);
    expect(own.patch.riderType).toBeUndefined();
    expect(own.patch.sections?.erfolge).toBe('<div>Eigene Liste</div>');
    expect(own.patch.name).toBeUndefined();
  });

  it('Teamstationen zusammengefasst', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    expect(teamSpans(p.teams)).toEqual([
      { from: 2025, to: 2028, team: 'Team Alpenblick' }, { from: 2023, to: 2024, team: 'Team Bergwerk' }, { from: 2019, to: 2019, team: 'Team Jura' },
    ]);
  });
});
