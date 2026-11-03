/**
 * Demo-Rundfahrt mit DEUTLICH FIKTIVEN Daten (Bauplan 9: Demo-Rennen).
 * Zeigt: Prolog, Einzelzeitfahren, Etappenergebnis ≠ Gesamtwertung nach Etappe,
 * zeitversetzt fehlende Wertungen (GC nach Etappe 4 fehlt noch), DNF/DNS,
 * gleiche Zeit, Mannschaftswertung mit Teams statt Fahrern, namensgleiche Fahrer.
 */
import { mutate, newRecord } from '../db/db';
import type {
  ClassificationKind, ClassificationRow, ClassificationStanding, Edition, Participation, RaceSeries,
  Rider, Stage, StartStatus, Note, Versioned,
} from '../domain/types';
import { riderSearchTokens } from '../domain/text';

type F<T> = Omit<T, keyof Versioned>;

const TEAMS = ['Alpenfirn Racing', 'Équipe Lumière', 'Nordlys Cycling', 'Squadra Fiume'];

const RIDERS: [string, string, string, string, string, string, string[]][] = [
  // first, last, nat, birth, pronunciation, type, keyFacts
  ['Jonas', 'Brändli', 'SUI', '1998-04-12', 'BREND-li', 'Rundfahrer', ['Fiktiv: Zweiter der Demo-Rundfahrt im Vorjahr', 'Stark im Zeitfahren']],
  ['Lars', 'Øvrebø', 'NOR', '2001-09-03', 'ÖV-re-bö', 'Sprinter', ['Fiktiv: drei Etappensiege in der Saison']],
  ['Mateo', 'Ibáñez', 'ESP', '2003', 'i-BA-njes', 'Kletterer', ['Fiktiv: jüngster Fahrer im Feld']],
  ['Tomasz', 'Wójcik', 'POL', '1996-01-21', 'WUI-tschik', 'Helfer', []],
  ['Pierre-Luc', 'Dufaux', 'FRA', '1999-11-30', 'dü-FO', 'Puncheur', ['Fiktiv: gewann Etappe 2 im Sprint einer kleinen Gruppe']],
  ['Luca', 'Bianchi', 'ITA', '1997', 'BJAN-ki', 'Zeitfahrer', ['Fiktiv: namensgleich mit einem jüngeren Fahrer – Jahrgang 1997']],
  ['Luca', 'Bianchi', 'ITA', '2004', 'BJAN-ki', 'Sprinter', ['Fiktiv: namensgleich – Jahrgang 2004']],
  ['Søren', 'Kjærgaard', 'DEN', '2000-06-14', 'SÖ-ren KJÄR-gor', 'Rouleur', []],
  ['Ethan', 'McAllister', 'GBR', '2002-02-02', 'mäk-AL-is-ter', 'Rundfahrer', ['Fiktiv: Träger des Nachwuchstrikots']],
  ['Nicolás', 'Peña', 'COL', '1998-08-08', 'PE-nja', 'Kletterer', ['Fiktiv: Bergkönig nach Etappe 3']],
  ['Reto', 'Zürcher', 'SUI', '1995-03-19', 'TSÜR-cher', 'Helfer', []],
  ['Joris', 'van den Broeck', 'BEL', '1997-12-01', 'van den BRUK', 'Klassiker', []],
  ['Kaito', 'Yamamoto', 'JPN', '2001-05-25', 'ka-I-to', 'Kletterer', []],
  ['Marek', 'Dvořák', 'CZE', '1999-10-10', 'DWOR-schak', 'Rouleur', []],
  ['Aleksander', 'Nowak', 'POL', '2000-01-01', 'NO-wak', 'Sprinter', []],
  ['Felix', 'Großmann', 'GER', '1996-07-07', 'GROS-man', 'Zeitfahrer', []],
];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function seedDemo(): Promise<string> {
  const rand = rng(42);
  return mutate(['series', 'editions', 'stages', 'riders', 'participations', 'standings', 'notes'], async (w) => {
    const series = newRecord<F<RaceSeries>>({ name: 'Rundfahrt Fiktivia (DEMO)' }) as RaceSeries;
    await w.put('series', series);
    const edition = newRecord<F<Edition>>({
      seriesId: series.id, name: 'DEMO – Rundfahrt Fiktivia 2026', year: 2026, format: 'etappen',
      startDate: '2026-06-10', timezone: 'Europe/Zurich', category: '2.1 (fiktiv)', location: 'Fiktivia',
      status: 'laeuft', bibScope: 'rennen', dataOrigin: 'demo',
      notes: 'Alle Personen, Teams und Resultate sind frei erfunden und dienen nur zum Üben.',
    }) as Edition;
    await w.put('editions', edition);

    const stageDefs: [number, string, string, Stage['type'], number][] = [
      [0, 'Prolog', '2026-06-10', 'prolog', 4.2],
      [1, 'Etappe 1', '2026-06-11', 'strasse', 168],
      [2, 'Etappe 2', '2026-06-12', 'strasse', 185],
      [3, 'Etappe 3 (EZF)', '2026-06-13', 'ezf', 24.5],
      [4, 'Etappe 4', '2026-06-14', 'strasse', 142],
    ];
    const stages: Stage[] = [];
    for (const [order, label, date, type, km] of stageDefs) {
      const s = newRecord<F<Stage>>({ editionId: edition.id, order, label, date, type, distanceKm: km }) as Stage;
      await w.put('stages', s);
      stages.push(s);
    }

    const riders: Rider[] = [];
    const parts: Participation[] = [];
    for (let i = 0; i < RIDERS.length; i++) {
      const [first, last, nat, birth, pron, type, facts] = RIDERS[i];
      const r = newRecord<F<Rider>>({
        firstName: first, lastName: last, displayName: `${first} ${last}`, aliases: [],
        pronunciation: pron, nationality: nat, birthDate: birth, riderType: type, keyFacts: facts,
        tags: ['demo'], externalIds: [], searchTokens: riderSearchTokens(first, last, `${first} ${last}`, []),
        sources: 'Demo (fiktiv)',
      }) as Rider;
      await w.put('riders', r);
      riders.push(r);
      const team = TEAMS[i % TEAMS.length];
      const bib = String((i % 4 + 1) * 10 + Math.floor(i / 4) + 1); // 11, 21, 31, 41, 12, …
      const p = newRecord<F<Participation>>({
        editionId: edition.id, riderId: r.id, bib, teamName: team, status: 'aktiv',
        favorite: i < 3, overrides: {},
      }) as Participation;
      parts.push(p);
    }
    // Ausfälle: Wójcik DNF in Etappe 2, Zürcher DNS in Etappe 4
    const dnf = parts[3];
    dnf.status = 'DNF'; dnf.statusStageId = stages[2].id;
    const dns = parts[10];
    dns.status = 'DNS'; dns.statusStageId = stages[4].id;
    for (const p of parts) await w.put('participations', p);

    // Etappenzeiten erzeugen
    const outAfter = (p: Participation, stageIdx: number) =>
      (p === dnf && stageIdx >= 2) || (p === dns && stageIdx >= 4);
    const stageTimes: Map<string, number | null>[] = [];
    const base = [300, 3.9 * 3600, 4.4 * 3600, 1740, 3.4 * 3600];
    stages.forEach((s, si) => {
      const m = new Map<string, number | null>();
      parts.forEach((p, pi) => {
        if (outAfter(p, si)) { m.set(p.riderId, null); return; }
        const tt = s.type === 'prolog' || s.type === 'ezf';
        let t = base[si] + (tt ? rand() * (si === 0 ? 25 : 120) : (rand() < 0.6 ? 0 : Math.floor(rand() * 8) * 15));
        if (!tt && pi === 4 && si === 2) t = base[si] - 2; // Dufaux gewinnt Etappe 2
        m.set(p.riderId, Math.round(t));
      });
      stageTimes.push(m);
    });

    const fetchedAt = (si: number, min: number) => `${stages[si].date}T${String(15 + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00.000Z`;

    const standing = async (kind: ClassificationKind, si: number, rows: ClassificationRow[], unit: 'zeit' | 'punkte', min: number) => {
      const st = newRecord<F<ClassificationStanding>>({
        editionId: edition.id, kind, stageId: stages[si].id, isFinal: false, source: 'Demo (fiktiv)',
        fetchedAt: fetchedAt(si, min), sourceRevision: 1, sourceStatus: 'vorlaeufig', coverage: 'vollstaendig', unit, rows,
      }) as ClassificationStanding;
      await w.put('standings', st);
    };

    const timeRows = (times: Map<string, number | null>): ClassificationRow[] => {
      const finished = [...times.entries()].filter(([, t]) => t != null) as [string, number][];
      finished.sort((a, b) => a[1] - b[1]);
      const best = finished[0]?.[1] ?? 0;
      const rows: ClassificationRow[] = finished.map(([riderId, t], i) => ({
        rank: i + 1, riderId, timeSec: t, gapSec: t - best,
        sameTimeAsPrevious: i > 0 && t === finished[i - 1][1],
      }));
      for (const [riderId, t] of times) if (t == null) {
        const p = parts.find((x) => x.riderId === riderId)!;
        rows.push({ rank: null, riderId, timeSec: null, gapSec: null, status: p.status as StartStatus });
      }
      return rows;
    };

    const gcTotals = new Map<string, number | null>();
    const points = new Map<string, number>();
    const kom = new Map<string, number>();
    for (let si = 0; si < stages.length; si++) {
      await standing('etappe', si, timeRows(stageTimes[si]), 'zeit', 30);
      for (const [rid, t] of stageTimes[si]) {
        const prev = gcTotals.get(rid);
        gcTotals.set(rid, t == null || prev === null ? null : (prev ?? 0) + t);
      }
      const order = timeRows(stageTimes[si]).filter((r) => r.rank != null);
      const pts = [25, 20, 16, 14, 12, 10, 9, 8, 7, 6];
      order.slice(0, 10).forEach((r, i) => points.set(r.riderId!, (points.get(r.riderId!) ?? 0) + pts[i]));
      if (si >= 1 && si <= 3) {
        const climbers = [9, 2, 12, 0, 6];
        climbers.forEach((ci, k) => kom.set(parts[ci].riderId, (kom.get(parts[ci].riderId) ?? 0) + (10 - k * 2) * (si === 2 ? 2 : 1)));
      }
      // Gesamtwertung nach Etappe 4 ist "noch nicht veröffentlicht" → fehlt absichtlich
      if (si <= 3) await standing('gc', si, timeRows(gcTotals), 'zeit', 55);
      const pointRows = (m: Map<string, number>) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).map(([riderId, p], i) => ({ rank: i + 1, riderId, points: p }));
      await standing('punkte', si, pointRows(points), 'punkte', 70);
      if (si >= 1 && si <= 3) await standing('berg', si, pointRows(kom), 'punkte', 75);
      if (si === 2 || si === 3) {
        const young = timeRows(gcTotals).filter((r) => {
          const rd = riders.find((x) => x.id === r.riderId)!;
          return Number((rd.birthDate ?? '0').slice(0, 4)) >= 2001 && r.rank != null;
        }).map((r, i, arr) => ({ ...r, rank: i + 1, gapSec: (r.timeSec ?? 0) - (arr[0].timeSec ?? 0) }));
        await standing('nachwuchs', si, young, 'zeit', 80);
      }
      if (si === 3) {
        const teamTotals = TEAMS.map((team) => {
          const ts = parts.filter((p) => p.teamName === team).map((p) => gcTotals.get(p.riderId)).filter((t): t is number => t != null).sort((a, b) => a - b).slice(0, 3);
          return { team, t: ts.length === 3 ? ts.reduce((a, b) => a + b, 0) : null };
        }).filter((x) => x.t != null).sort((a, b) => a.t! - b.t!);
        await standing('team', si, teamTotals.map((x, i) => ({ rank: i + 1, teamName: x.team, timeSec: x.t, gapSec: x.t! - teamTotals[0].t! })), 'zeit', 85);
      }
    }

    const note = newRecord<F<Note>>({
      scope: 'rider', refId: riders[0].id, text: 'Fiktiv: Wohnt am Fuß des Schlussanstiegs von Etappe 4 – kennt jede Kurve.',
      toldInEditions: [], priority: true, private: false,
    }) as Note;
    await w.put('notes', note);
    return edition.id;
  });
}
