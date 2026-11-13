/**
 * PCS-Fahrerseite (Strg A / Strg C): erfundene Fahrer im Aufbau der echten Seite.
 * Gegen zwei echte Kopien wurde lokal geprüft (nicht im Repository, PCS-Nutzungsbedingungen).
 */
import { describe, it, expect } from 'vitest';
import { applyPcsPage, pageMatchesRider, parsePcsRiderPages, riderTypeFrom, teamSpans, topResultDe } from './pcsRider';
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
  id: first, firstName: first, lastName: last, displayName: `${first} ${last}`, aliases: [], externalIds: [], keyFacts: [], tags: [], searchTokens: [],
  rev: 1, createdAt: '', updatedAt: '', ...extra,
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

  it('Übernahme: nur leere Felder, Akzente, Schlüsselfakten nur wenn leer, Quelle', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    const a = applyPcsPage(rider('Jonas', 'Brandli', { nationality: 'LIE', heightCm: 180, sources: 'Startliste' }), p, '2026-11-13');
    expect(a).toMatchObject({ firstName: 'Jonas', lastName: 'Brändli', displayName: 'Jonas Brändli', nationality: 'LIE', heightCm: 180, weightKg: 68, birthDate: '1998-04-12', riderType: 'Zeitfahrer', careerWins: 11 });
    expect(a.aliases).toContain('Jonas Brandli');
    expect(a.keyFacts).toEqual(p.topResults.slice(0, 3));
    expect(a.sources).toBe('Startliste; ProCyclingStats, kopiert (2026-11-13)');
    const own = applyPcsPage(rider('Jonas', 'Brändli', { keyFacts: ['Eigener Fakt'], riderType: 'Allrounder' }), p);
    expect(own.keyFacts).toEqual(['Eigener Fakt']);
    expect(own.riderType).toBe('Allrounder');
  });

  it('Teamstationen zusammengefasst', () => {
    const [p] = parsePcsRiderPages(PAGE_A);
    expect(teamSpans(p.teams)).toEqual([
      { from: 2025, to: 2028, team: 'Team Alpenblick' }, { from: 2023, to: 2024, team: 'Team Bergwerk' }, { from: 2019, to: 2019, team: 'Team Jura' },
    ]);
  });
});
