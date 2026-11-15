/**
 * Rad Command Center – Datenmodell.
 *
 * Das Center ist die Sammelstelle für alles Eigene: Fahrerprofile, Renn- und Etappenwissen,
 * Statistiken, Geschichten, Hintergründe, Notizen und Zitate. Startliste und Fahrerinfos
 * kommen per Kopieren aus ProCyclingStats (kein automatischer Abruf).
 *
 * Formatierte Texte (Typ RichText) sind bereinigtes HTML (siehe domain/richtext.ts).
 * Eine Zeile, die mit „★“ beginnt, steht in LIVE zuoberst.
 */

export type RichText = string;

export interface Versioned {
  id: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

/** Abschnitte eines Fahrerprofils – in dieser Reihenfolge angezeigt („Aktuell“ zuoberst). */
export const RIDER_SECTIONS = [
  { key: 'aktuell', label: 'Aktuell', hint: 'Form, Verletzungen, Ziele, News – das Neueste zuoberst' },
  { key: 'erfolge', label: 'Erfolge', hint: 'Siege, Titel, wichtigste Resultate' },
  { key: 'person', label: 'Person', hint: 'Werdegang, Teams, Fahrertyp, Stärken' },
  { key: 'persoenlich', label: 'Persönliches', hint: 'Familie, Herkunft, Anekdoten, Hobbys' },
  { key: 'allgemein', label: 'Allgemein', hint: 'Alles Weitere' },
  { key: 'zitate', label: 'Zitate', hint: 'Mit Quelle und Datum' },
] as const;
export type RiderSectionKey = (typeof RIDER_SECTIONS)[number]['key'];

export interface Rider extends Versioned {
  firstName: string;
  lastName: string;
  /** Anzeigename, z. B. „Tadej Pogačar“ */
  name: string;
  nation?: string;
  team?: string;
  birthDate?: string; // JJJJ-MM-TT oder JJJJ
  birthPlace?: string;
  residence?: string;
  heightCm?: number;
  weightKg?: number;
  riderType?: string;
  /** Aussprache für den Kommentar */
  pronunciation?: string;
  /** PCS-Seitenkennung, z. B. „tadej-pogacar“ (für den PCS-Knopf) */
  pcsSlug?: string;
  sections: Partial<Record<RiderSectionKey, RichText>>;
  /** Wann wurde „Aktuell“ zuletzt geändert (für Hinweis „seit x Tagen nicht aktualisiert“) */
  aktuellAt?: string;
  searchKey: string;
}

export const RACE_SECTIONS = [
  { key: 'aktuell', label: 'Aktuell', hint: 'Ausgangslage, News, Wetter, Ausfälle' },
  { key: 'favoriten', label: 'Favoriten', hint: 'Anwärter, Formstand, Duelle' },
  { key: 'strecke', label: 'Strecke', hint: 'Profil, Schlüsselstellen, Besonderheiten' },
  { key: 'geschichte', label: 'Geschichte', hint: 'Siegerliste, Rekorde, legendäre Austragungen' },
  { key: 'statistik', label: 'Statistik', hint: 'Zahlen und Serien' },
  { key: 'zitate', label: 'Zitate', hint: 'Mit Quelle und Datum' },
] as const;
export type RaceSectionKey = (typeof RACE_SECTIONS)[number]['key'];

export interface Race extends Versioned {
  name: string;
  year: number;
  kind: 'rundfahrt' | 'eintages';
  startDate?: string;
  endDate?: string;
  /** Link auf die PCS-Rennseite, z. B. https://www.procyclingstats.com/race/tour-de-france/2026 */
  pcsUrl?: string;
  sections: Partial<Record<RaceSectionKey, RichText>>;
}

export interface Stage extends Versioned {
  raceId: string;
  /** 0 = Prolog; Eintagesrennen haben eine einzige „Etappe“ 1 */
  number: number;
  date?: string;
  start?: string;
  finish?: string;
  distanceKm?: number;
  profile?: 'flach' | 'huegelig' | 'bergankunft' | 'berg' | 'ezf' | 'mzf' | 'kopfsteinpflaster' | 'sonstiges';
  notes?: RichText;
  /** Geographisches: Landschaft, Region, Verlauf */
  geoNotes?: RichText;
  /** SRF-Programm: Sendungstitel, Sender, Sendezeit */
  broadcast?: { title?: string; channel?: string; start?: string; end?: string; notes?: string };
  /** LIVE: Rennsituation (Spitze, Verfolger, Feld …) */
  situation?: { groups: SituationGroup[]; at?: string };
  /** Klassemente NACH dieser Etappe (eingefügt) */
  standings?: Partial<Record<StandingKind, StandingRow[]>>;
}

export interface SituationGroup {
  id: string;
  label: string;
  /** Abstand, frei: „+2:35“, „1'40“ */
  gap?: string;
  /** Startnummern */
  bibs: string[];
  note?: string;
}

export const STANDING_KINDS = [
  { key: 'etappe', label: 'Etappe', short: 'Etappe' },
  { key: 'gc', label: 'Gesamt', short: 'Gesamt' },
  { key: 'punkte', label: 'Punkte', short: 'Punkte' },
  { key: 'berg', label: 'Berg', short: 'Berg' },
  { key: 'nachwuchs', label: 'Nachwuchs', short: 'Nachw.' },
] as const;
export type StandingKind = (typeof STANDING_KINDS)[number]['key'];
export interface StandingRow {
  rank: number;
  name: string;
  bib?: string;
  team?: string;
  /** Rückstand, Zeit oder Punkte, wie eingefügt */
  value?: string;
}

export const STATUS_LABEL = { aktiv: 'im Rennen', dns: 'nicht gestartet', dnf: 'aufgegeben', otl: 'Zeitlimit', dsq: 'disqualifiziert' } as const;
export type EntryStatus = keyof typeof STATUS_LABEL;

/** Startlisten-Eintrag: jeder Fahrer im Feld; mit Profil verknüpft, wenn eines existiert. */
export interface Entry extends Versioned {
  raceId: string;
  bib?: string;
  name: string;
  team?: string;
  riderId?: string;
  status: EntryStatus;
  /** Etappe, ab der der Status gilt */
  statusStage?: number;
  /** Rennbezogene Notiz zum Fahrer (z. B. Rolle im Team bei diesem Rennen) */
  note?: RichText;
}

export const TOPIC_KINDS = [
  { key: 'statistik', label: 'Statistik' },
  { key: 'geschichte', label: 'Geschichte' },
  { key: 'hintergrund', label: 'Hintergrund' },
  { key: 'notiz', label: 'Notiz' },
  { key: 'zitat', label: 'Zitat' },
] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number]['key'];

