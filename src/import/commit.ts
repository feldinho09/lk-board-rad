import { db, mutate, newRecord, alive } from '../db/db';
import type { ImportRun, Participation, Rider } from '../domain/types';
import { riderSearchTokens } from '../domain/text';
import { createRestorePoint } from '../backup/archive';
import { matchRows, validateFinalState, type Mapping, type MatchResult, type RowDecision } from './matching';

export async function prepareMatch(editionId: string, rows: Record<string, string>[], mapping: Mapping): Promise<MatchResult> {
  const edition = await db.editions.get(editionId);
  if (!edition) throw new Error('Rennen nicht gefunden');
  const [riders, parts] = await Promise.all([db.riders.toArray(), db.participations.where('editionId').equals(editionId).toArray()]);
  return matchRows(rows, mapping, { riders: alive(riders), editionParticipations: alive(parts), bibScope: edition.bibScope });
}

/**
 * Atomarer Importlauf: neue Fahrer, neue/geänderte Teilnahmen und Importprotokoll
 * in EINER Transaktion. Unveränderte Zeilen erzeugen keine Schreibvorgänge.
 * Stammdaten bestehender Fahrer werden NICHT verändert (redaktionelle Inhalte geschützt).
 */
export async function commitImport(
  editionId: string,
  sourceName: string,
  result: MatchResult,
  decisions: RowDecision[],
): Promise<ImportRun> {
  const edition = await db.editions.get(editionId);
  if (!edition) throw new Error('Rennen nicht gefunden');
  const existing = alive(await db.participations.where('editionId').equals(editionId).toArray());
  const errors = validateFinalState(result.rows, decisions, existing, edition.bibScope);
  if (errors.length) throw new Error(errors.join('\n'));

  await createRestorePoint(`Vor Startlistenimport ${sourceName}`);

  return mutate(['riders', 'participations', 'importRuns'], async (w) => {
    const run = newRecord<Omit<ImportRun, keyof import('../domain/types').Versioned>>({
      editionId, sourceName,
      summary: { neu: 0, zugeordnet: 0, geaendert: 0, unveraendert: 0, zurueckgestellt: 0, fehlerhaft: 0, nichtEnthalten: result.notInFile.length },
      createdRiderIds: [], createdParticipationIds: [], updatedParticipations: [], deferredRows: [],
    }) as ImportRun;

    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      const d = decisions[i];
      if (r.status === 'fehlerhaft') {
        run.summary.fehlerhaft++;
        run.deferredRows.push({ row: r.original, reason: r.problems.join('; ') || 'fehlerhaft' });
        continue;
      }
      if (d.action === 'zurueckstellen') {
        run.summary.zurueckgestellt++;
        run.deferredRows.push({ row: r.original, reason: r.problems.join('; ') || 'zurückgestellt' });
        continue;
      }
      let riderId = d.riderId;
      if (riderId === 'neu') {
        const n = r.norm;
        const rider = newRecord<Omit<Rider, keyof import('../domain/types').Versioned>>({
          firstName: n.firstName, lastName: n.lastName, displayName: n.displayName,
          aliases: [], nationality: n.nationality || undefined, birthDate: n.birthDate || undefined,
          keyFacts: [], tags: [], externalIds: n.externalIds,
          searchTokens: riderSearchTokens(n.firstName, n.lastName, n.displayName, []),
          sources: `Startlistenimport ${sourceName}`,
        }) as Rider;
        await w.put('riders', rider);
        riderId = rider.id;
        run.createdRiderIds.push(rider.id);
        run.summary.neu++;
      } else run.summary.zugeordnet++;

      const ex = existing.find((p) => p.riderId === riderId);
      if (ex) {
        const next: Participation = {
          ...ex,
          bib: r.norm.bib || ex.bib,
          teamName: r.norm.team || ex.teamName,
          category: r.norm.category || ex.category,
        };
        const changed = next.bib !== ex.bib || next.teamName !== ex.teamName || (next.category ?? '') !== (ex.category ?? '');
        if (!changed) {
          run.summary.unveraendert++;
          continue;
        }
        next.importOriginal = r.original;
        const saved = await w.put('participations', next);
        run.updatedParticipations.push({ id: ex.id, before: ex, revAfter: saved.rev });
        run.summary.geaendert++;
      } else {
        const p = newRecord<Omit<Participation, keyof import('../domain/types').Versioned>>({
          editionId, riderId, bib: r.norm.bib, category: r.norm.category || undefined, teamName: r.norm.team,
          status: 'gemeldet', favorite: false, overrides: {}, importOriginal: r.original,
        }) as Participation;
        await w.put('participations', p);
        run.createdParticipationIds.push(p.id);
      }
    }
    return w.put('importRuns', run);
  });
}

/**
 * Rücknahme eines Importlaufs. Datensätze, die seit dem Import weiter bearbeitet
 * wurden, werden NICHT überschrieben, sondern als Konflikt gemeldet.
 */
export async function undoImport(runId: string): Promise<{ undone: number; skipped: string[] }> {
  const run = await db.importRuns.get(runId);
  if (!run || run.undone) throw new Error('Importlauf nicht gefunden oder bereits zurückgenommen');
  await createRestorePoint(`Vor Rücknahme Import ${run.sourceName}`);
  const skipped: string[] = [];
  let undone = 0;
  await mutate(['riders', 'participations', 'importRuns'], async (w) => {
    for (const pid of run.createdParticipationIds) {
      const p = await db.participations.get(pid);
      if (!p || p.deleted) continue;
      if (p.rev > 1) { skipped.push(`Teilnahme Nr. ${p.bib} wurde nachträglich bearbeitet`); continue; }
      await w.remove('participations', pid);
      undone++;
    }
    for (const u of run.updatedParticipations) {
      const p = await db.participations.get(u.id);
      if (!p) continue;
      if (p.rev !== u.revAfter) { skipped.push(`Teilnahme Nr. ${p.bib} wurde nachträglich bearbeitet`); continue; }
      await w.put('participations', { ...u.before });
      undone++;
    }
    for (const rid of run.createdRiderIds) {
      const r = await db.riders.get(rid);
      if (!r || r.deleted) continue;
      const others = alive(await db.participations.where('riderId').equals(rid).toArray());
      if (others.length > 0 || r.rev > 1) { skipped.push(`Fahrer ${r.displayName} wird inzwischen verwendet oder wurde bearbeitet`); continue; }
      await w.remove('riders', rid);
      undone++;
    }
    await w.put('importRuns', { ...run, undone: true });
  });
  return { undone, skipped };
}
