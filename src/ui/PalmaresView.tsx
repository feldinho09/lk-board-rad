import { useState } from 'react';
import type { PalmaresEntry, Rider } from '../domain/types';
import { palmaresSummary } from '../domain/palmares';

const DETAIL_DE: [RegExp, string][] = [
  [/^general classification$/i, 'Gesamtwertung'],
  [/^points classification$/i, 'Punktewertung'],
  [/^mountains classification$/i, 'Bergwertung'],
  [/^youth classification$/i, 'Nachwuchswertung'],
  [/^stages?\s+/i, 'Etappe '],
];
const de = (d?: string) => {
  if (!d) return '';
  for (const [re, t] of DETAIL_DE) if (re.test(d)) return d.replace(re, t);
  return d;
};

/** Grösse · Gewicht · Wohnort in einer Zeile (leer, wenn nichts bekannt). */
export function physicalLine(r: Rider): string {
  return [r.heightCm ? `${r.heightCm} cm` : '', r.weightKg ? `${r.weightKg} kg` : '', r.residence ? `wohnt in ${r.residence}` : ''].filter(Boolean).join(' · ');
}

/** Palmarès kompakt: Bilanz und die Ergebnisse nach Jahren (Siege fett). */
export function PalmaresList({ entries, source, years = 3, compact = false }: { entries: PalmaresEntry[]; source?: string; years?: number; compact?: boolean }) {
  const [all, setAll] = useState(false);
  if (!entries.length) return <p className="muted small">Keine Podestplätze bekannt.</p>;
  const sum = palmaresSummary(entries);
  // Kompakt: nur Podestplätze in Eintagesrennen, Gesamtwertungen und Etappen – ohne Nebenwertungen
  const visible = (e: PalmaresEntry) => !compact || (e.rank <= 3 && (!e.detail || /general|^stage/i.test(e.detail)));
  const byYear = new Map<number, PalmaresEntry[]>();
  for (const e of entries.filter(visible)) byYear.set(e.year, [...(byYear.get(e.year) ?? []), e]);
  const ys = [...byYear.keys()].sort((a, b) => b - a);
  const shown = all ? ys : ys.slice(0, years);
  return (
    <div className={`palmares ${compact ? 'compact' : ''}`}>
      <p className="small"><strong>{sum.wins}</strong> Siege · <strong>{sum.podiums}</strong> Podestplätze (Etappen einzeln gezählt, ohne Nebenwertungen){source ? <span className="muted"> · {source}</span> : null}</p>
      {shown.map((y) => (
        <div key={y} className="pal-year">
          <span className="pal-y">{y}</span>
          <span>{byYear.get(y)!.map((e, i) => (
            <span key={i} className={e.rank === 1 ? 'pal-win' : ''}>{i ? ' · ' : ''}{e.rank}. {e.race}{e.detail ? ` (${de(e.detail)})` : ''}</span>
          ))}</span>
        </div>
      ))}
      {ys.length > years && <button className="link small" onClick={() => setAll((v) => !v)}>{all ? 'weniger' : `alle ${ys.length} Jahre`}</button>}
    </div>
  );
}