/** Eintrag im Themen-Center: Statistik, Geschichte, Hintergrund, Notiz oder Zitat. */
export interface Topic extends Versioned {
  kind: TopicKind;
  title: string;
  body: RichText;
  /** Rennen, Etappe und Fahrer, zu denen der Eintrag gehört (alles optional) */
  raceId?: string;
  stageNumber?: number;
  riderIds: string[];
  /** Quelle / Urheber (bei Zitaten: wer, wann, wo) */
  source?: string;
  /** In LIVE hervorheben */
  starred?: boolean;
}

/** Strecke einer Etappe (aus GPX), gleichmässig ausgedünnt; km ab Start */
export interface Route extends Versioned {
  raceId: string;
  stageNumber: number;
  /** [Breite, Länge, Höhe m, km ab Start] */
  points: [number, number, number | null, number][];
  lengthKm: number;
  fileName?: string;
  /** Sprache der Wikipedia-Abfrage */
  wikiLang?: string;
}

export const GEO_KINDS = [
  { key: 'ort', label: 'Ort' },
  { key: 'sehenswuerdigkeit', label: 'Sehenswürdigkeit' },
  { key: 'natur', label: 'Natur (Berg, See, Fluss)' },
  { key: 'anstieg', label: 'Anstieg' },
  { key: 'sprint', label: 'Sprint / Bonus' },
  { key: 'verpflegung', label: 'Verpflegung' },
  { key: 'sonstiges', label: 'Sonstiges' },
] as const;
export type GeoKind = (typeof GEO_KINDS)[number]['key'];

/** Punkt an der Strecke: Ort, Sehenswürdigkeit, Anstieg … mit km ab Start */
export interface GeoPoint extends Versioned {
  raceId: string;
  stageNumber: number;
  kind: GeoKind;
  name: string;
  /** km ab Start; km to go = Etappenlänge − km */
  km: number;
  /** Abstand zur Strecke in m (bei Wikipedia-Funden) */
  offsetM?: number;
  lat?: number;
  lon?: number;
  wikiLang?: string;
  wikiTitle?: string;
  description?: string;
  summary?: string;
  notes?: RichText;
  starred?: boolean;
  /** Anstieg: Länge (km), mittlere Steigung (%), Kategorie; km = Passhöhe/Gipfel */
  climbLengthKm?: number;
  climbGradient?: number;
  climbCategory?: 'HC' | '1' | '2' | '3' | '4';
  /** ausgeblendet (bleibt erhalten, damit ein neuer Abruf ihn nicht wieder einfügt) */
  hidden?: boolean;
  source: 'wikipedia' | 'eigen';
}

/** Sendeablauf (SRF-Programm) je Etappe */
export interface RundownRow extends Versioned {
  raceId: string;
  stageNumber: number;
  order: number;
  /** Uhrzeit „14:05“ */
  time?: string;
  /** Dauer in Minuten */
  durationMin?: number;
  /** Element, z. B. „Opener“, „Live Strecke“, „Interview“ */
  item: string;
  content?: string;
  who?: string;
  done?: boolean;
}

export interface RestorePoint {
  id: string;
  createdAt: string;
  reason: string;
  protected?: boolean;
  /** komprimierte Sicherung */
  data: Uint8Array;
  sizeBytes: number;
}

export interface Setting {
  key: string;
  value: unknown;
}
