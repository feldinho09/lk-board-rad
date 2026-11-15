import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { setDevice, db } from '../db/db';
import { GEO_KINDS, type GeoKind, type GeoPoint, type Race, type Route, type Stage } from '../domain/types';
import { climbStats, fetchSummary, findAlongRoute, kmToGo, parseGpx } from '../domain/geo';
import { addFound, addPoint, removePoint, removeRoute, saveRoute, stagePoints, stageRoute, updatePoint } from '../domain/geoStore';
import { updateStage } from '../domain/center';
import { normalize } from '../domain/text';
import { createRestorePoint } from '../backup/archive';
import { RichField, RichView } from './rich';
import { CommitInput } from './inputs';
import { confirmDialog } from './dialogs';
import { stageLabel, useCurrent } from './state';

export const KIND_SHORT: Record<GeoKind, string> = { ort: 'Ort', sehenswuerdigkeit: 'Sehensw.', natur: 'Natur', anstieg: 'Anstieg', sprint: 'Sprint', verpflegung: 'Verpfl.', sonstiges: 'Sonst.' };
const LANGS = [['de', 'Deutsch'], ['fr', 'Französisch'], ['it', 'Italienisch'], ['es', 'Spanisch'], ['en', 'Englisch'], ['nl', 'Niederländisch']] as const;
const fmtKm = (k: number) => k.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const offsetText = (m?: number) => (m == null ? '' : m < 400 ? 'an der Strecke' : `${(m / 1000).toLocaleString('de-CH', { maximumFractionDigits: 1 })} km neben der Strecke`);

/** Geographisches: Strecke, Höhenprofil, Orte und Sehenswürdigkeiten nach km to go. */
export function GeoView() {
  const cur = useCurrent();
  if (!cur.ready) return null;
  if (!cur.race || !cur.stage) return <main><div className="panel empty-state">Zuerst unter <a href="#rennen">Rennen</a> ein Rennen anlegen.</div></main>;
  return <Geo race={cur.race} stage={cur.stage} />;
}

function Geo({ race, stage }: { race: Race; stage: Stage }) {
  const route = useLiveQuery(() => stageRoute(race.id, stage.number), [race.id, stage.number]);
  const points = useLiveQuery(() => stagePoints(race.id, stage.number), [race.id, stage.number]) ?? [];
  const length = route?.lengthKm ?? stage.distanceKm ?? Math.max(0, ...points.map((p) => p.km));
  const [kinds, setKinds] = useState<GeoKind[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const n = normalize(q);
    return points.filter((p) => (showHidden || !p.hidden) && (!kinds.length || kinds.includes(p.kind)) && (!n || normalize(`${p.name} ${p.description ?? ''} ${p.summary ?? ''}`).includes(n)));
  }, [points, kinds, showHidden, q]);
  const counts = useMemo(() => Object.fromEntries(GEO_KINDS.map((k) => [k.key, points.filter((p) => !p.hidden && p.kind === k.key).length])), [points]);

  return (
    <main>
      <div className="panel">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Geographisches · {race.name} {race.year} · {stageLabel(stage, race.kind)}</h2>
          <span className="muted">{[[stage.start, stage.finish].filter(Boolean).join(' – '), length ? `${fmtKm(length)} km` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <RouteCard race={race} stage={stage} route={route} points={points.filter((p) => !p.hidden)} />
      </div>

      <div className="panel">
        <div className="section-head"><h3>Region, Landschaft, Verlauf</h3><span className="hint">eigene Notizen zur Etappe</span></div>
        <RichField label={`Geographisches ${stageLabel(stage, race.kind)}`} value={stage.geoNotes} onSave={(h) => updateStage(stage.id, { geoNotes: h })} placeholder="Region, Landschaft, Wetter, Wind, Weinbau, Geschichte der Gegend …" />
      </div>

      <div className="panel">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>An der Strecke <span className="muted small">{shown.length} Punkte · Reihenfolge nach km to go</span></h2>
          <input type="search" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Punkte filtern" style={{ width: 180 }} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {GEO_KINDS.map((k) => (
            <button key={k.key} className={`chip kindchip k-${k.key} ${kinds.includes(k.key) ? 'on' : ''}`} aria-pressed={kinds.includes(k.key)} onClick={() => setKinds(kinds.includes(k.key) ? kinds.filter((x) => x !== k.key) : [...kinds, k.key])}>
              {k.label} {counts[k.key] ? <b>{counts[k.key]}</b> : null}
            </button>
          ))}
          <label className="check small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> ausgeblendete zeigen</label>
        </div>
        <AddPoint race={race} stage={stage} length={length} />
        <div className="geo-list">
          {shown.map((p) => <PointRow key={p.id} p={p} length={length} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
          {!shown.length && <p className="muted">{points.length ? 'Keine Treffer.' : 'Noch keine Punkte. Lade oben die Strecke (GPX) und hole Orte und Sehenswürdigkeiten von Wikipedia – oder erfasse eigene Punkte mit km.'}</p>}
        </div>
      </div>
    </main>
  );
}

