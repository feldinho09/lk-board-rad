/**
 * Kerntests: Import-Idempotenz, Zuordnungsregeln, Wertungsauflösung,
 * atomares Speichern mit Outbox, Backup-Prüfung und Wiederherstellung.
 * Die Nummern verweisen auf die Abnahmekriterien in Abschnitt 16 des Bauplans.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, db, mutate, newRecord, alive, resetDeviceIdCache } from './db/db';
import type { Edition, RaceSeries, Rider } from './domain/types';
import { parseDelimited, tableFromMatrix } from './import/parse';
import { guessMapping, matchRows, defaultDecision, splitFullName } from './import/matching';
import { prepareMatch, commitImport, undoImport } from './import/commit';
import { normalize, parseDuration, riderSearchTokens, ageAt } from './domain/text';
import { seedDemo } from './demo/demo';
import { resolveStanding } from './domain/standings';
import { buildArchive, verifyArchive, restoreFull, csvCell } from './backup/archive';
import { shouldStoreRevision } from './domain/pcsAdapter';
import { zipSync, unzipSync } from 'fflate';

let n = 0;
beforeEach(async () => {
  resetDeviceIdCache();
  useDatabase(`test-${++n}-${Date.now()}`);
  await db.open();
});

async function makeEdition(bibScope: 'rennen' | 'kategorie' = 'rennen'): Promise<string> {
  return mutate(['series', 'editions'], async (w) => {
    const s = newRecord({ name: 'Testserie' }) as RaceSeries;
    await w.put('series', s);
    const e = newRecord({
      seriesId: s.id, name: 'Testrennen 2026', year: 2026, format: 'eintages', startDate: '2026-05-01',
      timezone: 'Europe/Zurich', status: 'geplant', bibScope,
    }) as Edition;
    await w.put('editions', e);
    return e.id;
  });
}

async function importCsv(editionId: string, csv: string) {
  const t = tableFromMatrix(parseDelimited(csv));
  const mapping = guessMapping(t.headers);
  const m = await prepareMatch(editionId, t.rows, mapping);
  const run = await commitImport(editionId, 'test.csv', m, m.rows.map(defaultDecision));
  return { m, run, mapping };
}

const CSV1 = 'Startnummer;Vorname;Nachname;Team;Nation\n007;Tadej;Pogačar;UAE;SLO\n2;Jonas;Vingegaard;Visma;DEN\n3;Remco;Evenepoel;Red Bull;BEL\n';

describe('Text & Zeit', () => {
  it('normalisiert Akzente, Originalschreibweise bleibt separat', () => {
    expect(normalize('Pogačar')).toBe('pogacar');
    expect(normalize('Øvrebø')).toBe('ovrebo');
    expect(riderSearchTokens('Søren', 'Kjærgaard', 'Søren Kjærgaard', [])).toContain('kjaergaard');
  });
  it('erfindet keine Zeiten', () => {
    expect(parseDuration('s.t.')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('+1:02:03')).toBe(3723);
  });
  it('Alter nur mit Datengrundlage', () => {
    expect(ageAt(undefined, '2026-06-10')).toBeNull();
    expect(ageAt('1998-06-11', '2026-06-10')).toBe('27');
    expect(ageAt('1998', '2026-06-10')).toBe('ca. 27–28');
  });
  it('trennt PCS-Namensstil', () => {
    expect(splitFullName('POGAČAR Tadej')).toEqual({ first: 'Tadej', last: 'Pogačar' });
    expect(splitFullName('VAN DER POEL Mathieu')).toEqual({ first: 'Mathieu', last: 'Van der Poel' });
    expect(splitFullName("O'BRIEN Kelland")).toEqual({ first: 'Kelland', last: "O'Brien" });
    expect(splitFullName('RENARD-HAQUIN Henri-François')).toEqual({ first: 'Henri-François', last: 'Renard-Haquin' });
  });
});

describe('Startlistenimport', () => {
  it('Nr. 5: führende Nullen bleiben erhalten (007)', async () => {
    const e = await makeEdition();
    await importCsv(e, CSV1);
    const parts = await db.participations.where('editionId').equals(e).toArray();
    expect(parts.map((p) => p.bib).sort()).toEqual(['007', '2', '3']);
  });

  it('Nr. 4: dieselbe Startliste zweimal → keine zusätzlichen Personen/Teilnahmen', async () => {
    const e = await makeEdition();
    await importCsv(e, CSV1);
    const { run } = await importCsv(e, CSV1);
    expect(await db.riders.count()).toBe(3);
    expect(await db.participations.count()).toBe(3);
    expect(run.summary.unveraendert).toBe(3);
    expect(run.summary.neu).toBe(0);
  });

  it('Nr. 6: aktualisierte Liste – fehlender Fahrer wird nicht gelöscht, neue Startnummer kontrolliert', async () => {
    const e = await makeEdition();
    await importCsv(e, CSV1);
    const csv2 = 'Startnummer;Vorname;Nachname;Team;Nation\n007;Tadej;Pogačar;UAE;SLO\n21;Jonas;Vingegaard;Visma;DEN\n';
    const { m, run } = await importCsv(e, csv2);
    expect(m.notInFile).toHaveLength(1);
    expect(run.summary.geaendert).toBe(1);
    const parts = alive(await db.participations.where('editionId').equals(e).toArray());
    expect(parts).toHaveLength(3);
    expect(parts.find((p) => p.bib === '21')).toBeTruthy();
    expect(parts.every((p) => p.status === 'gemeldet')).toBe(true);
  });

  it('Nr. 5: Namensgleichheit allein führt nicht zur automatischen Zuordnung', async () => {
    const e1 = await makeEdition();
    await importCsv(e1, 'Nr;Vorname;Nachname;Team\n1;Luca;Bianchi;A\n');
    const e2 = await makeEdition();
    const t = tableFromMatrix(parseDelimited('Nr;Vorname;Nachname;Team\n5;Luca;Bianchi;B\n'));
    const m = await prepareMatch(e2, t.rows, guessMapping(t.headers));
    expect(m.rows[0].status).toBe('mehrdeutig');
    expect(defaultDecision(m.rows[0])).toEqual({ action: 'zurueckstellen' });
  });

  it('Nr. 5: Akzentvariante + bestätigendes Merkmal ordnet zu; widersprüchliche externe ID verlangt Entscheidung', async () => {
    const e1 = await makeEdition();
    await importCsv(e1, 'Nr;Vorname;Nachname;Nation;UCI-ID\n1;Tadej;Pogačar;SLO;100\n');
    const e2 = await makeEdition();
    const t = tableFromMatrix(parseDelimited('Nr;Vorname;Nachname;Nation\n1;Tadej;Pogacar;SLO\n'));
    const m = await prepareMatch(e2, t.rows, guessMapping(t.headers));
    expect(m.rows[0].status).toBe('zugeordnet');
    const t2 = tableFromMatrix(parseDelimited('Nr;Vorname;Nachname;Nation;UCI-ID\n1;Tadej;Pogačar;SLO;999\n'));
    const m2 = await prepareMatch(e2, t2.rows, guessMapping(t2.headers));
    expect(m2.rows[0].status).toBe('mehrdeutig');
  });

  it('doppelte Startnummer in der Datei → fehlerhaft, nicht still ausgelassen', () => {
    const t = tableFromMatrix(parseDelimited('Nr;Name\n1;A Eins\n1;B Zwei\n2;\n'));
    const m = matchRows(t.rows, guessMapping(t.headers), { riders: [], editionParticipations: [], bibScope: 'rennen' });
    expect(m.rows.map((r) => r.status)).toEqual(['fehlerhaft', 'fehlerhaft', 'fehlerhaft']);
  });

  it('Rücknahme überschreibt keine zwischenzeitlichen Bearbeitungen', async () => {
    const e = await makeEdition();
    const { run } = await importCsv(e, CSV1);
    const p = (await db.participations.toArray()).find((x) => x.bib === '2')!;
    await mutate(['participations'], (w) => w.put('participations', { ...p, favorite: true }));
    const res = await undoImport(run.id);
    expect(res.skipped.length).toBeGreaterThan(0);
    const remaining = alive(await db.participations.toArray());
    expect(remaining.map((x) => x.bib)).toEqual(['2']);
  });

  it('Nr. 7: Teilnahme speichert Team als Momentaufnahme', async () => {
    const e = await makeEdition();
    await importCsv(e, CSV1);
    const r = (await db.riders.toArray()).find((x) => x.lastName === 'Pogačar')!;
    // Profiländerung berührt die Teilnahme nicht
    await mutate(['riders'], (w) => w.put('riders', { ...r, riderType: 'Rundfahrer' } as Rider));
    const p = await db.participations.where('riderId').equals(r.id).first();
    expect(p!.teamName).toBe('UAE');
  });
});

describe('Speichern', () => {
  it('Änderung und Versandauftrag werden atomar gespeichert', async () => {
    const e = await makeEdition();
    const ops = await db.outbox.toArray();
    expect(ops.filter((o) => o.entityId === e)).toHaveLength(1);
  });
  it('Nr. 3/16: Fehler in der Transaktion → nichts gespeichert, keine Outbox-Einträge', async () => {
    const before = await db.outbox.count();
    await expect(mutate(['notes'], async (w) => {
      await w.put('notes', newRecord({ scope: 'rider', refId: 'x', text: 't', toldInEditions: [], priority: false, private: false }));
      throw new Error('Simulierter Schreibfehler');
    })).rejects.toThrow();
    expect(await db.notes.count()).toBe(0);
    expect(await db.outbox.count()).toBe(before);
  });
});

describe('Rundfahrt & Wertungen (Demo)', () => {
  it('Nr. 27: Etappenergebnis und Gesamtwertung getrennt; fehlender GC-Stand wird ausgewiesen', async () => {
    const id = await seedDemo();
    const stages = await db.stages.where('editionId').equals(id).toArray();
    const standings = await db.standings.where('editionId').equals(id).toArray();
    const e4 = stages.find((s) => s.order === 4)!;
    const stage = resolveStanding('etappe', e4.id, stages, standings);
    expect(stage.exact).toBe(true);
    const gc = resolveStanding('gc', e4.id, stages, standings);
    expect(gc.exact).toBe(false);
    expect(gc.stage!.label).toBe('Etappe 3 (EZF)');
    expect(gc.label).toContain('Gesamtwertung nach Etappe 3 (EZF)');
    expect(gc.label).toContain('Stand nach Etappe 4 noch nicht vorhanden');
    const team = resolveStanding('team', e4.id, stages, standings);
    expect(team.standing!.rows[0].teamName).toBeTruthy();
    expect(team.standing!.rows[0].riderId).toBeUndefined();
  });

  it('Nr. 32: DNF ohne Platz und ohne erfundene Zeit', async () => {
    const id = await seedDemo();
    const standings = await db.standings.where('editionId').equals(id).toArray();
    const rows = standings.filter((s) => s.kind === 'etappe').flatMap((s) => s.rows);
    const dnf = rows.filter((r) => r.status === 'DNF');
    expect(dnf.length).toBeGreaterThan(0);
    expect(dnf.every((r) => r.rank === null && r.timeSec === null)).toBe(true);
  });

  it('Nr. 30: Fehler/leere Antwort ersetzt keinen bestehenden Stand', () => {
    expect(shouldStoreRevision('abc', { ok: false, reason: 'rate_limited' })).toBe('keep_existing');
    expect(shouldStoreRevision('abc', { ok: true, data: { rows: [], contentHash: 'x' } as never })).toBe('keep_existing');
    expect(shouldStoreRevision('abc', { ok: true, data: { rows: [{}], contentHash: 'abc' } as never })).toBe('unchanged');
  });
});

describe('Sicherung', () => {
  it('Nr. 13: Backup → leerer Bestand → Wiederherstellung vollständig', async () => {
    await seedDemo();
    const counts = { riders: await db.riders.count(), standings: await db.standings.count() };
    const { bytes } = await buildArchive();
    resetDeviceIdCache();
    useDatabase(`restore-${Date.now()}`);
    await db.open();
    const v = await verifyArchive(bytes);
    await restoreFull(v);
    expect(await db.riders.count()).toBe(counts.riders);
    expect(await db.standings.count()).toBe(counts.standings);
    expect((await db.device.get('syncPaused'))).toBeTruthy();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Nr. 14: beschädigtes Archiv wird vor dem Ersetzen erkannt, Bestand bleibt intakt', async () => {
    await seedDemo();
    const before = await db.riders.count();
    const { bytes } = await buildArchive();
    const files = unzipSync(bytes);
    files['data.json'][10] = files['data.json'][10] ^ 0xff;
    await expect(verifyArchive(zipSync(files))).rejects.toThrow(/Prüfsumme/);
    await expect(verifyArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(await db.riders.count()).toBe(before);
  });

  it('CSV-Export schützt gegen Formelinterpretation', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe("'-5");
  });
});
