/**
 * PDF-Export: wählbare Inhalte eines Rennens als PDF-Datei.
 * Daten werden lokal gesammelt (auch offline), das PDF entsteht im Browser.
 * Private Notizen kommen nur hinein, wenn ausdrücklich gewählt (Bauplan 9/14).
 */
import { db, alive } from '../db/db';
import type { ClassificationKind, ClassificationStanding, Edition, Note, Participation, RaceEvent, RaceGroup, Rider, Stage } from '../domain/types';
import { CLASSIFICATION_LABEL, START_STATUS_LABEL } from '../domain/types';
import { resolveStanding } from '../domain/standings';
import { ageAt, formatClock, formatDuration, formatGap } from '../domain/text';
import { splitFullName } from '../import/matching';
import { richToPdf, type PdfBlock } from './richToPdf';

export interface ExportOptions {
  riderScope: 'alle' | 'favoriten' | 'angeheftet' | 'aktiv';
  startlist: boolean;
  cards: boolean;
  card: { pronunciation: boolean; type: boolean; natAge: boolean; facts: boolean; strengths: boolean; bio: boolean; notes: boolean; privateNotes: boolean; results: boolean };
  standings: ClassificationKind[];
  standingsTop: number; // 0 = alle
  statistik: boolean;
  themen: boolean;
  raceNotes: boolean;
  groups: boolean;
  events: boolean;
  orientation: 'portrait' | 'landscape';
  fontScale: 'normal' | 'gross';
  cardColumns: 1 | 2;
}

export const DEFAULT_EXPORT: ExportOptions = {
  riderScope: 'alle',
  startlist: true,
  cards: true,
  card: { pronunciation: true, type: true, natAge: true, facts: true, strengths: false, bio: false, notes: false, privateNotes: false, results: true },
  standings: [],
  standingsTop: 10,
  statistik: true,
  themen: true,
  raceNotes: false,
  groups: false,
  events: false,
  orientation: 'portrait',
  fontScale: 'normal',
  cardColumns: 2,
};

export interface ExportData {
  edition: Edition;
  stage: Stage | null;
  stages: Stage[];
  parts: Participation[];
  riders: Map<string, Rider>;
  notesByRef: Map<string, Note[]>;
  standings: ClassificationStanding[];
  topics: { statistik: { race?: string; stage?: string }; thema: { race?: string; stage?: string } };
  groups: RaceGroup[];
  events: RaceEvent[];
  pinned: string[];
}

export async function collectExportData(editionId: string, stageId: string | null, pinned: string[]): Promise<ExportData> {
  const edition = await db.editions.get(editionId);
  if (!edition) throw new Error('Rennen nicht gefunden');
  const stages = alive(await db.stages.where('editionId').equals(editionId).toArray()).sort((a, b) => a.order - b.order);
  const stage = stages.find((s) => s.id === stageId) ?? stages[stages.length - 1] ?? null;
  const parts = alive(await db.participations.where('editionId').equals(editionId).toArray());
  const riders = new Map((await db.riders.bulkGet(parts.map((p) => p.riderId))).filter((r): r is Rider => !!r).map((r) => [r.id, r]));
  const allNotes = alive(await db.notes.toArray());
  const notesByRef = new Map<string, Note[]>();
  for (const n of allNotes) if (!n.kind) notesByRef.set(n.refId, [...(notesByRef.get(n.refId) ?? []), n]);
  const topic = (kind: 'statistik' | 'thema', sid?: string) => allNotes.find((n) => n.scope === 'edition' && n.refId === editionId && n.kind === kind && (n.stageId ?? null) === (sid ?? null))?.text;
  return {
    edition, stage, stages, parts, riders, notesByRef,
    standings: alive(await db.standings.where('editionId').equals(editionId).toArray()),
    topics: {
      statistik: { race: topic('statistik'), stage: stage ? topic('statistik', stage.id) : undefined },
      thema: { race: topic('thema'), stage: stage ? topic('thema', stage.id) : undefined },
    },
    groups: alive(await db.groups.where('editionId').equals(editionId).toArray()).filter((g) => !stage || g.stageId === stage.id).sort((a, b) => a.order - b.order),
    events: alive(await db.events.where('editionId').equals(editionId).toArray()).sort((a, b) => a.at.localeCompare(b.at)),
    pinned,
  };
}

