/**
 * Manuell kopierte PCS-Ranglisten. Aufbau nachgebildet nach echten Kopien
 * (Etappe, GC, Punkte, Berg, Nachwuchs, Team); Namen und Teams frei erfunden.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parsePcsRanking } from './pcsPaste';
import { resolveRanking, saveRanking } from './pcsRankingCommit';
import { useDatabase, db, mutate, newRecord, resetDeviceIdCache } from '../db/db';
import { resolveStanding } from '../domain/standings';
import type { Edition, Participation, RaceSeries, Rider, Stage } from '../domain/types';
import { riderSearchTokens } from '../domain/text';

const HEAD = ['search', 'Home', 'ME', 'PREV', 'Stage 2 | Nordstadt - Südstadt', 'NEXT', '2025', '2026',
  '2026   »   7th Fiktivia Rundfahrt (2.Pro)', 'Stage 2   »   Nordstadt  ›  Südstadt   (168.5km)',
  'Stage', 'GC', 'Points', 'KOM', 'Youth', 'Teams', 'previous stage   next stage  SpecialtyH2HBIBsAge', 'all teams', '', 'all'];
const TAIL = ['Race information', 'Date5 July 2026', 'DNF = Did not finish', 'Pageload 0.06s'];
const doc = (lines: string[]) => [...HEAD, ...lines, ...TAIL].join('\r\n');

const STAGE = doc([
  'Rnk\tRider\tTeam\tUCI\tPCS\t\tTimelag',
  '1\t BRÄNDLI Jonas', 'Alpenfirn Racing\t210\t100\t\t3:40:01',
  '2\t ØVREBØ Lars ', 'Équipe Lumière\t150\t70\t\t,,',
  '3\t DE LA ROSA Pablo', 'Squadra Fiume\t110\t50\t\t0:03',
  '4\t MÜLLER Hans', 'Alpenfirn Racing\t\t\t\t,,',
  'DNS\t ZÜRCHER Reto', 'Alpenfirn Racing\t\t\t\t',
  'timelimit 20%, or 4:24:01 (+0:44:00)',
]);
const GC = doc(['General', 'Today', 'General classification',
  'Rnk\tPrev.\t▼▲\tRider\tTeam\tUCI\t\tTimelag',
  '1\t2\t▲1\t ØVREBØ Lars', 'Équipe Lumière\t25\t\t7:01:48',
  '2\t1\t▼1\t BRÄNDLI Jonas', 'Alpenfirn Racing\t\t\t0:06',
  '3\t3\t-\t DE LA ROSA Pablo', 'Squadra Fiume\t\t\t,,',
]);
const POINTS = doc(['General', 'Today', 'Points classification', 'Rnk\tPrev.\t▼▲\tRider\tTeam\tPnt\t',
  '1\t\t\t BRÄNDLI Jonas', 'Alpenfirn Racing\t30\t', '2\t\t\t ØVREBØ Lars', 'Équipe Lumière\t25\t']);
const KOM = doc(['General', 'Today', 'Mountains classification', 'Rnk\tPrev.\t▼▲\tRider\tTeam\tPnt\t',
  '1\t\t\t DE LA ROSA Pablo', 'Squadra Fiume\t5\t', '2\t1\t▼1\t BRÄNDLI Jonas', 'Alpenfirn Racing\t4\t']);
const TEAMS = doc(['General', 'Today', 'Teams classification', '#\tPrev\t▼▲\tTeam\tClass\tTime',
  '1\t2\t▲1\tAlpenfirn Racing\tWT\t12:09:07', '2\t1\t▼1\tÉquipe Lumière\tPRT\t0:21']);

describe('PCS-Ranglisten erkennen', () => {
  it('Etappenergebnis: Siegerzeit, Rückstände, „,,“ = gleiche Zeit, DNS ohne Zeit', () => {
    const r = parsePcsRanking(STAGE)!;
    expect(r).toMatchObject({ kind: 'etappe', unit: 'zeit', kindCertain: true });
    expect(r.meta).toMatchObject({ raceName: 'Fiktivia Rundfahrt', year: 2026, stageLabel: 'Etappe 2', stageNumber: 2 });
    expect(r.rows.map((x) => [x.rank ?? x.status, x.timeSec ?? null, x.gapSec, !!x.sameTimeAsPrevious])).toEqual([
      [1, 13201, 0, false], [2, null, 0, true], [3, null, 3, false], [4, null, 3, true], ['DNS', null, null, false],
    ]);
    expect(r.rows[1].name).toBe('ØVREBØ Lars'); // Leerzeichen am Ende entfernt
    // Die UCI-/PCS-Punktespalten werden NICHT als Zeit gelesen
    expect(r.rows[3].sourceValue).toBe(',,');
  });

  it('Gesamtwertung mit Vorplatz; Punkte (unsicher General/Today), Berg (sicher), Team', () => {
    expect(parsePcsRanking(GC)!).toMatchObject({ kind: 'gc', rows: [{ rank: 1, prevRank: 2, timeSec: 25308 }, { gapSec: 6 }, { gapSec: 6, sameTimeAsPrevious: true }] });
    expect(parsePcsRanking(POINTS)!).toMatchObject({ kind: 'punkte', unit: 'punkte', kindCertain: false, rows: [{ points: 30 }, { points: 25 }] });
    expect(parsePcsRanking(KOM)!).toMatchObject({ kind: 'berg', kindCertain: true });
    const t = parsePcsRanking(TEAMS)!;
    expect(t).toMatchObject({ kind: 'team', rows: [{ team: 'Alpenfirn Racing', teamClass: 'WT', timeSec: 43747 }, { team: 'Équipe Lumière', gapSec: 21 }] });
    expect(t.rows[0].name).toBeUndefined();
  });

  it('Startlisten und normale Tabellen sind keine Ranglisten', () => {
    expect(parsePcsRanking('Nr;Name\n1;A\n2;B')).toBeNull();
    expect(parsePcsRanking('2026 » 1st X (1.1)\nTeam A (WT)\n1MUSTER Max\n2PROBE Paul')).toBeNull();
  });
});

describe('PCS-Ranglisten speichern', () => {
  let n = 0;
  let editionId = '', stage2 = '', stage1 = '';
  const parts: Record<string, Participation> = {};
  beforeEach(async () => {
    resetDeviceIdCache();
    useDatabase(`pcsrank-${++n}-${Date.now()}`);
    await db.open();
    await mutate(['series', 'editions', 'stages', 'riders', 'participations'], async (w) => {
      const s = newRecord({ name: 'Fiktivia' }) as RaceSeries; await w.put('series', s);
      const e = newRecord({ seriesId: s.id, name: 'Fiktivia 2026', year: 2026, format: 'etappen', startDate: '2026-07-04', timezone: 'Europe/Zurich', status: 'laeuft', bibScope: 'rennen' }) as Edition;
      await w.put('editions', e); editionId = e.id;
      for (const o of [1, 2]) { const st = newRecord({ editionId, order: o, label: `Etappe ${o}`, date: '2026-07-0' + (3 + o), type: 'strasse' }) as Stage; await w.put('stages', st); if (o === 1) stage1 = st.id; else stage2 = st.id; }
      for (const [bib, first, last] of [['1', 'Jonas', 'Brändli'], ['2', 'Lars', 'Øvrebø'], ['3', 'Pablo', 'De la Rosa'], ['4', 'Reto', 'Zürcher']]) {
        const r = newRecord({ firstName: first, lastName: last, displayName: `${first} ${last}`, aliases: [], keyFacts: [], tags: [], externalIds: [], searchTokens: riderSearchTokens(first, last, `${first} ${last}`, []) }) as Rider;
        await w.put('riders', r);
        const p = newRecord({ editionId, riderId: r.id, bib, teamName: 'X', status: 'aktiv', favorite: false, overrides: {} }) as Participation;
        await w.put('participations', p); parts[last] = p;
      }
    });
  });

  it('ordnet Fahrer zu (akzentunabhängig), unbekannte bleiben mit PCS-Namen erhalten, DNS → Status', async () => {
    const res = await resolveRanking(editionId, parsePcsRanking(STAGE)!);
    expect(res.rows.filter((r) => r.riderId)).toHaveLength(4);
    expect(res.unresolved).toEqual(['MÜLLER Hans']);
    expect(res.rows[3].name).toBe('MÜLLER Hans');
    expect(res.rows[3].riderId).toBeUndefined();
    expect(res.outUpdates.map((u) => [u.part.bib, u.status])).toEqual([['4', 'DNS']]);
    const out = await saveRanking({ editionId, stageId: stage2, kind: 'etappe', unit: 'zeit', resolved: res, applyStatus: true });
    expect(out).toMatchObject({ outcome: 'gespeichert', revision: 1, statusUpdates: 1 });
    expect((await db.participations.get(parts['Zürcher'].id))!.status).toBe('DNS');
  });

  it('Nr. 28: erneut gleiche Daten → keine neue Revision; Korrektur → Revision 2, alte bleibt', async () => {
    const save = async (txt: string) => saveRanking({ editionId, stageId: stage2, kind: 'gc', unit: 'zeit', resolved: await resolveRanking(editionId, parsePcsRanking(txt)!), applyStatus: false });
    expect((await save(GC)).revision).toBe(1);
    expect(await save(GC)).toMatchObject({ outcome: 'unveraendert', revision: 1 });
    expect(await save(GC.replace('0:06', '0:08'))).toMatchObject({ outcome: 'gespeichert', revision: 2 });
    const all = await db.standings.toArray();
    expect(all.map((s) => s.sourceRevision).sort()).toEqual([1, 2]);
    // Live-Ansicht nimmt die höchste Revision; Etappe ≠ Gesamtwertung
    const stages = await db.stages.toArray();
    const gc = resolveStanding('gc', stage2, stages, all);
    expect(gc.standing!.sourceRevision).toBe(2);
    expect(gc.label).toContain('PCS (manuell kopiert)');
    expect(resolveStanding('etappe', stage2, stages, all).standing).toBeNull();
    expect(resolveStanding('gc', stage1, stages, all).standing).toBeNull();
  });
});
