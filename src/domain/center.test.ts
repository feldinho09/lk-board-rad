// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, db, alive } from '../db/db';
import {
  addRidersToRace, applyStartlist, createRace, createRider, createTopic, deleteRider, displayName, findRiderByName, nameMatchKey,
  pcsSlugFrom, profileFromEntry, profilesByLastRace, raceEntries, raceStages, saveRiderSection, searchAll, setEntryStatus, topicsFor, updateEntry, ageOn,
} from './center';
import { buildArchive, verifyArchive, restoreFull, createRestorePoint } from '../backup/archive';

let n = 0;
beforeEach(async () => { useDatabase(`center-${++n}-${Date.now()}`); await db.open(); });

describe('Fahrer und Namen', () => {
  it('Namen vergleichen unabhängig von Reihenfolge und Akzenten', async () => {
    expect(nameMatchKey('POGAČAR Tadej')).toBe(nameMatchKey('Tadej Pogacar'));
    expect(displayName('VAN DER POEL Mathieu')).toBe('Mathieu Van der Poel');
    const a = await createRider({ firstName: 'Tadej', lastName: 'Pogačar' });
    expect(a).toMatchObject({ name: 'Tadej Pogačar', searchKey: 'tadej pogacar', sections: {} });
    expect(findRiderByName([a], 'POGACAR Tadej')?.id).toBe(a.id);
    expect(findRiderByName([a, { ...a, id: 'x' }], 'Tadej Pogačar')).toBeUndefined(); // mehrdeutig
  });

  it('„Aktuell“ merkt sich das Änderungsdatum', async () => {
    const r = await createRider({ firstName: 'Marc', lastName: 'Hirschi' });
    await saveRiderSection(r.id, 'aktuell', '<div>fit</div>');
    await saveRiderSection(r.id, 'erfolge', '<div>WM U23</div>');
    const x = (await db.riders.get(r.id))!;
    expect(x.sections).toEqual({ aktuell: '<div>fit</div>', erfolge: '<div>WM U23</div>' });
    expect(x.aktuellAt).toBeTruthy();
  });

  it('PCS-Kennung aus Adresse', () => {
    expect(pcsSlugFrom('https://www.procyclingstats.com/rider/tadej-pogacar')).toBe('tadej-pogacar');
    expect(pcsSlugFrom('marc-hirschi')).toBe('marc-hirschi');
    expect(pcsSlugFrom('Marc Hirschi')).toBeUndefined();
  });

  it('Alter am Renntag', () => {
    expect(ageOn('1998-08-24', '2027-06-13')).toBe(28);
    expect(ageOn('1998-08-24', '2027-08-24')).toBe(29);
    expect(ageOn('1998', '2027-06-13')).toBeNull();
  });
});

