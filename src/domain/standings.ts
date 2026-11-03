import type { ClassificationKind, ClassificationStanding, Stage } from './types';
import { CLASSIFICATION_LABEL } from './types';

export interface ResolvedStanding {
  standing: ClassificationStanding | null;
  stage: Stage | null;
  /** true, wenn der Stand genau zur gewählten Etappe gehört */
  exact: boolean;
  label: string;
}

/**
 * Wählt den passenden Wertungsstand für die gewählte Etappe.
 * - Etappenergebnis: nur exakt diese Etappe.
 * - Wertungen: Stand nach dieser Etappe; fehlt er, der letzte vorherige Stand –
 *   mit ausdrücklicher Beschriftung "Stand nach Etappe X" (nie nur Datum aktualisieren).
 * - Je (Art, Etappe) gilt die höchste Quellrevision.
 */
export function resolveStanding(
  kind: ClassificationKind,
  selectedStageId: string,
  stages: Stage[],
  standings: ClassificationStanding[],
  timeFmt: (iso: string) => string = (s) => s,
): ResolvedStanding {
  const sorted = [...stages].filter((s) => !s.deleted).sort((a, b) => a.order - b.order);
  const sel = sorted.find((s) => s.id === selectedStageId);
  const title = CLASSIFICATION_LABEL[kind];
  if (!sel) return { standing: null, stage: null, exact: false, label: `${title}: keine Etappe gewählt` };
  const ofKind = standings.filter((s) => s.kind === kind && !s.deleted);
  const latestFor = (stageId: string) =>
    ofKind.filter((s) => s.stageId === stageId).sort((a, b) => b.sourceRevision - a.sourceRevision)[0] ?? null;

  if (kind === 'etappe') {
    const st = latestFor(sel.id);
    return {
      standing: st, stage: sel, exact: !!st,
      label: st ? `${title} ${sel.label} – ${st.source}, Abruf ${timeFmt(st.fetchedAt)}` : `${title} ${sel.label}: noch nicht vorhanden`,
    };
  }
  const candidates = sorted.filter((s) => s.order <= sel.order).reverse();
  for (const s of candidates) {
    const st = latestFor(s.id);
    if (st) {
      const exact = s.id === sel.id;
      const label = `${title} nach ${s.label} – ${st.source}, Abruf ${timeFmt(st.fetchedAt)}` +
        (exact ? '' : ` · Stand nach ${sel.label} noch nicht vorhanden`);
      return { standing: st, stage: s, exact, label };
    }
  }
  return { standing: null, stage: sel, exact: false, label: `${title}: bis ${sel.label} kein Stand vorhanden` };
}

/** Platzveränderung gegenüber einem ausdrücklich gewählten vorherigen Stand. */
export function rankDelta(riderId: string, current: ClassificationStanding | null, previous: ClassificationStanding | null): number | null {
  const a = current?.rows.find((r) => r.riderId === riderId)?.rank;
  const b = previous?.rows.find((r) => r.riderId === riderId)?.rank;
  if (a == null || b == null) return null;
  return b - a; // positiv = Plätze gewonnen
}
