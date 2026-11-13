/** Entfernt Akzente/Diakritika und vereinheitlicht für Suche und Abgleich.
 *  Die Originalschreibweise wird nie überschrieben – nur der Suchschlüssel. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Schlüssel für Namensvergleich unabhängig von Reihenfolge (Vorname/Nachname). */
export function nameKey(first: string, last: string): string {
  return normalize(`${first} ${last}`).split(' ').filter(Boolean).sort().join(' ');
}

export function riderSearchTokens(first: string, last: string, display: string, aliases: string[]): string[] {
  const set = new Set<string>();
  for (const s of [first, last, display, ...aliases]) {
    const n = normalize(s);
    if (!n) continue;
    set.add(n);
    for (const part of n.split(' ')) if (part) set.add(part);
  }
  return [...set];
}

/** "1:02:03" / "+0:12" / "s.t." → Sekunden. Unklare Werte → null (nie 0 erfinden). */
export function parseDuration(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^\+/, '');
  if (!s || /^(s\.?t\.?|,,)$/i.test(s)) return null;
  const parts = s.split(':').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '–';
  const s = Math.abs(Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(r).padStart(2, '0')}`;
}

export function formatGap(sec: number | null | undefined): string {
  if (sec == null) return '–';
  if (sec === 0) return 'gl. Zeit';
  return (sec < 0 ? '−' : '+') + formatDuration(sec);
}

export function formatClock(iso: string | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

/** Alter zum Renndatum – nur bei vollständigem Geburtsdatum exakt, bei Jahr als "ca.". */
export function ageAt(birth: string | undefined, raceDate: string): string | null {
  if (!birth) return null;
  const rd = new Date(raceDate + 'T12:00:00');
  if (/^\d{4}$/.test(birth)) {
    const a = rd.getFullYear() - Number(birth);
    return `ca. ${a - 1}–${a}`;
  }
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let age = rd.getFullYear() - Number(m[1]);
  const md = (rd.getMonth() + 1) * 100 + rd.getDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age--;
  return String(age);
}
