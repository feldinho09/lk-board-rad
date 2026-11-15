// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, db, getDevice } from '../db/db';
import { applyStartlist, createRace, raceEntries, raceStages } from './center';
import { latestStandings, moveBib, newGroup, parseBibs, parseStanding, riderRanks, saveSituation, saveStanding } from './standings';
import { climbGradient, climbText } from './geo';
import { nudgeKmToGo, addPoint } from './geoStore';
import { pasteRows } from './rundown';
import { buildExportDoc, collectExportData, DEFAULT_EXPORT } from '../export/exportDoc';

let n = 0;
beforeEach(async () => { useDatabase(`st-${++n}-${Date.now()}`); await db.open(); });

async function setup() {
  const race = await createRace({ name: 'Tour de Suisse', year: 2027, kind: 'rundfahrt', startDate: '2027-06-13', stageCount: 3 });
  await applyStartlist(race.id, [
    { bib: '1', name: 'AYUSO Juan', team: 'Lidl - Trek' },
    { bib: '11', name: 'HIRSCHI Marc', team: 'Tudor' },
    { bib: '21', name: 'VINGEGAARD Jonas', team: 'Visma' },
    { bib: '22', name: 'KUSS Sepp', team: 'Visma' },
  ]);
  return { race, entries: await raceEntries(race.id), stages: await raceStages(race.id) };
}

describe('Klassemente', () => {
  it('PCS-artige Rangliste: Rang, Fahrer über Startliste, Rückstand, „,,“', async () => {
    const { entries } = await setup();
    const text = [
      'Rnk\tBIB\tRider\tTeam\tTime',
      '1\t21\tVINGEGAARD Jonas\tVisma\t12:34:56',
      '2\t1\tAYUSO Juan\tLidl - Trek\t0:42',
      '3\t22\tKUSS Sepp\tVisma\t,,',
      '4\t\tUNBEKANNT Max\tX Team\t1:05',
    ].join('\n');
    const rows = parseStanding(text, entries);
    expect(rows.map((r) => [r.rank, r.bib, r.name, r.value])).toEqual([
      [1, '21', 'Jonas Vingegaard', '12:34:56'],
      [2, '1', 'Juan Ayuso', '0:42'],
      [3, '22', 'Sepp Kuss', '0:42'],
      [4, undefined, 'UNBEKANNT Max X Team', '1:05'],
    ]);
    // Punkte-Wertung: letzte Zahl
    expect(parseStanding('1 HIRSCHI Marc Tudor 45\n2. Juan Ayuso 30', entries).map((r) => [r.name, r.value])).toEqual([['Marc Hirschi', '45'], ['Juan Ayuso', '30']]);
  });

  it('neuester Stand pro Wertung und Plätze eines Fahrers', async () => {
    const { entries, stages } = await setup();
    await saveStanding(stages[0], 'gc', parseStanding('1 Marc Hirschi 4:00:00\n2 Jonas Vingegaard 0:05', entries));
    await saveStanding(stages[1], 'gc', parseStanding('1 Jonas Vingegaard 8:00:00\n2 Marc Hirschi 0:10', entries));
    await saveStanding(stages[0], 'berg', parseStanding('1 Sepp Kuss 12', entries));
    const all = await raceStages(stages[0].raceId);
    const l2 = latestStandings(all, 2);
    expect(l2.map((l) => [l.kind, l.stage.number])).toEqual([['gc', 2], ['berg', 1]]);
    expect(latestStandings(all, 1).find((l) => l.kind === 'gc')!.rows[0].name).toBe('Marc Hirschi');
    const hirschi = entries.find((e) => e.bib === '11')!;
    expect(riderRanks(l2, hirschi)).toEqual([{ kind: 'gc', rank: 2, value: '0:10', stageNumber: 2 }]);
    await saveStanding(all[1], 'gc', []);
    expect(latestStandings(await raceStages(stages[0].raceId), 2).find((l) => l.kind === 'gc')!.stage.number).toBe(1);
  });
});

describe('Rennsituation', () => {
  it('Startnummern lesen und zwischen Gruppen verschieben', async () => {
    expect(parseBibs('11 21, 22;11 x 5000')).toEqual(['11', '21', '22']);
    const a = { ...newGroup('Spitze'), bibs: ['11', '21'] }, b = newGroup('Feld');
    const moved = moveBib([a, b], '21', b.id);
    expect(moved.map((g) => g.bibs)).toEqual([['11'], ['21']]);
    const { stages } = await setup();
    await saveSituation(stages[0].id, moved);
    const s = await db.stages.get(stages[0].id);
    expect(s!.situation!.groups[1].bibs).toEqual(['21']);
    expect(s!.situation!.at).toBeTruthy();
  });
});

describe('Anstiege und km to go', () => {
  it('Steigung aus der Strecke, Text, km to go per Taste', async () => {
    // 10 km, von 500 m auf 1100 m (km 4 bis 10 linear)
    const pts = Array.from({ length: 101 }, (_, i) => [46, 7 + i * 0.001, i <= 40 ? 500 : 500 + (i - 40) * 10, i / 10] as [number, number, number, number]);
    expect(climbGradient(pts, 10, 6)).toBe(10);
    expect(climbText({ climbLengthKm: 6, climbGradient: 10, climbCategory: '1' })).toBe('6 km à 10 % · Kat. 1');
    expect(climbText({ climbCategory: 'HC' })).toBe('HC');
    const { race, stages } = await setup();
    const st = { ...stages[0], distanceKm: 150 };
    await nudgeKmToGo(race.id, st, -1);
    await nudgeKmToGo(race.id, st, -1);
    expect(await getDevice(`kmToGo:${race.id}:${st.number}`, 0)).toBe(148);
    await nudgeKmToGo(race.id, st, 5);
    expect(await getDevice(`kmToGo:${race.id}:${st.number}`, 0)).toBe(150);
  });

  it('PDF-Spickzettel mit Ablauf, Punkten und Klassement', async () => {
    const { race, stages, entries } = await setup();
    await pasteRows(race.id, 1, "14:00\t5\tOpener\n14:05\t60\tLive", false);
    await addPoint(race.id, 1, { kind: 'anstieg', name: 'Col du Pillon', km: 120, climbLengthKm: 7, climbGradient: 6.2, climbCategory: '2' });
    await saveStanding(stages[0], 'gc', parseStanding('1 Marc Hirschi 4:00:00', entries));
    const st = (await raceStages(race.id))[0];
    await db.stages.put({ ...st, distanceKm: 150 });
    const doc = buildExportDoc(await collectExportData(race.id), { ...DEFAULT_EXPORT, sheetRundown: true, sheetGeo: true, sheetStandings: true, onlyStage: 1 });
    const json = JSON.stringify(doc.content);
    for (const s of ['Spickzettel Etappe 1', 'Opener', "60'", 'Col du Pillon', '30.0', '7 km à 6.2 % · Kat. 2', 'Gesamt nach Etappe 1', 'Marc Hirschi']) expect(json).toContain(s);
    expect(json).not.toContain('Spickzettel Etappe 2');
  });
});
