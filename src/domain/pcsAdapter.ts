/**
 * Adaptervertrag für ProCyclingStats (Bauplan 7a).
 *
 * STATUS: EXTERNE BLOCKADE. Es liegt kein autorisierter PCS-Datenzugang vor.
 * Es werden bewusst KEINE Endpunkte, URLs oder Feldnamen von PCS angenommen.
 * Die echte Implementierung läuft später auf dem Import-/Sync-Server
 * (Zugangsdaten gehören nicht in den Browser). Der Browser empfängt nur
 * bereits normalisierte Datensätze in den hier definierten Formen.
 */
import type { ClassificationKind, Coverage, SourceStatus } from './types';

export interface SourceRef {
  ns: 'pcs';
  /** Stabile Kennung, wie sie der autorisierte Zugang liefert (noch unbekannt) */
  value: string;
  canonicalUrl?: string;
}

export interface NormalizedStage {
  source: SourceRef;
  order: number;
  label: string;
  date: string;
  type: 'strasse' | 'prolog' | 'ezf' | 'mzf' | 'eintages';
}

export interface NormalizedEdition {
  source: SourceRef;
  seriesName: string;
  year: number;
  name: string;
  stages: NormalizedStage[];
  /** Welche Wertungen die Quelle für dieses Rennen anbietet */
  offeredClassifications: ClassificationKind[];
}

export interface NormalizedStartlistEntry {
  rider: SourceRef & { displayName: string; nationality?: string; birthDate?: string };
  bib: string;
  teamName: string;
  team?: SourceRef;
}

export interface NormalizedClassification {
  edition: SourceRef;
  stage: SourceRef;
  kind: ClassificationKind;
  isFinal: boolean;
  fetchedAt: string;
  /** Inhaltlicher Hash – unveränderte Daten erzeugen keine neue Revision */
  contentHash: string;
  sourceStatus: SourceStatus;
  coverage: Coverage;
  rows: {
    rank: number | null;
    rider?: SourceRef;
    team?: SourceRef & { name: string };
    timeSec?: number | null;
    gapSec?: number | null;
    points?: number | null;
    status?: string;
    sourceValue: string;
  }[];
}

export type FetchOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_published' | 'not_available' | 'rate_limited' | 'auth' | 'parse_error' | 'network'; retryAfterSec?: number; detail?: string };

export interface PcsSource {
  readonly name: string;
  readonly authorized: boolean;
  getEdition(ref: SourceRef): Promise<FetchOutcome<NormalizedEdition>>;
  getStartlist(edition: SourceRef, stage?: SourceRef): Promise<FetchOutcome<NormalizedStartlistEntry[]>>;
  getClassification(edition: SourceRef, stage: SourceRef, kind: ClassificationKind): Promise<FetchOutcome<NormalizedClassification>>;
}

/** Platzhalter, solange kein Zugang existiert – liefert ehrlich "nicht verfügbar". */
export const UNAVAILABLE_PCS: PcsSource = {
  name: 'ProCyclingStats (kein autorisierter Zugang)',
  authorized: false,
  async getEdition() { return { ok: false, reason: 'auth', detail: 'Kein autorisierter PCS-Zugang eingerichtet' }; },
  async getStartlist() { return { ok: false, reason: 'auth', detail: 'Kein autorisierter PCS-Zugang eingerichtet' }; },
  async getClassification() { return { ok: false, reason: 'auth', detail: 'Kein autorisierter PCS-Zugang eingerichtet' }; },
};

/**
 * Regel für Revisionen: Eine neue Quellfassung ersetzt einen bestehenden Stand nur,
 * wenn sie gültig ist UND sich inhaltlich unterscheidet. Fehler oder leere Antworten
 * löschen nie bestehende Resultate (Abnahme Nr. 30).
 */
export function shouldStoreRevision(
  existingHash: string | null,
  incoming: FetchOutcome<NormalizedClassification>,
): 'store' | 'unchanged' | 'keep_existing' {
  if (!incoming.ok) return 'keep_existing';
  if (incoming.data.rows.length === 0 && existingHash) return 'keep_existing';
  if (existingHash === incoming.data.contentHash) return 'unchanged';
  return 'store';
}