function RouteCard({ race, stage, route, points }: { race: Race; stage: Stage; route?: Route; points: GeoPoint[] }) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'busy'; text: string } | null>(null);
  const [lang, setLang] = useState(route?.wikiLang ?? 'de');
  const [per10, setPer10] = useState(3);
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const parsed = parseGpx(await f.text());
      await saveRoute(stage, parsed, f.name);
      setMsg({ kind: 'ok', text: `Strecke geladen: ${fmtKm(parsed.lengthKm)} km.` });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
  };
  const fetchWiki = async () => {
    if (!route) return;
    setMsg({ kind: 'busy', text: 'Wikipedia wird abgefragt …' });
    try {
      await createRestorePoint(`Vor Wikipedia-Abruf ${stageLabel(stage, race.kind)}`);
      const found = await findAlongRoute(route.points, { lang, sightsPer10Km: per10, onProgress: (d, t, ph) => setMsg({ kind: 'busy', text: `${ph}: ${d} von ${t} …` }) });
      const r = await addFound(race.id, stage.number, found, lang);
      await db.routes.update(route.id, { wikiLang: lang });
      setMsg({ kind: 'ok', text: `${found.length} Orte und Sehenswürdigkeiten gefunden: ${r.added} neu, ${r.updated} ergänzt. Ausgeblendete bleiben ausgeblendet, eigene Notizen bleiben erhalten.` });
    } catch (e) { setMsg({ kind: 'err', text: `Wikipedia-Abruf fehlgeschlagen: ${(e as Error).message}` }); }
  };
  const stats = route ? climbStats(route.points) : null;
  return (
    <div style={{ marginTop: 10 }}>
      {route ? (
        <>
          <p className="small muted" style={{ margin: '0 0 6px' }}>
            Strecke: {fmtKm(route.lengthKm)} km{stats && stats.max != null ? ` · ${stats.up.toLocaleString('de-CH')} Höhenmeter · höchster Punkt ${stats.max} m` : ''}{route.fileName ? ` · ${route.fileName}` : ''}
          </p>
          <Profile route={route} points={points} />
        </>
      ) : <p className="small muted" style={{ margin: 0 }}>Keine Strecke. Lade die GPX-Datei der Etappe (vom Veranstalter, z. B. aus dem Roadbook-Bereich der Rennseite, oder von Seiten wie la-flamme-rouge.eu bzw. cyclingstage.com). Damit können Orte und Sehenswürdigkeiten automatisch nach km to go eingeordnet werden.</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <label className="btn small" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {route ? 'Andere GPX-Datei …' : 'GPX-Datei laden …'}
          <input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" className="sr-only" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} aria-label="GPX-Datei laden" />
        </label>
        {route && (
          <>
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Wikipedia-Sprache">{LANGS.map(([k, l]) => <option key={k} value={k}>Wikipedia {l}</option>)}</select>
            <select value={per10} onChange={(e) => setPer10(Number(e.target.value))} aria-label="Sehenswürdigkeiten pro 10 km">{[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>{n} Sehenswürdigkeiten / 10 km</option>)}</select>
            <button className="btn small primary" disabled={msg?.kind === 'busy'} onClick={fetchWiki}>Orte & Sehenswürdigkeiten von Wikipedia holen</button>
            <button className="btn small danger" onClick={async () => { if (await confirmDialog('Strecke entfernen? Die Punkte bleiben erhalten.', 'Entfernen')) await removeRoute(race.id, stage.number); }}>Strecke entfernen</button>
          </>
        )}
      </div>
      {msg && <div className={`banner ${msg.kind === 'busy' ? 'warn' : msg.kind}`} role="status">{msg.text}</div>}
    </div>
  );
}

