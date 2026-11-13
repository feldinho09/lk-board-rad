/**
 * Fachliches Datenmodell (Bauplan Abschnitt 11).
 * Alle IDs werden lokal erzeugt (UUID v4) und bleiben beim Sync stabil.
 * `rev` zählt lokale Revisionen eines Datensatzes und dient später als Basisversion
 * für Sync-Operationen und für sichere Import-Rücknahme.
 */

export type ID = string;

export interface Versioned {
  id: ID;
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** Löschmarkierung (Tombstone) – Datensätze werden für Sync nicht hart gelöscht. */
  deleted?: boolean;
}

export interface ExternalId {
  /** Namensraum, z. B. "pcs", "uci" */
  ns: string;
  value: string;
}

export interface Rider extends Versioned {
  firstName: string;
  lastName: string;
  displayName: string;
  aliases: string[];
  pronunciation?: string;
  nationality?: string; // ISO-3166 alpha-3 oder Freitext, wie importiert
  /** "YYYY" oder "YYYY-MM-DD"; unbekannt bleibt leer (nie erfinden). */
  birthDate?: string;
  birthPlace?: string;
  heightCm?: number;
  weightKg?: number;
  residence?: string;
  /** Ergebnisse (Top 10, je nach Quelle) aus einer Quelle; wird bei erneutem Abruf vollständig ersetzt */
  palmares?: PalmaresEntry[];
  palmaresSource?: string;
  /** Teamstationen (aus kopierter PCS-Seite; inkl. Vertragsjahre) */
  teamHistory?: { year: number; team: string; level?: string }[];
  /** Top-Ergebnisse laut PCS, auf Deutsch */
  topResults?: string[];
  careerWins?: number;
  family?: string[];
  riderType?: string;
  strengths?: string;
  bio?: string;
  /** Bis zu drei priorisierte Fakten für die Kurzansicht */
  keyFacts: string[];
  tags: string[];
  externalIds: ExternalId[];
  archived?: boolean;
  /** Nach Zusammenführung: Weiterleitung auf die überlebende ID */
  mergedInto?: ID;
  /** Normalisierte Suchschlüssel (ohne Akzente, klein) – Index */
  searchTokens: string[];
  lastVerifiedAt?: string;
  sources?: string;
}

export interface PalmaresEntry {
  year: number;
  rank: number;
  race: string;
  /** z. B. "General classification", "Stages 3, 6" – leer bei Eintagesrennen */
  detail?: string;
  nation?: string;
}

export interface Team extends Versioned {
  name: string;
  code?: string;
  externalIds: ExternalId[];
}

export interface RaceSeries extends Versioned {
  name: string;
}

export type EditionStatus = 'geplant' | 'laeuft' | 'beendet' | 'archiviert';
export type EditionFormat = 'eintages' | 'etappen';

export interface Edition extends Versioned {
  seriesId: ID;
  name: string;
  year: number;
  format: EditionFormat;
  startDate: string; // YYYY-MM-DD
  timezone: string; // IANA, z. B. Europe/Zurich
  category?: string;
  location?: string;
  status: EditionStatus;
  /** Startnummern-Eindeutigkeit: pro Rennen oder pro Kategorie */
  bibScope: 'rennen' | 'kategorie';
  /** Herkunft der Daten, z. B. "demo" für fiktive Daten */
  dataOrigin?: 'demo' | 'manuell' | 'pcs' | 'tissot';
  /** Verknüpfung mit Tissot Timing (Wettbewerbs-Kennung, z. B. "tdf2026") */
  tissot?: { id: string; code: string; year: number };
  notes?: string;
}

export type StageType = 'strasse' | 'prolog' | 'ezf' | 'mzf' | 'eintages';

export interface Stage extends Versioned {
  editionId: ID;
  /** Ausdrückliche Reihenfolge (Prolog = 0, Halbetappen 3a/3b = 3, 3.5 …) */
  order: number;
  label: string;
  date: string;
  type: StageType;
  start?: string;
  finish?: string;
  distanceKm?: number;
}

export type StartStatus = 'gemeldet' | 'aktiv' | 'DNS' | 'DNF' | 'DSQ' | 'OTL' | 'HD';

export const START_STATUS_LABEL: Record<StartStatus, string> = {
  gemeldet: 'Gemeldet',
  aktiv: 'Im Rennen',
  DNS: 'DNS – nicht gestartet',
  DNF: 'DNF – aufgegeben',
  DSQ: 'DSQ – disqualifiziert',
  OTL: 'OTL – außerhalb Karenzzeit',
  HD: 'HD – außerhalb Karenzzeit (hors délai)',
};