const bibNum = (b: string) => (isNaN(Number(b)) ? Number.MAX_SAFE_INTEGER : Number(b));
const OUT = ['DNS', 'DNF', 'DSQ', 'OTL', 'HD'];
const pcsName = (n: string) => { const s = splitFullName(n); return `${s.first} ${s.last}`.trim(); };

export function selectParts(d: ExportData, o: ExportOptions): Participation[] {
  return d.parts.filter((p) =>
    o.riderScope === 'alle' ? true
      : o.riderScope === 'favoriten' ? p.favorite
        : o.riderScope === 'angeheftet' ? d.pinned.includes(p.riderId)
          : !OUT.includes(p.status),
  ).sort((a, b) => bibNum(a.bib) - bibNum(b.bib) || a.bib.localeCompare(b.bib));
}

/** pdfmake-Dokument (reine Funktion – testbar ohne Browser-Download). */
export function buildExportDoc(d: ExportData, o: ExportOptions, now = new Date()) {
  const fs = o.fontScale === 'gross' ? 1.25 : 1;
  const parts = selectParts(d, o);
  const content: unknown[] = [];
  const created = now.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isDemo = d.edition.dataOrigin === 'demo';
  const hasPrivate = o.cards && o.card.notes && o.card.privateNotes;

  content.push({ text: d.edition.name, style: 'title' });
  content.push({ text: [d.stage && d.edition.format === 'etappen' ? d.stage.label : null, d.edition.startDate, d.edition.location].filter(Boolean).join(' · '), style: 'subtitle' });
  if (isDemo) content.push({ text: 'DEMO – alle Personen, Teams und Resultate sind frei erfunden', style: 'warn' });

  const section = (title: string) => content.push({ text: title, style: 'h2' });
  const blocks = (v?: string | null): PdfBlock[] => richToPdf(v);

  if (o.raceNotes && d.edition.notes) { section('Notizen zum Rennen'); content.push(...blocks(d.edition.notes)); }

  const topicSection = (title: string, t: { race?: string; stage?: string }) => {
    if (!t.race && !t.stage) return;
    section(title);
    if (t.stage && d.stage) content.push({ text: d.stage.label, style: 'h3' }, ...blocks(t.stage));
    if (t.race) content.push({ text: 'Ganzes Rennen', style: 'h3' }, ...blocks(t.race));
  };
  if (o.statistik) topicSection('Statistiken', d.topics.statistik);
  if (o.themen) topicSection('Themen', d.topics.thema);

  if (o.startlist) {
    section(`Startliste (${parts.length})`);
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', '*', 'auto', 'auto', 'auto'],
        body: [
          ['Nr.', 'Name', 'Team', 'Nation', 'Alter', 'Status'].map((h) => ({ text: h, style: 'th' })),
          ...parts.map((p) => {
            const r = d.riders.get(p.riderId);
            const age = r ? ageAt(r.birthDate, d.stage?.date ?? d.edition.startDate) : null;
            return [
              { text: p.bib, bold: true },
              p.overrides.displayName ?? r?.displayName ?? '?',
              p.teamName,
              r?.nationality ?? '',
              age ?? '',
              p.status === 'aktiv' || p.status === 'gemeldet' ? '' : p.status,
            ];
          }),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9 * fs,
    });
  }

  if (o.cards && parts.length) {
    section('Fahrer');
    const cards = parts.map((p) => riderCard(d, o, p, blocks));
    if (o.cardColumns === 2) {
      for (let i = 0; i < cards.length; i += 2) content.push({ columns: [cards[i], cards[i + 1] ?? { text: '' }], columnGap: 14, margin: [0, 0, 0, 8], unbreakable: true });
    } else cards.forEach((c) => content.push({ ...c, margin: [0, 0, 0, 8], unbreakable: true }));
  }

  if (o.standings.length && d.stage) {
    for (const kind of o.standings) {
      const res = resolveStanding(kind, d.stage.id, d.stages, d.standings, formatClock);
      section(CLASSIFICATION_LABEL[kind]);
      content.push({ text: res.label, style: 'small' });
      if (!res.standing) continue;
      const rows = o.standingsTop > 0 ? res.standing.rows.filter((r) => r.rank != null).slice(0, o.standingsTop) : res.standing.rows;
      const unitPts = res.standing.unit === 'punkte';
      content.push({
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto'],
          body: [
            ['Platz', kind === 'team' ? 'Team' : 'Fahrer', unitPts ? 'Punkte' : 'Zeit/Rückstand'].map((h) => ({ text: h, style: 'th' })),
            ...rows.map((r) => {
              const rd = r.riderId ? d.riders.get(r.riderId) : undefined;
              const bib = r.riderId ? d.parts.find((p) => p.riderId === r.riderId)?.bib : undefined;
              const name = r.teamName ?? (rd ? `${bib ? bib + '  ' : ''}${rd.displayName}` : r.name ? pcsName(r.name) : '(unbekannt)');
              const val = unitPts ? String(r.points ?? '–') : r.rank === 1 ? formatDuration(r.timeSec) : r.sameTimeAsPrevious ? 'gl. Zeit' : formatGap(r.gapSec);
              return [String(r.rank ?? r.status ?? '–'), name, val];
            }),
          ],
        },
        layout: 'lightHorizontalLines',
        fontSize: 9 * fs,
      });
      if (o.standingsTop > 0 && res.standing.rows.length > rows.length) content.push({ text: `… ${res.standing.rows.length - rows.length} weitere`, style: 'small' });
    }
  }

  if (o.groups && d.groups.length) {
    section('Renngruppen');
    for (const g of d.groups) {
      const names = g.riderIds.map((id) => { const p = d.parts.find((x) => x.riderId === id); return `${p?.bib ?? '?'} ${d.riders.get(id)?.lastName ?? ''}`; }).join(', ');
      content.push({ text: [{ text: `${g.name}`, bold: true }, g.gapSec != null ? ` · ${formatGap(g.gapSec)}` : '', g.measuredAt ? ` (gemessen ${formatClock(g.measuredAt)})` : '', names ? `: ${names}` : ''] });
    }
  }

  if (o.events && d.events.length) {
    section('Ereignisprotokoll');
    for (const e of d.events) {
      const who = e.riderIds.map((id) => d.riders.get(id)?.lastName).filter(Boolean).join(', ');
      content.push({ text: [{ text: formatClock(e.at) + (e.raceClockSec != null ? ` [${formatDuration(e.raceClockSec)}]` : '') + '  ', color: '#555' }, e.text, who ? { text: ` · ${who}`, color: '#555' } : ''] });
    }
  }

  const footerNote = [isDemo ? 'DEMO, fiktive Daten' : null, hasPrivate ? 'enthält PRIVATE Notizen' : null].filter(Boolean).join(' · ');
  return {
    pageSize: 'A4',
    pageOrientation: o.orientation,
    pageMargins: [36, 36, 36, 42],
    info: { title: `${d.edition.name}${d.stage ? ' – ' + d.stage.label : ''}`, creator: 'LK Board Rad', producer: 'LK Board Rad' },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `LK Board Rad · ${d.edition.name} · erstellt ${created}${footerNote ? ' · ' + footerNote : ''}`, fontSize: 7, color: hasPrivate ? '#b00020' : '#777' },
        { text: `Seite ${page} / ${pages}`, alignment: 'right', fontSize: 7, color: '#777' },
      ],
      margin: [36, 12, 36, 0],
    }),
    defaultStyle: { font: 'Roboto', fontSize: 10 * fs, lineHeight: 1.15 },
    styles: {
      title: { fontSize: 18 * fs, bold: true },
      subtitle: { fontSize: 10 * fs, color: '#555', margin: [0, 2, 0, 6] },
      warn: { fontSize: 9 * fs, color: '#8a5a00', bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 13 * fs, bold: true, margin: [0, 12, 0, 4] },
      h3: { fontSize: 9 * fs, bold: true, color: '#8a5a00', margin: [0, 4, 0, 2] },
      th: { bold: true, color: '#555' },
      small: { fontSize: 8 * fs, color: '#555', margin: [0, 0, 0, 3] },
      bib: { fontSize: 16 * fs, bold: true, color: '#b07800' },
      name: { fontSize: 16 * fs, bold: true },
      label: { fontSize: 7.5 * fs, color: '#777', bold: true },
    },
  };
}