const KIND_COLOR: Record<GeoKind, string> = { ort: 'var(--paint)', sehenswuerdigkeit: 'var(--k-orange)', natur: 'var(--k-gruen)', anstieg: 'var(--k-rot)', sprint: 'var(--k-blau)', verpflegung: 'var(--k-lila)', sonstiges: 'var(--dim)' };

/** Höhenprofil mit Punkten; Achse in km to go. */
export function Profile({ route, points, currentToGo, height = 170 }: { route: Route; points: GeoPoint[]; currentToGo?: number; height?: number }) {
  const W = 1000, H = height, padB = 22, padT = 18;
  const ele = route.points.map((p) => p[2]).filter((e): e is number => e != null);
  const hasEle = ele.length > route.points.length / 2;
  const lo = hasEle ? Math.min(...ele) : 0, hi = hasEle ? Math.max(...ele) : 1;
  const span = Math.max(hi - lo, 100);
  const x = (km: number) => (km / route.lengthKm) * W;
  const y = (e: number) => padT + (1 - (e - lo) / span) * (H - padT - padB);
  const line = hasEle ? route.points.filter((p) => p[2] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p[3]).toFixed(1)},${y(p[2]!).toFixed(1)}`).join('') : `M0,${H - padB}L${W},${H - padB}`;
  const step = route.lengthKm > 150 ? 25 : route.lengthKm > 60 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= route.lengthKm; t += step) ticks.push(t);
  const eleAt = (km: number) => { const p = route.points.reduce((a, b) => (Math.abs(b[3] - km) < Math.abs(a[3] - km) ? b : a)); return p[2] ?? lo; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile" role="img" aria-label="Höhenprofil der Etappe mit Punkten nach km to go" preserveAspectRatio="none">
      <path d={`${line}L${W},${H - padB}L0,${H - padB}Z`} className="profile-area" />
      <path d={line} className="profile-line" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(route.lengthKm - t)} x2={x(route.lengthKm - t)} y1={H - padB} y2={H - padB + 4} className="profile-axis" />
          <text x={x(route.lengthKm - t)} y={H - 6} className="profile-label" textAnchor="middle">{t}</text>
        </g>
      ))}
      {hasEle && <text x={4} y={12} className="profile-label">{hi} m</text>}
      {points.map((p) => (
        <circle key={p.id} cx={x(p.km)} cy={hasEle ? y(eleAt(p.km)) : H - padB} r={p.starred ? 6 : p.kind === 'ort' ? 2.5 : 4} fill={p.starred ? 'var(--flag)' : KIND_COLOR[p.kind]} stroke="var(--asphalt)" strokeWidth={1}>
          <title>{`${fmtKm(kmToGo(route.lengthKm, p.km))} km to go – ${p.name}`}</title>
        </circle>
      ))}
      {currentToGo != null && <line x1={x(route.lengthKm - currentToGo)} x2={x(route.lengthKm - currentToGo)} y1={0} y2={H - padB} className="profile-now" />}
    </svg>
  );
}

function PointRow({ p, length, open, onToggle }: { p: GeoPoint; length: number; open: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);
  const wikiUrl = p.wikiTitle ? `https://${p.wikiLang ?? 'de'}.wikipedia.org/wiki/${encodeURIComponent(p.wikiTitle.replace(/ /g, '_'))}` : undefined;
  return (
    <div className={`geo-row ${p.hidden ? 'out' : ''} ${p.starred ? 'starred' : ''}`}>
      <div className="geo-km" title={`km ${fmtKm(p.km)} ab Start`}>{fmtKm(kmToGo(length, p.km))}<small>km to go</small></div>
      <div className="geo-main">
        <div className="row" style={{ gap: 6 }}>
          <span className={`chip kindchip k-${p.kind}`}>{KIND_SHORT[p.kind]}</span>
          <b className="geo-name">{p.name}</b>
          {p.description && <span className="muted small">{p.description}</span>}
          {p.offsetM != null && p.offsetM >= 400 && <span className="small muted">· {offsetText(p.offsetM)}</span>}
        </div>
        {p.summary && <div className="geo-sum">{p.summary}</div>}
        {open && (
          <div style={{ marginTop: 6 }}>
            <div className="fields">
              <label className="field">Name<CommitInput value={p.name} onCommit={(v) => v.trim() && updatePoint(p.id, { name: v.trim() })} /></label>
              <label className="field">km to go<CommitInput type="number" value={kmToGo(length, p.km)} onCommit={(v) => v !== '' && updatePoint(p.id, { km: Math.round((length - Number(v)) * 10) / 10 })} /></label>
              <label className="field">Art<select value={p.kind} onChange={(e) => updatePoint(p.id, { kind: e.target.value as GeoKind })}>{GEO_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
            </div>
            <div style={{ marginTop: 6 }}><RichField label={`Notizen ${p.name}`} value={p.notes} onSave={(h) => updatePoint(p.id, { notes: h })} placeholder="Eigene Notizen, Anekdoten, Bezug zu Fahrern …" minLines={2} /></div>
          </div>
        )}
        {!open && p.notes && <RichView value={p.notes} className="small" />}
      </div>
      <div className="geo-actions">
        <button className={`btn small ${p.starred ? 'primary' : ''}`} aria-pressed={!!p.starred} title="In LIVE hervorheben" onClick={() => updatePoint(p.id, { starred: !p.starred })}>★</button>
        <button className="btn small" onClick={onToggle} aria-expanded={open}>{open ? 'Fertig' : 'Bearbeiten'}</button>
        {!p.summary && <button className="btn small" disabled={busy} title="Kurzfassung von Wikipedia holen" onClick={async () => { setBusy(true); try { const r = await fetchSummary(p.wikiTitle ?? p.name, p.wikiLang ?? 'de'); if (r) await updatePoint(p.id, { summary: r.summary, description: p.description ?? r.description, wikiTitle: r.title, wikiLang: p.wikiLang ?? 'de' }); } finally { setBusy(false); } }}>Wikipedia</button>}
        {wikiUrl && <a className="btn small" href={wikiUrl} target="_blank" rel="noreferrer noopener" title="Artikel öffnen">W ↗</a>}
        {p.hidden ? <button className="btn small" onClick={() => updatePoint(p.id, { hidden: false })}>Einblenden</button>
          : <button className="btn small danger" title={p.source === 'wikipedia' ? 'Ausblenden' : 'Löschen'} onClick={() => removePoint(p)}>✕</button>}
      </div>
    </div>
  );
}

