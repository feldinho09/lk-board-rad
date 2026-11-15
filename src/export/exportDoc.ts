/**
 * PDF-Export: wählbare Inhalte eines Rennens (Rennabschnitte, Etappen, Startliste,
 * Fahrerprofile, Themen) als PDF. Alles entsteht lokal im Browser, auch offline.
 */
import { db, alive } from '../db/db';
import { RACE_SECTIONS, RIDER_SECTIONS, STATUS_LABEL, TOPIC_KINDS, type Entry, type Race, type RaceSectionKey, type Rider, type RiderSectionKey, type Stage, type Topic } from '../domain/types';
import { ageOn, byBib } from '../domain/center';
import { richToPdf, type PdfBlock } from './richToPdf';

export interface ExportOptions {
  raceSections: RaceSectionKey[];
  stages: boolean;
  /** nur die gewählte Etappe statt aller */
  onlyStage?: number;
  startlist: boolean;
  riders: 'keine' | 'profile' | 'auswahl';
  riderIds: string[];
  riderFacts: boolean;
  riderSections: RiderSectionKey[];
  topics: 'keine' | 'stern' | 'alle';
  fontScale: 'normal' | 'gross';
}

export const DEFAULT_EXPORT: ExportOptions = {
  raceSections: ['aktuell', 'favoriten', 'strecke'],
  stages: true,
  startlist: true,
  riders: 'profile',
  riderIds: [],
  riderFacts: true,
  riderSections: ['aktuell', 'erfolge', 'person', 'persoenlich'],
  topics: 'stern',
  fontScale: 'normal',
};

export interface ExportData { race: Race; stages: Stage[]; entries: Entry[]; riders: Map<string, Rider>; topics: Topic[] }

export async function collectExportData(raceId: string): Promise<ExportData> {
  const race = await db.races.get(raceId);
  if (!race) throw new Error('Rennen nicht gefunden');
  const stages = alive(await db.stages.where('raceId').equals(raceId).toArray()).sort((a, b) => a.number - b.number);
  const entries = alive(await db.entries.where('raceId').equals(raceId).toArray()).sort(byBib);
  const riders = new Map(alive(await db.riders.toArray()).map((r) => [r.id, r]));
  const topics = alive(await db.topics.toArray());
  return { race, stages, entries, riders, topics };
}

/** Stern-Zeichen gibt es in der PDF-Schrift nicht → „»“ */
const fix = (blocks: PdfBlock[]): PdfBlock[] => JSON.parse(JSON.stringify(blocks).replace(/★\s?/g, '» '));
const rich = (h?: string) => fix(richToPdf(h));
const hasText = (h?: string) => !!(h ?? '').replace(/<[^>]*>|&nbsp;/g, '').trim();