function riderCard(d: ExportData, o: ExportOptions, p: Participation, blocks: (v?: string | null) => PdfBlock[]) {
  const r = d.riders.get(p.riderId);
  const c = o.card;
  const stack: unknown[] = [];
  stack.push({ columns: [{ text: p.bib, style: 'bib', width: 'auto' }, { text: p.overrides.displayName ?? r?.displayName ?? '?', style: 'name', width: '*' }], columnGap: 8 });
  const line = [p.teamName];
  if (c.natAge && r) {
    if (r.nationality) line.push(r.nationality);
    const age = ageAt(r.birthDate, d.stage?.date ?? d.edition.startDate);
    if (age) line.push(`${age} J.`);
  }
  if (!['aktiv', 'gemeldet'].includes(p.status)) line.push(START_STATUS_LABEL[p.status]);
  stack.push({ text: line.join(' · '), color: '#555', margin: [0, 0, 0, 3] });
  const pron = p.overrides.pronunciation ?? r?.pronunciation;
  if (c.pronunciation && pron) stack.push({ text: [{ text: 'AUSSPRACHE  ', style: 'label' }, { text: pron, bold: true }] });
  if (c.type && r?.riderType) stack.push({ text: [{ text: 'TYP  ', style: 'label' }, r.riderType] });
  if (c.results && d.stage && r) {
    const res = (kind: ClassificationKind) => {
      const st = resolveStanding(kind, d.stage!.id, d.stages, d.standings);
      const row = st.standing?.rows.find((x) => x.riderId === r.id);
      return row ? (row.rank ? `${row.rank}. ${formatGap(row.gapSec)}` : row.status ?? '–') : null;
    };
    const e = res('etappe');
    const gc = res('gc');
    const txt = [e ? `${d.stage.label}: ${e}` : null, gc ? `Gesamt: ${gc}` : null].filter(Boolean).join(' · ');
    if (txt) stack.push({ text: [{ text: 'ERGEBNIS  ', style: 'label' }, txt] });
  }
  const notes = (d.notesByRef.get(p.riderId) ?? []).concat(d.notesByRef.get(p.id) ?? []);
  if (c.facts && r) {
    const facts = [...r.keyFacts, ...notes.filter((n) => n.priority && (!n.private || c.privateNotes)).map((n) => n.text)].filter(Boolean).slice(0, 3);
    if (facts.length) stack.push({ ol: facts.map((f) => ({ stack: blocks(f) })), margin: [0, 2, 0, 2] });
  }
  if (c.strengths && r?.strengths) stack.push({ text: 'STÄRKEN', style: 'label', margin: [0, 3, 0, 0] }, ...blocks(r.strengths));
  if (c.bio && r?.bio) stack.push({ text: 'KURZBIO', style: 'label', margin: [0, 3, 0, 0] }, ...blocks(r.bio));
  if (c.notes) {
    const visible = notes.filter((n) => !n.private || c.privateNotes);
    if (visible.length) {
      stack.push({ text: 'NOTIZEN', style: 'label', margin: [0, 3, 0, 0] });
      stack.push({ ul: visible.map((n) => ({ stack: blocks(n.text) })) });
    }
  }
  return { stack, width: '*' };
}

export function exportFileName(d: ExportData, now = new Date()): string {
  const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const p = (n: number) => String(n).padStart(2, '0');
  return `lk-board_${slug(d.edition.name)}${d.stage && d.edition.format === 'etappen' ? '_' + slug(d.stage.label) : ''}_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.pdf`;
}
