// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, db } from '../db/db';
import { createRace } from './center';
import { normTime, parseDuration, parseRundownTable, pasteRows, fillTimes, rundownRows, currentRow, copyRundown, moveRow, fmtDur } from './rundown';
import { parseGpx, projectOnRoute, classify, cleanExtract, placeName, kmToGo, findAlongRoute, mergeFound, climbStats, type Fetcher } from './geo';
import { saveRoute, addFound, stagePoints, removePoint, addPoint } from './geoStore';
import { buildArchive, verifyArchive } from '../backup/archive';

let n = 0;
beforeEach(async () => { useDatabase(`pg-${++n}-${Date.now()}`); await db.open(); });

describe('SRF-Programm', () => {
  it('Zeiten und Dauern lesen', () => {
    expect(normTime('14.05')).toBe('14:05');
    expect(normTime('9:30')).toBe('09:30');
    expect(normTime('1405')).toBe('14:05');
    expect(normTime('25:00')).toBeUndefined();
    expect(parseDuration("5'")).toBe(5);
    expect(parseDuration('5 min')).toBe(5);
    expect(parseDuration('04:30')).toBe(4.5);
    expect(parseDuration('1:30:00')).toBe(90);
    expect(fmtDur(4.5)).toBe('4:30');
    expect(fmtDur(12)).toBe("12'");
  });

  it('Tabelle mit Kopfzeile (Spalten in beliebiger Reihenfolge)', () => {
    const rows = parseRundownTable('Element\tZeit\tDauer\tWer\nOpener\t14.00\t2\tMarco\nLive\t14:02\t45\t');
    expect(rows).toEqual([
      { time: '14:00', durationMin: 2, item: 'Opener', content: undefined, who: 'Marco' },
      { time: '14:02', durationMin: 45, item: 'Live', content: undefined, who: undefined },
    ]);
  });

  it('Tabelle ohne Kopfzeile: Zeit | Dauer | Element | Inhalt | Wer', () => {
    const rows = parseRundownTable("14:00\t3'\tBegrüssung\tTeaser Etappe\tMarco\n14:03\t\tLive-Rennen\t\t");
    expect(rows[0]).toEqual({ time: '14:00', durationMin: 3, item: 'Begrüssung', content: 'Teaser Etappe', who: 'Marco' });
    expect(rows[1]).toMatchObject({ time: '14:03', item: 'Live-Rennen' });
  });

  it('einfügen, Zeiten fortschreiben, laufende Zeile, kopieren, verschieben', async () => {
    const race = await createRace({ name: 'Tour de Suisse', year: 2026, kind: 'rundfahrt', startDate: '2026-06-14', stageCount: 2 });
    expect(await pasteRows(race.id, 1, "14:00\t5\tOpener\n\t10\tVorschau\n\t60\tLive", false)).toBe(3);
    expect(await fillTimes(race.id, 1, false)).toBe(2);
    let rows = await rundownRows(race.id, 1);
    expect(rows.map((r) => r.time)).toEqual(['14:00', '14:05', '14:15']);
    const at = currentRow(rows, 14 * 60 + 7);
    expect(at.current?.item).toBe('Vorschau');
    expect(at.next?.item).toBe('Live');
    expect(at.endsInMin).toBe(8);
    expect(at.nextInMin).toBe(8);
    expect(currentRow(rows, 13 * 60).current).toBeUndefined();
    await moveRow(race.id, 1, rows[2].id, -1);
    rows = await rundownRows(race.id, 1);
    expect(rows.map((r) => r.item)).toEqual(['Opener', 'Live', 'Vorschau']);
    expect(await copyRundown(race.id, 1, 2)).toBe(3);
    expect((await rundownRows(race.id, 2)).map((r) => r.item)).toEqual(['Opener', 'Live', 'Vorschau']);
    expect(await pasteRows(race.id, 1, 'Neu', true)).toBe(1);
    expect((await rundownRows(race.id, 1)).map((r) => r.item)).toEqual(['Neu']);
  });
});

const gpx = (pts: [number, number, number][]) =>
  `<?xml version="1.0"?><gpx><trk><name>Test</name><trkseg>${pts.map(([la, lo, e]) => `<trkpt lat="${la}" lon="${lo}"><ele>${e}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
// gerade Strecke nach Osten, ca. 22 km (0.01° Länge ≈ 0.74 km auf 48°)
const line = Array.from({ length: 31 }, (_, i) => [48, 7 + i * 0.01, 400 + (i % 10) * 20] as [number, number, number]);