export interface Participation extends Versioned {
  editionId: ID;
  riderId: ID;
  /** Startnummer immer als Text (führende Nullen bleiben erhalten) */
  bib: string;
  category?: string;
  /** Team bei diesem Rennen – Momentaufnahme, ändert sich nicht mit dem Profil */
  teamName: string;
  teamId?: ID;
  status: StartStatus;
  statusStageId?: ID;
  favorite: boolean;
  /** Renn-spezifische Übersteuerungen (Schnellkorrektur im Rennkontext) */
  overrides: { pronunciation?: string; displayName?: string };
  raceNote?: string;
  /** Originalwerte des letzten Imports (nachvollziehbar) */
  importOriginal?: Record<string, string>;
}

export type ClassificationKind = 'etappe' | 'gc' | 'punkte' | 'berg' | 'nachwuchs' | 'team';

export const CLASSIFICATION_LABEL: Record<ClassificationKind, string> = {
  etappe: 'Etappenergebnis',
  gc: 'Gesamtwertung',
  punkte: 'Punktewertung',
  berg: 'Bergwertung',
  nachwuchs: 'Nachwuchswertung',
  team: 'Mannschaftswertung',
};

export type SourceStatus = 'vorlaeufig' | 'quelle_bestaetigt' | 'unbekannt';
export type Coverage = 'vollstaendig' | 'teilweise' | 'nicht_veroeffentlicht' | 'nicht_verfuegbar' | 'fehlgeschlagen';

export interface ClassificationRow {
  rank: number | null;
  riderId?: ID;
  teamName?: string; // bei Mannschaftswertung: Team statt Fahrer
  timeSec?: number | null;
  gapSec?: number | null;
  sameTimeAsPrevious?: boolean;
  points?: number | null;
  status?: StartStatus;
  /** Originalwert der Quelle, unverändert */
  sourceValue?: string;
  /** Name wie in der Quelle – auch wenn der Fahrer (noch) keinem Profil zugeordnet ist */
  name?: string;
  /** Platz im vorherigen Stand laut Quelle */
  prevRank?: number | null;
}

/**
 * Ein Wertungsstand: z. B. "Gesamtwertung nach Etappe 4".
 * Etappenergebnis und Wertung nach Etappe sind getrennte Datensätze.
 */
export interface ClassificationStanding extends Versioned {
  editionId: ID;
  kind: ClassificationKind;
  /** Bei kind=etappe: die Etappe; sonst: Stand NACH dieser Etappe */
  stageId: ID;
  isFinal: boolean;
  source: string; // "PCS", "manuell", "Demo (fiktiv)"
  fetchedAt: string;
  sourceRevision: number;
  sourceStatus: SourceStatus;
  coverage: Coverage;
  unit: 'zeit' | 'punkte';
  rows: ClassificationRow[];
  /** Inhalts-Prüfsumme: unveränderte Daten erzeugen keine neue Revision */
  contentHash?: string;
}

export interface Note extends Versioned {
  scope: 'rider' | 'participation' | 'edition';
  refId: ID;
  editionId?: ID;
  text: string;
  /** Geschichte bereits erzählt – gilt im Rennkontext editionId */
  toldInEditions: ID[];
  priority: boolean;
  private: boolean;
  /** Eigene Sammlungen im Live-Board: Statistiken bzw. Themen (Rennen gesamt oder je Etappe) */
  kind?: 'statistik' | 'thema';
  stageId?: ID;
}

export interface RaceEvent extends Versioned {
  editionId: ID;
  stageId?: ID;
  at: string; // ISO Tageszeit
  raceClockSec?: number;
  text: string;
  riderIds: ID[];
  source: string;
  confirmed: boolean;
}

export interface RaceGroup extends Versioned {
  editionId: ID;
  stageId?: ID;
  name: string;
  order: number;
  riderIds: ID[];
  /** Abstand zur Bezugsgruppe (Spitze) in Sekunden */
  gapSec?: number | null;
  measuredAt?: string;
  source?: string;
}

export interface ImportRun extends Versioned {
  editionId: ID;
  sourceName: string;
  mappingName?: string;
  summary: { neu: number; zugeordnet: number; geaendert: number; unveraendert: number; zurueckgestellt: number; fehlerhaft: number; nichtEnthalten: number };
  createdRiderIds: ID[];
  createdParticipationIds: ID[];
  /** Vorherige Fassung geänderter Teilnahmen für Rücknahme */
  updatedParticipations: { id: ID; before: Participation; revAfter: number }[];
  deferredRows: { row: Record<string, string>; reason: string }[];
  undone?: boolean;
}

export interface SavedMapping extends Versioned {
  name: string;
  mapping: Record<string, string>; // Zielfeld -> Quellspalte
}

/** Dauerhafte Versandwarteschlange (Outbox) für späteren Sync. */
export interface ChangeOp {
  opId: ID;
  entity: string;
  entityId: ID;
  op: 'put' | 'delete';
  baseRev: number;
  rev: number;
  at: string;
  deviceId: string;
  synced: 0 | 1;
}

export interface RestorePoint {
  id: ID;
  createdAt: string;
  reason: string;
  sizeBytes: number;
  data: Uint8Array; // ZIP wie Exportarchiv
  protected?: boolean;
}

export interface Setting {
  key: string;
  value: unknown;
}