function AddPoint({ race, stage, length }: { race: Race; stage: Stage; length: number }) {
  const [name, setName] = useState('');
  const [toGo, setToGo] = useState('');
  const [kind, setKind] = useState<GeoKind>('anstieg');
  const [wiki, setWiki] = useState(true);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim() || toGo === '') return;
    setBusy(true);
    try {
      const km = Math.max(0, Math.round((length - Number(toGo.replace(',', '.'))) * 10) / 10);
      const lang = (await stageRoute(race.id, stage.number))?.wikiLang ?? 'de';
      const w = wiki ? await fetchSummary(name.trim(), lang).catch(() => null) : null;
      await addPoint(race.id, stage.number, { name: name.trim(), km, kind, summary: w?.summary, description: w?.description, wikiTitle: w?.title, wikiLang: w ? lang : undefined, lat: w?.lat, lon: w?.lon });
      setName(''); setToGo('');
    } finally { setBusy(false); }
  };
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <input placeholder="Eigener Punkt, z. B. Col du Pillon" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name des Punkts" style={{ width: 240 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <input type="number" placeholder="km to go" value={toGo} onChange={(e) => setToGo(e.target.value)} aria-label="km to go" style={{ width: 110 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <select value={kind} onChange={(e) => setKind(e.target.value as GeoKind)} aria-label="Art">{GEO_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
      <label className="check small"><input type="checkbox" checked={wiki} onChange={(e) => setWiki(e.target.checked)} /> Kurzfassung von Wikipedia</label>
      <button className="btn small" disabled={busy || !name.trim() || toGo === '' || !length} onClick={add} title={length ? '' : 'Zuerst Etappenlänge (km) erfassen oder Strecke laden'}>+ Punkt</button>
    </div>
  );
}