describe('Rennen und Startliste', () => {
  it('Rundfahrt mit Etappen und Daten; Eintagesrennen mit einer', async () => {
    const r = await createRace({ name: 'Tour de Suisse', year: 2027, kind: 'rundfahrt', startDate: '2027-06-13', stageCount: 8 });
    const st = await raceStages(r.id);
    expect(st.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(st[7].date).toBe('2027-06-20');
    const e = await createRace({ name: 'Paris–Roubaix', year: 2027, kind: 'eintages', stageCount: 5 });
    expect(await raceStages(e.id)).toHaveLength(1);
  });

  it('Startliste einfügen: verknüpft Profile, behält Notizen und Status beim erneuten Einfügen', async () => {
    const hir = await createRider({ firstName: 'Marc', lastName: 'Hirschi', team: 'Tudor' });
    const race = await createRace({ name: 'TdS', year: 2027, kind: 'rundfahrt', stageCount: 3 });
    const rows = [{ bib: '1', name: 'AYUSO Juan', team: 'Lidl-Trek' }, { bib: '11', name: 'HIRSCHI Marc', team: 'Tudor' }, { bib: '12', name: 'STORER Michael', team: 'Tudor' }];
    const r1 = await applyStartlist(race.id, rows);
    expect(r1).toMatchObject({ added: 3, linked: 1, withProfile: 1 });
    const es = await raceEntries(race.id);
    expect(es.map((e) => [e.bib, e.name])).toEqual([['1', 'Juan Ayuso'], ['11', 'Marc Hirschi'], ['12', 'Michael Storer']]);
    expect(es[1].riderId).toBe(hir.id);
    await updateEntry(es[1].id, { note: '<div>Leader</div>' });
    await setEntryStatus(es[2].id, 'dnf', 2);
    // Nachmeldung: neue Startnummer, ein Fahrer fehlt
    const r2 = await applyStartlist(race.id, [{ bib: '1', name: 'AYUSO Juan', team: 'Lidl-Trek' }, { bib: '14', name: 'HIRSCHI Marc', team: 'Tudor' }], { removeMissing: false });
    expect(r2).toMatchObject({ added: 0, updated: 1, unchanged: 1, removed: 0 });
    const after = await raceEntries(race.id);
    const h = after.find((e) => e.riderId === hir.id)!;
    expect(h).toMatchObject({ bib: '14', note: '<div>Leader</div>' });
    expect(after.find((e) => e.name === 'Michael Storer')).toMatchObject({ status: 'dnf', statusStage: 2 });
    const r3 = await applyStartlist(race.id, [{ bib: '1', name: 'AYUSO Juan' }], { removeMissing: true });
    expect(r3.removed).toBe(2);
  });

  it('Profile von Rennen zu Rennen übernehmen; zuletzt gefahrene zuerst vorgeschlagen', async () => {
    const a = await createRider({ firstName: 'Marc', lastName: 'Hirschi' });
    const b = await createRider({ firstName: 'Mauro', lastName: 'Schmid' });
    const r1 = await createRace({ name: 'Romandie', year: 2027, kind: 'rundfahrt', startDate: '2027-04-27', stageCount: 6 });
    await addRidersToRace(r1.id, [a.id, b.id]);
    expect((await raceEntries(r1.id)).map((e) => e.name).sort()).toEqual(['Marc Hirschi', 'Mauro Schmid']);
    const r2 = await createRace({ name: 'TdS', year: 2027, kind: 'rundfahrt', startDate: '2027-06-13', stageCount: 8 });
    await applyStartlist(r2.id, [{ bib: '11', name: 'HIRSCHI Marc', team: 'Tudor' }]);
    // Hirschi steht ohne Verknüpfung? Nein – über den Namen verknüpft. Schmid wird übernommen.
    expect(await addRidersToRace(r2.id, [a.id, b.id])).toBe(1);
    const es = await raceEntries(r2.id);
    expect(es).toHaveLength(2);
    expect(es.every((e) => e.riderId)).toBe(true);
    const sugg = await profilesByLastRace();
    expect(sugg.find((x) => x.rider.id === b.id)?.lastRace?.name).toBe('TdS');
  });

  it('Profil aus Startlisten-Eintrag; Löschen eines Profils lässt die Startliste stehen', async () => {
    const race = await createRace({ name: 'TdS', year: 2027, kind: 'eintages' });
    await applyStartlist(race.id, [{ bib: '5', name: 'O\'CONNOR Ben', team: 'Jayco' }]);
    const [e] = await raceEntries(race.id);
    const r = await profileFromEntry(e.id);
    expect(r).toMatchObject({ firstName: 'Ben', lastName: "O'Connor", team: 'Jayco' });
    await deleteRider(r.id);
    const [e2] = await raceEntries(race.id);
    expect(e2).toMatchObject({ name: "Ben O'Connor", riderId: undefined });
  });
});

describe('Themen und Suche', () => {
  it('Themen nach Rennen, Etappe und Fahrer; ★ zuerst', async () => {
    const r = await createRider({ firstName: 'Marc', lastName: 'Hirschi' });
    const race = await createRace({ name: 'TdS', year: 2027, kind: 'rundfahrt', stageCount: 3 });
    const t1 = await createTopic({ kind: 'statistik', title: 'Alt', raceId: race.id });
    const t2 = await createTopic({ kind: 'zitat', body: '<div>bereit</div>', raceId: race.id, riderIds: [r.id], starred: true });
    const t3 = await createTopic({ kind: 'geschichte', title: 'Etappe 2', raceId: race.id, stageNumber: 2 });
    const t4 = await createTopic({ kind: 'notiz', title: 'Ohne Rennen', riderIds: [r.id] });
    const all = alive(await db.topics.toArray());
    expect(topicsFor(all, { raceId: race.id, stageNumber: 1 }).map((t) => t.id)).toEqual([t2.id, t1.id]);
    expect(topicsFor(all, { raceId: race.id, stageNumber: 2 }).map((t) => t.id)).toContain(t3.id);
    expect(topicsFor(all, { riderId: r.id }).map((t) => t.id).sort()).toEqual([t2.id, t4.id].sort());
  });

  it('Suche über Namen, Texte, Rennen und Themen – akzentunabhängig', async () => {
    const r = await createRider({ firstName: 'Tadej', lastName: 'Pogačar', team: 'UAE' });
    await saveRiderSection(r.id, 'persoenlich', '<div>Liebt <b>Kaffee</b> aus Komenda</div>');
    await createRace({ name: 'Tour de France', year: 2027, kind: 'rundfahrt', stageCount: 21 });
    await createTopic({ kind: 'statistik', title: 'Gelbe Trikots', body: '<div>Pogacar 70 Tage</div>' });
    expect((await searchAll('pogacar')).map((h) => h.kind)).toEqual(['rider', 'topic']);
    expect((await searchAll('komenda'))[0]).toMatchObject({ kind: 'rider', sub: 'Treffer im Profil' });
    expect((await searchAll('tour france'))[0]).toMatchObject({ kind: 'race' });
    expect(await searchAll('')).toEqual([]);
  });
});

describe('Sicherung', () => {
  it('Archiv mit Prüfsummen; Wiederherstellung ersetzt den Bestand vollständig', async () => {
    const r = await createRider({ firstName: 'Marc', lastName: 'Hirschi' });
    const race = await createRace({ name: 'TdS', year: 2027, kind: 'rundfahrt', stageCount: 2 });
    await applyStartlist(race.id, [{ bib: '11', name: 'HIRSCHI Marc' }]);
    const { bytes, manifest } = await buildArchive();
    expect(manifest.counts).toMatchObject({ riders: 1, races: 1, stages: 2, entries: 1, topics: 0 });
    await createRider({ firstName: 'Neu', lastName: 'Fahrer' });
    await createRestorePoint('Test');
    const v = await verifyArchive(bytes);
    await restoreFull(v);
    expect((await db.riders.toArray()).map((x) => x.id)).toEqual([r.id]);
    expect(await db.restorePoints.count()).toBeGreaterThanOrEqual(2);
    const broken = bytes.slice(); broken[broken.length - 30] ^= 0xff;
    await expect(verifyArchive(broken)).rejects.toThrow();
  });
});

describe('PCS-Kennung aus der Startliste', () => {
  it('speichert die Kennung am Eintrag, ergänzt das Profil und bildet den direkten Link', async () => {
    const { createRider, applyStartlist, raceEntries, entryPcsUrl, createRace, profileFromEntry } = await import('./center');
    const r = await createRider({ firstName: 'Jonas', lastName: 'Vingegaard' });
    const race = await createRace({ name: 'Tour', year: 2027, kind: 'eintages', startDate: '2027-07-01' });
    await applyStartlist(race.id, [{ bib: '21', name: 'VINGEGAARD Jonas', team: 'Visma', pcsSlug: 'jonas-vingegaard-rasmussen' }, { bib: '1', name: 'POGAČAR Tadej', team: 'UAE', pcsSlug: 'tadej-pogacar' }, { bib: '2', name: 'NARVÁEZ Jhonatan', team: 'UAE' }]);
    const es = await raceEntries(race.id);
    expect((await db.riders.get(r.id))!.pcsSlug).toBe('jonas-vingegaard-rasmussen');
    const tp = es.find((e) => e.bib === '1')!;
    expect(entryPcsUrl(tp)).toBe('https://www.procyclingstats.com/rider/tadej-pogacar');
    expect(entryPcsUrl(es.find((e) => e.bib === '2')!)).toContain('search.php?term=');
    expect((await profileFromEntry(tp.id)).pcsSlug).toBe('tadej-pogacar');
    // erneut ohne Links einfügen: Kennung bleibt
    await applyStartlist(race.id, [{ bib: '1', name: 'POGAČAR Tadej', team: 'UAE' }]);
    expect((await raceEntries(race.id)).find((e) => e.bib === '1')!.pcsSlug).toBe('tadej-pogacar');
  });
});
