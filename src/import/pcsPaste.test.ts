/**
 * Erkennung manuell kopierter PCS-Startlisten. Die Testdaten bilden nur den AUFBAU
 * einer kopierten PCS-Seite nach; Namen und Teams sind frei erfunden.
 */
import { describe, it, expect } from 'vitest';
import { parsePcsStartlist, pcsStartlistToMatrix } from './pcsPaste';
import { tableFromMatrix } from './parse';
import { guessMapping, matchRows } from './matching';

const PASTE = [
  '', 'search', 'Home', 'Races▼', 'ME', '2025', '2026', '2027', 'Results▼', 'Startlist▼',
  '2026   »   12th Fiktivia Classic ME (1.Pro)',
  'One day race   »   Nordstadt  ›  Südstadt   (201.5km)',
  'Startlist', 'more pdf options Startlist', 'Default', '7 riders', '',
  'Alpenfirn Racing (WT)', '1BRÄNDLI Jonas', '2ZÜRCHER Reto', "3O'NEILL Seán",
  'DS MUSTER Max, BEISPIEL Bea', 'team statistics in race',
  'Équipe Lumière (PRT)', '11VAN DEN BROECK Joris', '12RENARD-DUPONT Jean-Luc', '13ØVREBØ Lars',
  'DS AUTRE Paul', 'team statistics in race',
  'Squadra Fiume (CT)', '21DE LA ROSA Pablo',
  'DS UNO Ugo', 'team statistics in race',
  'Startlist', 'Startlist', 'Changes', 'Tour de France', 'Popular riders', 'Rankings', 'Pageload 0.0231s',
].join('\r\n');

describe('PCS-Startliste (kopiert)', () => {
  it('erkennt Rennen, Teams, Startnummern und Namen; ignoriert Menü und Betreuer', () => {
    const s = parsePcsStartlist(PASTE)!;
    expect(s.meta).toMatchObject({ year: 2026, raceName: 'Fiktivia Classic', raceClass: '1.Pro', distanceKm: 201.5, expectedRiders: 7 });
    expect(s.teams).toEqual(['Alpenfirn Racing', 'Équipe Lumière', 'Squadra Fiume']);
    expect(s.entries.map((e) => e.bib)).toEqual(['1', '2', '3', '11', '12', '13', '21']);
    expect(s.entries[2]).toMatchObject({ name: "O'NEILL Seán", team: 'Alpenfirn Racing', teamStatus: 'WT' });
    expect(s.warnings).toEqual([]);
  });

  it('warnt, wenn die erkannte Zahl nicht der PCS-Angabe entspricht', () => {
    const s = parsePcsStartlist(PASTE.replace('7 riders', '8 riders'))!;
    expect(s.warnings[0]).toMatch(/PCS nennt 8 Fahrer, erkannt wurden 7/);
  });

  it('läuft durch den normalen Abgleich: Namen sauber getrennt, Team übernommen', () => {
    const t = tableFromMatrix(pcsStartlistToMatrix(parsePcsStartlist(PASTE)!));
    const m = matchRows(t.rows, guessMapping(t.headers), { riders: [], editionParticipations: [], bibScope: 'rennen' });
    const n = (bib: string) => m.rows.find((r) => r.norm.bib === bib)!.norm;
    expect(n('3')).toMatchObject({ firstName: 'Seán', lastName: "O'Neill", team: 'Alpenfirn Racing' });
    expect(n('11')).toMatchObject({ firstName: 'Joris', lastName: 'Van den Broeck' });
    expect(n('12').lastName).toBe('Renard-Dupont');
    expect(n('21').lastName).toBe('De la Rosa');
  });

  it('normale Tabellen werden nicht fälschlich als PCS erkannt', () => {
    expect(parsePcsStartlist('Nr;Name;Team\n1;Muster;A\n2;Beispiel;B')).toBeNull();
    // Tabulator-getrennte Tabelle aus Excel (früher fälschlich als PCS erkannt)
    expect(parsePcsStartlist('Nr\tVorname\tNachname\tTeam\tNation\n007\tLars\tØvrebø\tNordlys Cycling\tNOR\n12\tLuca\tBianchi\tSquadra Fiume\tITA\n13\tNeu\tFahrerin\tTeam X\tSUI\n')).toBeNull();
    // Nummer mit Leerzeichen vor dem Namen = normale Liste, kein PCS
    expect(parsePcsStartlist('Team A (WT)\n1 MUSTER Max\n2 BEISPIEL Bea\n3 PROBE Paul')).toBeNull();
  });
});