describe('Geographisches', () => {
  it('GPX lesen, Distanz, Höhenmeter, Projektion', () => {
    const r = parseGpx(gpx(line));
    expect(r.name).toBe('Test');
    expect(r.lengthKm).toBeGreaterThan(21.5);
    expect(r.lengthKm).toBeLessThan(23);
    const s = climbStats(r.points);
    expect(s.max).toBe(580);
    expect(s.up).toBe(3 * 180);
    const p = projectOnRoute(r.points, 48.005, 7.1);
    expect(p.km).toBeCloseTo(7.45, 0);
    expect(p.offsetM).toBeGreaterThan(450);
    expect(p.offsetM).toBeLessThan(650);
    expect(kmToGo(r.lengthKm, p.km)).toBeCloseTo(r.lengthKm - p.km, 0);
    expect(() => parseGpx('<gpx></gpx>')).toThrow(/keine Strecke/);
  });

  it('Wikipedia-Artikel einordnen und Text säubern', () => {
    expect(classify({ title: 'Cully VD', lat: 0, lon: 0, description: 'Ortschaft und ehemalige Gemeinde im Kanton Waadt', categories: [] })?.kind).toBe('ort');
    expect(classify({ title: 'Schloss Chillon', lat: 0, lon: 0, description: 'Wasserschloss am Genfersee', categories: ['Kulturgut von nationaler Bedeutung im Kanton Waadt'] })?.kind).toBe('sehenswuerdigkeit');
    expect(classify({ title: 'Rhone', lat: 0, lon: 0, description: 'Fluss in der Schweiz und in Frankreich', categories: [] })?.kind).toBe('natur');
    expect(classify({ title: 'Hotel X', lat: 0, lon: 0, description: 'Hotel in Montreux', categories: [] })).toBeNull();
    expect(placeName('Cully VD')).toBe('Cully');
    expect(placeName('Villette (Lavaux)')).toBe('Villette');
    expect(cleanExtract('Lausanne [lozan] ( ) ist eine Stadt.')).toBe('Lausanne ist eine Stadt.');
  });

  it('entlang der Strecke suchen (Fetcher ersetzt), zusammenführen, ausblenden', async () => {
    const route = parseGpx(gpx(line));
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.searchParams.get('generator') === 'geosearch') return { query: { pages: [
        { title: 'Dorf A', coordinates: [{ lat: 48.001, lon: 7.05 }], description: 'Gemeinde im Elsass', categories: [] },
        { title: 'Burg B', coordinates: [{ lat: 48.01, lon: 7.2 }], description: 'Burgruine', categories: [] },
        { title: 'Weit weg', coordinates: [{ lat: 48.2, lon: 7.2 }], description: 'Gemeinde im Elsass', categories: [] },
        { title: 'Firma C', coordinates: [{ lat: 48, lon: 7.1 }], description: 'Unternehmen', categories: [] },
      ] } };
      return { query: { pages: [{ title: 'Dorf A', extract: 'Dorf A [do:f] ist ein Dorf. Mehr.' }] } };
    };
    const found = await findAlongRoute(route.points, { fetcher, pauseMs: 0 });
    expect(found.map((f) => f.name)).toEqual(['Dorf A', 'Burg B']);
    expect(found[0].summary).toBe('Dorf A ist ein Dorf. Mehr.');
    expect(calls.some((c) => c.includes('origin=*'))).toBe(true);

    const race = await createRace({ name: 'Test', year: 2026, kind: 'eintages', startDate: '2026-06-14' });
    const stage = (await db.stages.toArray())[0];
    await saveRoute(stage, route, 'test.gpx');
    expect((await addFound(race.id, 1, found, 'de')).added).toBe(2);
    let pts = await stagePoints(race.id, 1);
    expect(pts).toHaveLength(2);
    await removePoint(pts.find((p) => p.name === 'Burg B')!); // Wikipedia-Punkt wird nur ausgeblendet
    await addFound(race.id, 1, found, 'de'); // erneut holen: nichts doppelt, Ausgeblendetes bleibt aus
    pts = await stagePoints(race.id, 1);
    expect(pts).toHaveLength(2);
    expect(pts.find((p) => p.name === 'Burg B')?.hidden).toBe(true);
    expect(mergeFound(pts, found).add).toHaveLength(0);

    await addPoint(race.id, 1, { kind: 'verpflegung', name: 'Verpflegung', km: 12 });
    const zip = await buildArchive();
    const check = await verifyArchive(zip.bytes);
    expect(check.data.geo).toHaveLength(3);
    expect(check.data.routes).toHaveLength(1);
  });
});