export function buildExportDoc(d: ExportData, o: ExportOptions, now = new Date()): Record<string, unknown> {
  const content: unknown[] = [];
  const day = d.race.startDate ?? now.toISOString().slice(0, 10);
  content.push({ text: `${d.race.name} ${d.race.year}`, style: 'title' });
  content.push({ text: `Rad Command Center · Stand ${now.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })}`, style: 'meta', margin: [0, 0, 0, 10] });

  for (const k of o.raceSections) {
    const s = RACE_SECTIONS.find((x) => x.key === k)!;
    if (!hasText(d.race.sections[k])) continue;
    content.push({ text: s.label, style: 'h2' }, ...rich(d.race.sections[k]));
  }

  if (o.stages) {
    const list = o.onlyStage != null ? d.stages.filter((s) => s.number === o.onlyStage) : d.stages;
    if (list.length) {
      content.push({ text: d.race.kind === 'eintages' ? 'Strecke' : 'Etappen', style: 'h2' });
      for (const s of list) {
        const head = [d.race.kind === 'eintages' ? '' : s.number === 0 ? 'Prolog' : `Etappe ${s.number}`, s.date ? new Date(s.date + 'T12:00:00Z').toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '', [s.start, s.finish].filter(Boolean).join(' – '), s.distanceKm ? `${s.distanceKm} km` : ''].filter(Boolean).join(' · ');
        content.push({ text: head, style: 'h3' }, ...rich(s.notes));
      }
    }
  }

  if (o.startlist && d.entries.length) {
    content.push({ text: 'Startliste', style: 'h2', pageBreak: content.length > 3 ? 'before' : undefined });
    const teams = new Map<string, Entry[]>();
    for (const e of d.entries) teams.set(e.team ?? '', [...(teams.get(e.team ?? '') ?? []), e]);
    const cols: unknown[][] = [[], []];
    [...teams].forEach(([team, list], i) => {
      cols[i % 2].push({ text: team || 'ohne Team', bold: true, margin: [0, 6, 0, 1] });
      for (const e of list) cols[i % 2].push({ text: [{ text: `${e.bib ?? ''}  `, bold: true, color: '#a07800' }, e.name, e.status !== 'aktiv' ? { text: `  (${STATUS_LABEL[e.status]})`, color: '#c0392b' } : ''] });
    });
    content.push({ columns: [{ stack: cols[0] }, { stack: cols[1] }], columnGap: 20 });
  }

  const riderList: { r: Rider; e?: Entry }[] = o.riders === 'keine' ? []
    : o.riders === 'profile' ? d.entries.filter((e) => e.riderId && d.riders.get(e.riderId)).map((e) => ({ r: d.riders.get(e.riderId!)!, e }))
    : o.riderIds.map((id) => ({ r: d.riders.get(id)!, e: d.entries.find((e) => e.riderId === id) })).filter((x) => x.r);
  if (riderList.length) {
    content.push({ text: 'Fahrer', style: 'h2', pageBreak: 'before' });
    for (const { r, e } of riderList) {
      const block: unknown[] = [{ text: [{ text: e?.bib ? `${e.bib}  ` : '', color: '#a07800' }, r.name], style: 'rider' }];
      if (o.riderFacts) {
        const age = ageOn(r.birthDate, day);
        const f = [r.nation, e?.team || r.team, age != null ? `${age} Jahre` : '', r.riderType, r.heightCm ? `${r.heightCm} cm` : '', r.weightKg ? `${r.weightKg} kg` : '', r.birthPlace ? `geb. in ${r.birthPlace}` : '', r.residence ? `wohnt in ${r.residence}` : ''].filter(Boolean).join(' · ');
        if (f) block.push({ text: f, style: 'meta' });
        if (r.pronunciation) block.push({ text: `Aussprache: ${r.pronunciation}`, style: 'meta' });
      }
      for (const k of o.riderSections) {
        if (!hasText(r.sections[k])) continue;
        block.push({ text: RIDER_SECTIONS.find((x) => x.key === k)!.label.toUpperCase(), style: 'label' }, ...rich(r.sections[k]));
      }
      content.push({ stack: block, margin: [0, 0, 0, 12] });
    }
  }

  if (o.topics !== 'keine') {
    const ts = d.topics.filter((t) => (t.raceId === d.race.id || (!t.raceId && t.riderIds.some((id) => riderList.some((x) => x.r.id === id)))) && (o.topics === 'alle' || t.starred));
    if (ts.length) {
      content.push({ text: 'Themen', style: 'h2', pageBreak: 'before' });
      for (const t of ts) {
        const kind = TOPIC_KINDS.find((k) => k.key === t.kind)?.label ?? t.kind;
        content.push({ text: [{ text: kind.toUpperCase() + '  ', style: 'label' }, { text: t.title, bold: true }], margin: [0, 6, 0, 0] }, ...rich(t.body));
        const who = t.riderIds.map((id) => d.riders.get(id)?.name).filter(Boolean).join(', ');
        if (who || t.source) content.push({ text: [who, t.source ? `Quelle: ${t.source}` : ''].filter(Boolean).join(' · '), style: 'meta' });
      }
    }
  }

  const base = o.fontScale === 'gross' ? 12 : 10;
  return {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 40],
    info: { title: `${d.race.name} ${d.race.year}`, creator: 'Rad Command Center' },
    defaultStyle: { font: 'Roboto', fontSize: base, lineHeight: 1.2 },
    styles: {
      title: { fontSize: base + 12, bold: true },
      h2: { fontSize: base + 5, bold: true, color: '#a07800', margin: [0, 12, 0, 4] },
      h3: { fontSize: base + 1, bold: true, margin: [0, 8, 0, 2] },
      rider: { fontSize: base + 4, bold: true, margin: [0, 6, 0, 1] },
      label: { fontSize: base - 2, bold: true, color: '#777777', margin: [0, 5, 0, 1] },
      meta: { fontSize: base - 1, color: '#555555' },
    },
    footer: (page: number, pages: number) => ({ text: `${d.race.name} ${d.race.year} · Seite ${page} von ${pages}`, alignment: 'center', fontSize: 8, color: '#888888', margin: [0, 12, 0, 0] }),
    content,
  };
}

export function exportFileName(race: Race, now = new Date()): string {
  const slug = `${race.name}-${race.year}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}_${now.toISOString().slice(0, 10)}.pdf`;
}
