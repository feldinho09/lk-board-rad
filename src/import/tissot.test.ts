/**
 * Tissot Timing: echte, gekürzte Antworten von prod.server.tissottiming.com (Tour de France 2026,
 * Etappe 5; abgerufen 13.11.2026). Der Abruf wird durch einen Fixture-Fetcher ersetzt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { useDatabase, db, alive, resetDeviceIdCache } from '../db/db';
import { tableFromMatrix } from './parse';
import { guessMapping, defaultDecision } from './matching';
import { prepareMatch, commitImport } from './commit';
import { resolveStanding } from '../domain/standings';
import {
  convertRanking, fetchStageRankings, kindOf, latestStartedStage, listRoadRaces, parseTissotTime, splitTissotName,
  stageFromTissot, statusesFromTeams, teamsToMatrix, tissotDate, type JsonFetcher, type TtRanking, type TtStage, type TtTeam,
} from './tissot';
import { refreshAllRiders } from './refreshAll';
import { applyAthlete, createEditionFromTissot, enrichRidersByUci, enrichRidersFromTissot, syncTissotStage } from './tissotCommit';
import type { Rider } from '../domain/types';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tissot/${name}`, import.meta.url), 'utf8'));
const COMPS = fx('competitions-2026.json');
const STAGES: TtStage[] = fx('tdf2026-stages.json');
const TEAMS: TtTeam[] = fx('tdf2026-s5-teams.json');
const OVERALL: TtRanking[] = fx('tdf2026-s5-overall.json');
const STAGE: TtRanking[] = fx('tdf2026-s5-stage.json');
const POG = fx('athlete-pogacar.json');

function fetcher(over: Record<string, unknown> = {}): JsonFetcher & { calls: string[] } {
  const routes: Record<string, unknown> = {
    '/competitions?year=2026': COMPS,
    '/competitions/tdf2026/stages': STAGES,
    '/competitions/tdf2026/stages/1/teams': TEAMS,
    '/competitions/tdf2026/stages/5/teams': TEAMS,
    '/competitions/tdf2026/stages/5/rankings/stage': STAGE,
    '/competitions/tdf2026/stages/5/rankings/overall': OVERALL,
    '/athletes/infos/10014972740/tdf2026/0': POG,
    '/athletes/palmares/10014972740': fx('palmares-pogacar.json'),
    ...over,
  };
  const calls: string[] = [];
  const f = (async (p: string) => { calls.push(p); return p in routes ? structuredClone(routes[p]) : null; }) as JsonFetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

let n = 0;
beforeEach(async () => {
  resetDeviceIdCache();
  useDatabase(`tissot-${++n}-${Date.now()}`);
  await db.open();
});

describe('Tissot – Umwandlung', () => {
  it('liefert nur Strassenrennen, nach Datum', async () => {
    const r = await listRoadRaces(2026, fetcher());
    expect(r.map((x) => x.code)).toEqual(['prx', 'tds', 'tdf']);
  });

  it('Zeiten: absolute Zeit, Minuten, Sekunden, gleiche Zeit', () => {
    expect(parseTissotTime('16:32:07')).toBe(59527);
    expect(parseTissotTime('3:50')).toBe(230);
    expect(parseTissotTime('28')).toBe(28);
    expect(parseTissotTime('00')).toBe(0);
    expect(parseTissotTime('')).toBeNull();
    expect(parseTissotTime('DNF')).toBeNull();
    // weitere Schreibweisen, die bei Tissot vorkommen
    expect(parseTissotTime('4:59:39"')).toBe(17979);
    expect(parseTissotTime("21:47''")).toBe(1307);
    expect(parseTissotTime("08''")).toBe(8);
    expect(parseTissotTime('15h08\'43"')).toBe(54523);
    expect(parseTissotTime('06\'32"')).toBe(392);
    expect(parseTissotTime('07"')).toBe(7);
    expect(parseTissotTime('00"')).toBe(0);
    expect(parseTissotTime("' '")).toBeNull();
    expect(parseTissotTime('-53"')).toBe(-53);
  });

  it('Etappen: Start/Ziel, Typ, Distanz', () => {
    const s1 = stageFromTissot(STAGES[0], false);
    expect(s1).toMatchObject({ order: 1, label: 'Etappe 1', type: 'mzf', start: 'Barcelone', finish: 'Barcelone', distanceKm: 19.6, date: '2026-07-04' });
    expect(stageFromTissot(STAGES[1], false).type).toBe('strasse');
    expect(stageFromTissot({ ...STAGES[1], number: 1 }, true)).toMatchObject({ label: 'Rennen', type: 'eintages' });
  });

  it('Namen im Tissot-Stil', () => {
    expect(splitTissotName('POGACAR Tadej')).toEqual({ first: 'Tadej', last: 'Pogacar' });
    expect(splitTissotName('GEE Derek James')).toEqual({ first: 'Derek James', last: 'Gee' });
    expect(splitTissotName('GROSSSCHARTNER Felix')).toEqual({ first: 'Felix', last: 'Grossschartner' });
  });

  it('Startliste als Prüf-Tabelle mit UCI-ID', () => {
    const m = teamsToMatrix(TEAMS);
    expect(m[0]).toEqual(['Nr', 'Vorname', 'Nachname', 'Team', 'Nation', 'UCI-ID', 'Tissot-Status']);
    expect(m[1]).toEqual(['1', 'Tadej', 'Pogacar', 'UAE TEAM EMIRATES XRG', 'SLO', '10014972740', 'OK']);
    const map = guessMapping(m[0]);
    expect(map).toMatchObject({ bib: 'Nr', firstName: 'Vorname', lastName: 'Nachname', team: 'Team', nationality: 'Nation', uciId: 'UCI-ID' });
  });

  it('ordnet die Wertungen richtig zu', () => {
    expect(OVERALL.map(kindOf)).toEqual(['gc', 'punkte', 'berg', 'nachwuchs', 'team']);
    expect(STAGE.map(kindOf)).toEqual(['etappe', null, null, null, null]);
  });

  it('Gesamtwertung: Leader mit absoluter Zeit, Rest mit Rückstand', () => {
    const gc = convertRanking(OVERALL[0])!;
    expect(gc.unit).toBe('zeit');
    expect(gc.rows[0]).toMatchObject({ rank: 1, timeSec: 59527, gapSec: 0, uciId: expect.any(String) });
    expect(gc.rows[1]).toMatchObject({ rank: 2, gapSec: 28 });
    const pog = gc.rows.find((r) => r.name === 'POGACAR Tadej')!;
    expect(pog).toMatchObject({ rank: 4, gapSec: 473, uciId: '10014972740', bib: '1' });
    const pts = convertRanking(OVERALL[1])!;
    expect(pts.unit).toBe('punkte');
    expect(pts.rows[0]).toMatchObject({ rank: 1, name: 'PEDERSEN Mads', points: 143 });
    const team = convertRanking(OVERALL[4])!;
    expect(team.rows[0]).toMatchObject({ rank: 1, team: 'LIDL-TREK', timeSec: 178322 });
  });

  it('Schreibweise mit h und Apostrophen, gleiche Zeit „\' \'“, Ausfälle, Strafpunkte', () => {
    const r = convertRanking({ order: 1, type: 'Stage', rankingType: 'Time', results: [
      { resultType: 'Time', key: 'a', rider: { key: 'a', bib: 1, name: 'EINS Erster' }, rank: 1, value: '3h56\'55"' },
      { resultType: 'Time', key: 'b', rider: { key: 'b', bib: 2, name: 'ZWEI Zweiter' }, rank: 2, value: '04"' },
      { resultType: 'Time', key: 'c', rider: { key: 'c', bib: 3, name: 'DREI Dritter' }, rank: 3, value: "' '" },
      { resultType: 'Time', key: 'd', rider: { key: 'd', bib: 4, name: 'VIER Vierter' }, rank: 4, value: '01\'53"' },
      { resultType: 'Time', key: 'e', rider: { key: 'e', bib: 5, name: 'FUENF Fuenfter' }, rank: 0, value: 'DNF' },
    ] })!;
    expect(r.rows.map((x) => [x.rank, x.timeSec ?? null, x.gapSec ?? null, !!x.sameTimeAsPrevious, x.status ?? null])).toEqual([
      [1, 14215, 0, false, null], [2, null, 4, false, null], [3, null, 4, true, null], [4, null, 113, false, null], [null, null, null, false, 'DNF'],
    ]);
    const p = convertRanking({ order: 2, type: 'Overall', rankingType: 'SprintPoints', results: [
      { resultType: 'Points', key: 'x', rider: { key: 'x', bib: 9, name: 'NEUN Neunter' }, rank: 120, value: '-15' },
    ] })!;
    expect(p.rows[0].points).toBe(-15);
  });

  it('Etappe: gleiche Zeit wird erkannt; leere Wertungen werden übersprungen', async () => {
    const all = await fetchStageRankings('tdf2026', 5, fetcher());
    expect(all.map((r) => r.kind)).toEqual(['etappe', 'gc', 'punkte', 'berg', 'nachwuchs', 'team']);
    const st = all[0];
    expect(st.rows[1]).toMatchObject({ rank: 2, gapSec: 0, sameTimeAsPrevious: true });
  });

  it('Status, Datum, laufende Etappe', () => {
    const t = structuredClone(TEAMS);
    t[0].members[1].status = 'DNF';
    expect(statusesFromTeams(t)).toEqual([{ uciId: t[0].members[1].uciRiderId, bib: '2', status: 'DNF' }]);
    expect(tissotDate('1998-09-21T00:00:00')).toBe('1998-09-21');
    expect(tissotDate('0001-01-01T00:00:00')).toBeUndefined();
    expect(latestStartedStage(STAGES, new Date('2026-07-06T20:00:00'))?.number).toBe(3);
    expect(latestStartedStage(STAGES, new Date('2026-06-01'))).toBeUndefined();
  });
});

describe('Tissot – Übernahme ins LK Board', () => {
  async function setup() {
    const f = fetcher();
    const comp = (await listRoadRaces(2026, f)).find((c) => c.code === 'tdf')!;
    const editionId = await createEditionFromTissot(comp, 2026, STAGES);
    const m = teamsToMatrix(TEAMS);
    const t = tableFromMatrix(m);
    const match = await prepareMatch(editionId, t.rows, guessMapping(t.headers));
    await commitImport(editionId, 'Tissot Timing: Tour de France 2026', match, match.rows.map(defaultDecision));
    return { f, editionId };
  }

  it('legt Rennen mit Etappen und Verknüpfung an; Startliste mit UCI-IDs', async () => {
    const { editionId } = await setup();
    const ed = await db.editions.get(editionId);
    expect(ed).toMatchObject({ name: 'Tour de France 2026', format: 'etappen', dataOrigin: 'tissot', tissot: { id: 'tdf2026', code: 'tdf', year: 2026 } });
    expect(alive(await db.stages.where('editionId').equals(editionId).toArray())).toHaveLength(6);
    const riders = alive(await db.riders.toArray());
    expect(riders).toHaveLength(8);
    expect(riders.find((r) => r.lastName === 'Pogacar')?.externalIds).toEqual([{ ns: 'uci', value: '10014972740' }]);
  });

  it('speichert alle Wertungen; zweiter Abruf ohne Änderung erzeugt keine Revision', async () => {
    const { f, editionId } = await setup();
    const r1 = await syncTissotStage(editionId, 'tdf2026', 5, f);
    expect(r1.items.map((i) => [i.kind, i.result.outcome])).toEqual([
      ['etappe', 'gespeichert'], ['gc', 'gespeichert'], ['punkte', 'gespeichert'], ['berg', 'gespeichert'], ['nachwuchs', 'gespeichert'], ['team', 'gespeichert'],
    ]);
    const r2 = await syncTissotStage(editionId, 'tdf2026', 5, f);
    expect(r2.items.every((i) => i.result.outcome === 'unveraendert')).toBe(true);
    expect(await db.standings.count()).toBe(6);

    // Zuordnung über UCI-ID; Gesamtstand nach Etappe 5 ist abrufbar
    const stages = alive(await db.stages.where('editionId').equals(editionId).toArray());
    const s5 = stages.find((s) => s.order === 5)!;
    const gc = resolveStanding('gc', s5.id, stages, alive(await db.standings.toArray()), (s) => String(s));
    const pog = alive(await db.riders.toArray()).find((r) => r.lastName === 'Pogacar')!;
    expect(gc.standing?.rows.find((r) => r.riderId === pog.id)).toMatchObject({ rank: 4, gapSec: 473 });
    expect(gc.standing?.source).toBe('Tissot Timing');
    // Fahrer ausserhalb der Startliste bleiben mit Quellnamen erhalten
    expect(r1.items.find((i) => i.kind === 'gc')!.unresolved).toBe(2);
  });

  it('übernimmt Ausfälle, setzt aber niemanden zurück auf aktiv', async () => {
    const { editionId } = await setup();
    const t = structuredClone(TEAMS);
    t[0].members[1].status = 'DNF';
    const r = await syncTissotStage(editionId, 'tdf2026', 5, fetcher({ '/competitions/tdf2026/stages/5/teams': t }));
    expect(r.statusUpdates).toBe(1);
    const parts = alive(await db.participations.toArray());
    expect(parts.find((p) => p.bib === '2')?.status).toBe('DNF');
    const again = await syncTissotStage(editionId, 'tdf2026', 5, fetcher());
    expect(again.statusUpdates).toBe(0);
    expect(alive(await db.participations.toArray()).find((p) => p.bib === '2')?.status).toBe('DNF');
  });

  it('Fahrerdaten: Geburtsdatum/-ort, Akzente – nur leere Felder', async () => {
    const { f, editionId } = await setup();
    const res = await enrichRidersFromTissot(editionId, 'tdf2026', { birthDates: true, places: true, accents: true, nationality: true }, undefined, f);
    expect(res).toMatchObject({ checked: 8, updated: 1, withoutUci: 0, uciAdded: 0 });
    const pog = alive(await db.riders.toArray()).find((r) => r.externalIds.some((e) => e.value === '10014972740'))!;
    expect(pog).toMatchObject({ firstName: 'Tadej', lastName: 'Pogačar', displayName: 'Tadej Pogačar', birthDate: '1998-09-21', birthPlace: 'Komenda' });
    expect(pog.aliases).toContain('Tadej Pogacar');
    expect(pog.searchTokens.join(' ')).toContain('pogacar');
    expect(pog.sources).toMatch(/; Tissot Timing \(abgerufen \d{4}-\d{2}-\d{2}\)$/);
    expect(await db.restorePoints.count()).toBeGreaterThan(0);
  });

  it('applyAthlete überschreibt nichts und ändert keine abweichenden Namen', () => {
    const base = { firstName: 'Tadej', lastName: 'Pogacar', displayName: 'Tadej Pogacar', aliases: [], birthDate: '1998-01-01', birthPlace: 'Ljubljana', nationality: 'SLO', externalIds: [], keyFacts: [], tags: [], searchTokens: [] } as unknown as Rider;
    const o = { birthDates: true, places: true, accents: true, nationality: true };
    const r = applyAthlete(base, POG, o);
    expect(r).toMatchObject({ birthDate: '1998-01-01', birthPlace: 'Ljubljana', lastName: 'Pogačar' });
    const other = applyAthlete({ ...base, lastName: 'Pogi' }, POG, o);
    expect(other.lastName).toBe('Pogi');
    const year = applyAthlete({ ...base, birthDate: '1998' }, POG, o);
    expect(year.birthDate).toBe('1998-09-21');
    const none = applyAthlete({ ...base, lastName: 'Pogačar', displayName: 'Tadej Pogačar' }, POG, o);
    expect(none).toBe(none); // unverändert → gleiches Objekt
  });

  it('ordnet fehlende UCI-IDs nur über eindeutige Namen zu', async () => {
    const f = fetcher();
    const comp = (await listRoadRaces(2026, f)).find((c) => c.code === 'tdf')!;
    const editionId = await createEditionFromTissot(comp, 2026, STAGES);
    const csv = [['Nr', 'Name', 'Team'], ['1', 'Tadej Pogačar', 'UAE'], ['99', 'Max Muster', 'X']];
    const t = tableFromMatrix(csv);
    const m = await prepareMatch(editionId, t.rows, guessMapping(t.headers));
    await commitImport(editionId, 'csv', m, m.rows.map(defaultDecision));
    const res = await enrichRidersFromTissot(editionId, 'tdf2026', { birthDates: true, places: false, accents: false, nationality: false }, undefined, f);
    expect(res).toMatchObject({ uciAdded: 1, withoutUci: 1, updated: 1 });
    const pog = alive(await db.riders.toArray()).find((r) => r.lastName === 'Pogačar')!;
    expect(pog.birthDate).toBe('1998-09-21');
  });

  it('Palmarès für alle Fahrer mit UCI-ID: ersetzt Liste, Schlüsselfakten nur wenn leer', async () => {
    const { f } = await setup();
    const all = alive(await db.riders.toArray());
    const pog = all.find((r) => r.lastName === 'Pogacar')!;
    const res = await enrichRidersByUci(all, null, { birthDates: false, places: false, accents: false, nationality: false, palmares: true, keyFacts: true }, undefined, f);
    expect(res).toMatchObject({ checked: 8, updated: 1 });
    const after = (await db.riders.get(pog.id))!;
    expect(after.palmares!.length).toBeGreaterThan(300);
    expect(after.palmaresSource).toMatch(/^Tissot Timing/);
    expect(after.keyFacts[0]).toMatch(/^Gesamtsieg Tour de France/);
    expect(after.birthDate).toBeUndefined(); // ohne Rennkontext keine Fahrer-Infos
    // eigene Schlüsselfakten bleiben; unveränderter Abruf ändert nichts
    await db.riders.put({ ...after, keyFacts: ['Eigener Fakt'] });
    const again = await enrichRidersByUci(alive(await db.riders.toArray()), null, { birthDates: false, places: false, accents: false, nationality: false, palmares: true, keyFacts: true }, undefined, f);
    expect(again.updated).toBe(0);
    expect((await db.riders.get(pog.id))!.keyFacts).toEqual(['Eigener Fakt']);
  });

  it('„Alle aktualisieren“: Tissot-Daten für alle; Wikipedia ohne Treffer ändert nichts', async () => {
    const { f } = await setup();
    const wiki = async () => ({ search: [] });
    const phases = new Set<string>();
    const r = await refreshAllRiders({ tissot: true, wikipedia: true }, (p) => phases.add(p.split(':')[0]), { tissot: f, wiki });
    expect(r.riders).toBe(8);
    expect(r.tissot).toMatchObject({ profiles: 1, palmares: 1, withoutUci: 0 });
    expect(r.wikipedia).toMatchObject({ updated: 0, notFound: 8, checked: 8, skippedRecent: 0, remaining: 0 });
    // innerhalb von 30 Tagen nicht nochmals nachschlagen
    const w2 = await refreshAllRiders({ tissot: false, wikipedia: true }, undefined, { wiki });
    expect(w2.wikipedia).toMatchObject({ checked: 0, skippedRecent: 8 });
    expect(r.errors).toEqual([]);
    expect([...phases]).toEqual(expect.arrayContaining(['Tissot', 'Wikipedia']));
    const pog = alive(await db.riders.toArray()).find((x) => x.externalIds.some((e) => e.value === '10014972740'))!;
    expect(pog).toMatchObject({ lastName: 'Pogačar', birthDate: '1998-09-21' });
    expect(pog.palmares!.length).toBeGreaterThan(300);
    expect(await db.restorePoints.count()).toBeGreaterThan(0);
    // zweiter Lauf: nichts mehr zu tun
    const again = await refreshAllRiders({ tissot: true, wikipedia: false }, undefined, { tissot: f });
    expect(again.tissot).toMatchObject({ profiles: 0, palmares: 0 });
  });
});
