// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, db } from '../db/db';
import { applyStartlist, createRace, createRider, createTopic, raceStages, saveRaceSection, saveRiderSection, updateStage } from '../domain/center';
import { buildExportDoc, collectExportData, DEFAULT_EXPORT, exportFileName } from './exportDoc';

let n = 0;
beforeEach(async () => { useDatabase(`export-${++n}-${Date.now()}`); await db.open(); });

describe('PDF-Export', () => {
  it('enthält gewählte Abschnitte, Etappen, Startliste, Profile und ★-Themen', async () => {
    const r = await createRider({ firstName: 'Marc', lastName: 'Hirschi', nation: 'SUI', birthDate: '1998-08-24' });
    await saveRiderSection(r.id, 'aktuell', '<div><ul><li>★ Rückenprobleme</li></ul></div>');
    await saveRiderSection(r.id, 'zitate', '<div>nicht gewählt</div>');
    const race = await createRace({ name: 'Tour de Suisse', year: 2027, kind: 'rundfahrt', startDate: '2027-06-13', stageCount: 2 });
    await saveRaceSection(race.id, 'favoriten', '<div>Ayuso</div>');
    await saveRaceSection(race.id, 'geschichte', '<div>nicht gewählt</div>');
    const [s1] = await raceStages(race.id);
    await updateStage(s1.id, { start: 'Küssnacht', finish: 'Küssnacht', distanceKm: 152, notes: '<div>Schlussanstieg</div>' });
    await applyStartlist(race.id, [{ bib: '11', name: 'HIRSCHI Marc', team: 'Tudor' }, { bib: '1', name: 'AYUSO Juan', team: 'Lidl-Trek' }]);
    await createTopic({ kind: 'statistik', title: 'Stern-Thema', raceId: race.id, starred: true });
    await createTopic({ kind: 'notiz', title: 'Ohne Stern', raceId: race.id });
    const doc = buildExportDoc(await collectExportData(race.id), DEFAULT_EXPORT, new Date('2027-06-10T10:00:00Z'));
    const json = JSON.stringify(doc.content);
    for (const s of ['Tour de Suisse 2027', 'Favoriten', 'Ayuso', 'Etappe 1', 'Küssnacht – Küssnacht', '152 km', 'Schlussanstieg', 'Startliste', 'Tudor', 'Marc Hirschi', 'SUI', '28 Jahre', '» Rückenprobleme', 'Stern-Thema']) expect(json).toContain(s);
    for (const s of ['nicht gewählt', 'Ohne Stern', '★']) expect(json).not.toContain(s);
    expect(exportFileName(race, new Date('2027-06-10T10:00:00Z'))).toBe('Tour-de-Suisse-2027_2027-06-10.pdf');
  });
});