/** LIVE: Was kommt als Nächstes? Nach eingegebener Restdistanz. */
export function GeoLive({ race, stage }: { race: Race; stage: Stage }) {
  const route = useLiveQuery(() => stageRoute(race.id, stage.number), [race.id, stage.number]);
  const points = (useLiveQuery(() => stagePoints(race.id, stage.number), [race.id, stage.number]) ?? []).filter((p) => !p.hidden);
  const key = `kmToGo:${race.id}:${stage.number}`;
  const saved = useLiveQuery(() => db.device.get(key).then((r) => r?.value as number | undefined), [key]);
  const length = route?.lengthKm ?? stage.distanceKm ?? 0;
  if (!points.length && !route) return null;
  const cur = saved ?? length;
  const set = (v: number) => void setDevice(key, Math.max(0, Math.min(length || 999, Math.round(v * 10) / 10)));
  const ahead = points.filter((p) => kmToGo(length, p.km) <= cur + 0.05).sort((a, b) => a.km - b.km);
  const next = ahead.slice(0, 7);
  return (
    <div className="panel geo-live">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>An der Strecke</h2>
        <button className="btn small" onClick={() => set(cur + 1)} aria-label="1 km zurück">+1</button>
        <label className="sr-only" htmlFor="ktg">km to go</label>
        <input id="ktg" type="number" step="0.1" value={cur} onChange={(e) => set(Number(e.target.value))} style={{ width: 84, fontWeight: 700 }} />
        <span className="small muted">km to go</span>
        <button className="btn small" onClick={() => set(cur - 1)} aria-label="1 km weiter">−1</button>
      </div>
      {route && <Profile route={route} points={points} currentToGo={cur} height={90} />}
      {next.map((p, i) => {
        const d = Math.round((cur - kmToGo(length, p.km)) * 10) / 10;
        return (
          <div key={p.id} className={`geo-live-row ${p.starred ? 'starred' : ''}`}>
            <div className="row" style={{ gap: 6 }}>
              <span className="geo-live-km">{fmtKm(kmToGo(length, p.km))}</span>
              <span className={`chip kindchip k-${p.kind}`}>{KIND_SHORT[p.kind]}</span>
              <b>{p.name}</b>
              <span className="muted small">{d <= 0.05 ? 'jetzt' : `in ${fmtKm(d)} km`}</span>
            </div>
            {(i < 2 || p.starred) && p.summary && <div className="small">{p.summary}</div>}
            {(i < 2 || p.starred) && p.notes && <RichView value={p.notes} className="small" />}
          </div>
        );
      })}
      {!next.length && <p className="muted small">Keine weiteren Punkte bis ins Ziel.</p>}
    </div>
  );
}
