import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, getDevice, setDevice } from '../db/db';
import { RACE_SECTIONS, RIDER_SECTIONS, STATUS_LABEL, type Entry, type Race, type Rider, type Stage, type Topic } from '../domain/types';
import { ageOn, raceEntries, topicsFor } from '../domain/center';
import { normalize } from '../domain/text';
import { LiveText, RichView } from './rich';
import { PROFILE_LABEL, fmtDate, stageLabel, useCurrent } from './state';
import { PcsLink } from './pcs';
import { pcsRiderUrl } from '../domain/center';

/**
 * LIVE: links das Feld, Mitte die Fahrerkarte (★-Zeilen zuoberst), rechts Etappe und Rennen.
 * Nur Lesen – bearbeitet wird in „Fahrer“, „Rennen“ und „Themen“.
 * Tastatur: Ziffer = Startnummer, Buchstabe oder / = Namenssuche, Esc = schliessen.
 */
export function LiveView() {
  const cur = useCurrent();
  const race = cur.race;
  const entries = useLiveQuery(() => (race ? raceEntries(race.id) : Promise.resolve([] as Entry[])), [race?.id]) ?? [];
  const riders = useLiveQuery(async () => new Map(alive(await db.riders.toArray()).map((r) => [r.id, r])), []) ?? new Map<string, Rider>();
  const topics = useLiveQuery(async () => alive(await db.topics.toArray()), []) ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const [onlyProfiles, setOnlyProfiles] = useState(false);
  const [qs, setQs] = useState<string | null>(null);

  useEffect(() => { void getDevice<string | null>(`liveSel:${race?.id}`, null).then(setSel); }, [race?.id]);
  const choose = (id: string) => { setSel(id); if (race) void setDevice(`liveSel:${race.id}`, id); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (qs !== null || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      if (/^[0-9]$/.test(e.key) || /^\p{L}$/u.test(e.key)) { e.preventDefault(); setQs(e.key); }
      else if (e.key === '/') { e.preventDefault(); setQs(''); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [qs]);

  if (!cur.ready) return null;
  if (!race) return <main><div className="panel empty-state">Noch kein Rennen. Lege unter <a href="#rennen">Rennen</a> eines an und füge die Startliste ein.</div></main>;

  const entry = entries.find((e) => e.id === sel);
  const groups = groupByTeam(entries.filter((e) => !onlyProfiles || e.riderId));

  return (
    <div className="live-board">
      <nav className="startlist" aria-label="Startliste">
        <div className="row" style={{ justifyContent: 'space-between', padding: '0 4px 6px' }}>
          <button className="btn small" onClick={() => setQs('')} title="Suche: Ziffer für Startnummer, Buchstabe für Namen">Suchen <kbd className="muted small">/</kbd></button>
          <label className="check small"><input type="checkbox" checked={onlyProfiles} onChange={(e) => setOnlyProfiles(e.target.checked)} /> nur Profile</label>
        </div>
        {!entries.length && <p className="muted small" style={{ padding: 6 }}>Keine Startliste. In <a href={`#rennen-${race.id}`}>Rennen</a> einfügen.</p>}
        {groups.map(([team, list]) => (
          <div key={team}>
            <div className="team">{team || 'ohne Team'}</div>
            {list.map((e) => (
              <button key={e.id} className={`${e.id === sel ? 'on' : ''} ${e.status !== 'aktiv' ? 'out' : ''}`} onClick={() => choose(e.id)} title={e.status !== 'aktiv' ? STATUS_LABEL[e.status] : undefined}>
                <span className="bib">{e.bib ?? ''}</span>
                <span className="grow">{e.name}</span>
                {e.riderId && <span className="dot" title="Profil vorhanden" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <section aria-label="Fahrer">
        {entry ? <RiderCard entry={entry} rider={entry.riderId ? riders.get(entry.riderId) : undefined} race={race} stage={cur.stage} topics={topics} />
          : <div className="live-card empty-state">Fahrer wählen: links anklicken, Startnummer tippen oder Namen schreiben.</div>}
      </section>

      <aside className="live-side" aria-label="Etappe und Rennen">
        <StagePanel race={race} stage={cur.stage} topics={topics} />
      </aside>

      {qs !== null && <QuickSearch initial={qs} entries={entries} onPick={(id) => { choose(id); setQs(null); }} onClose={() => setQs(null)} />}
    </div>
  );
}

function groupByTeam(entries: Entry[]): [string, Entry[]][] {
  const m = new Map<string, Entry[]>();
  for (const e of entries) m.set(e.team ?? '', [...(m.get(e.team ?? '') ?? []), e]);
  return [...m];
}

function RiderCard({ entry, rider, race, stage, topics }: { entry: Entry; rider?: Rider; race: Race; stage?: Stage; topics: Topic[] }) {
  const day = stage?.date ?? race.startDate ?? new Date().toISOString().slice(0, 10);
  if (!rider) {
    return (
      <div className="live-card">
        <div className="live-name"><span className="bibbig">{entry.bib}</span><h1>{entry.name}</h1></div>
        <p className="live-facts">{entry.team}</p>
        {entry.status !== 'aktiv' && <p className="err">{STATUS_LABEL[entry.status]}{entry.statusStage ? ` (Etappe ${entry.statusStage})` : ''}</p>}
        <p className="muted">Kein Profil. In <a href={`#rennen-${race.id}`}>Rennen → Startliste</a> mit „+ Profil“ anlegen.</p>
      </div>
    );
  }
  const age = ageOn(rider.birthDate, day);
  const rt = topicsFor(topics, { riderId: rider.id }).filter((t) => !t.raceId || t.raceId === race.id);
  const facts: React.ReactNode[] = [];
  if (rider.nation) facts.push(<b key="n">{rider.nation}</b>);
  if (entry.team || rider.team) facts.push(<span key="t">{entry.team || rider.team}</span>);
  if (age != null) facts.push(<span key="a"><b>{age}</b> Jahre</span>);
  if (rider.riderType) facts.push(<span key="ty">{rider.riderType}</span>);
  if (rider.heightCm || rider.weightKg) facts.push(<span key="hw">{[rider.heightCm ? `${rider.heightCm} cm` : '', rider.weightKg ? `${rider.weightKg} kg` : ''].filter(Boolean).join(' / ')}</span>);
  if (rider.birthPlace) facts.push(<span key="bp">geb. in {rider.birthPlace}</span>);
  if (rider.residence) facts.push(<span key="re">wohnt in {rider.residence}</span>);
  return (
    <div className="live-card">
      <div className="live-name">
        <span className="bibbig">{entry.bib}</span><h1>{rider.name}</h1>
        <span className="grow" />
        <a className="btn small" href={`#fahrer-${rider.id}`}>Bearbeiten</a>
        <PcsLink url={pcsRiderUrl(rider)} />
      </div>
      <p className="live-facts">{facts.map((f, i) => <span key={i}>{i > 0 && ' · '}{f}</span>)}</p>
      {rider.pronunciation && <p className="live-facts">Aussprache: <b>{rider.pronunciation}</b></p>}
      {entry.status !== 'aktiv' && <p className="err" style={{ fontSize: '1.1rem' }}>{STATUS_LABEL[entry.status]}{entry.statusStage ? ` (Etappe ${entry.statusStage})` : ''}</p>}
      {entry.note && <div className="live-sec"><h3>Bei diesem Rennen</h3><LiveText value={entry.note} /></div>}
      <div className="live-sec"><h3>Aktuell{rider.aktuellAt ? <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}> · Stand {fmtDate(rider.aktuellAt)}</span> : null}</h3><LiveText value={rider.sections.aktuell} emptyText="Noch nichts Aktuelles erfasst." /></div>
      {rt.length > 0 && (
        <div className="live-sec"><h3>Themen</h3>{rt.map((t) => <LiveTopic key={t.id} t={t} />)}</div>
      )}
      {RIDER_SECTIONS.filter((s) => s.key !== 'aktuell').map((s) => rider.sections[s.key] ? (
        <div className="live-sec" key={s.key}><h3>{s.label}</h3><LiveText value={rider.sections[s.key]} /></div>
      ) : null)}
    </div>
  );
}

function LiveTopic({ t }: { t: Topic }) {
  return (
    <div style={{ margin: '6px 0', paddingLeft: 10, borderLeft: `3px solid ${t.starred ? 'var(--flag)' : 'var(--line)'}` }}>
      <div className="small"><span className={`kind ${t.kind}`}>{t.kind}</span>{t.title ? <b> {t.title}</b> : null}{t.source ? <span className="muted"> · {t.source}</span> : null}</div>
      <div className="live-text"><RichView value={t.body} /></div>
    </div>
  );
}

function StagePanel({ race, stage, topics }: { race: Race; stage?: Stage; topics: Topic[] }) {
  const rt = topicsFor(topics, { raceId: race.id, stageNumber: stage?.number }).filter((t) => t.riderIds.length === 0 || t.starred);
  return (
    <>
      {stage && (
        <div className="panel">
          <h2>{stageLabel(stage, race.kind)}{stage.date ? <span className="muted small"> · {fmtDate(stage.date, { weekday: 'short', day: 'numeric', month: 'numeric' })}</span> : null}</h2>
          <p style={{ margin: '0 0 6px', fontSize: '1.1rem' }}>{[stage.start, stage.finish].filter(Boolean).join(' – ')}{stage.distanceKm ? ` · ${stage.distanceKm} km` : ''}{stage.profile ? ` · ${PROFILE_LABEL[stage.profile]}` : ''}</p>
          <LiveText value={stage.notes} emptyText="Keine Etappennotizen." />
        </div>
      )}
      {RACE_SECTIONS.filter((s) => race.sections[s.key]).map((s) => (
        <div className="panel" key={s.key}><h2>{s.label}</h2><LiveText value={race.sections[s.key]} /></div>
      ))}
      {rt.length > 0 && <div className="panel"><h2>Themen</h2>{rt.map((t) => <LiveTopic key={t.id} t={t} />)}</div>}
    </>
  );
}

function QuickSearch({ initial, entries, onPick, onClose }: { initial: string; entries: Entry[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); const v = ref.current?.value.length ?? 0; ref.current?.setSelectionRange(v, v); }, []);
  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return entries.slice(0, 12);
    if (/^\d+$/.test(t)) return [...entries.filter((e) => e.bib === t), ...entries.filter((e) => e.bib !== t && e.bib?.startsWith(t))].slice(0, 12);
    const n = normalize(t);
    return entries.filter((e) => normalize(`${e.name} ${e.team ?? ''}`).split(' ').some((w) => w.startsWith(n)) || normalize(e.name).includes(n)).slice(0, 12);
  }, [q, entries]);
  return (
    <div className="qsearch" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} aria-label="Startnummer oder Name" placeholder="Startnummer oder Name …"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter' && hits[i]) onPick(hits[i].id);
          }} />
        <ul>
          {hits.map((h, k) => (
            <li key={h.id}><button className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => onPick(h.id)}>
              <b style={{ color: 'var(--flag)', minWidth: '2.5em', textAlign: 'right' }}>{h.bib}</b><span className="grow">{h.name}</span><span className="muted small">{h.team}</span>
            </button></li>
          ))}
          {!hits.length && <li className="muted" style={{ padding: 8 }}>Kein Fahrer gefunden.</li>}
        </ul>
      </div>
    </div>
  );
}
