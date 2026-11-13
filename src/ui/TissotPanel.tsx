import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, setDevice } from '../db/db';
import { CLASSIFICATION_LABEL, type ClassificationKind, type Edition } from '../domain/types';
import { useApp } from './state';
import { confirmDialog } from './dialogs';
import {
  competitionId, getTeams, latestStartedStage, listRoadRaces, listStages, teamsToMatrix, tissotFetcher, tissotPageUrl,
  type TtCompetition, type TtStage,
} from '../import/tissot';
import {
  createEditionFromTissot, enrichRidersFromTissot, linkEditionToTissot, syncTissotStage, type EnrichOptions, type EnrichResult, type SyncReport,
} from '../import/tissotCommit';

export const TISSOT_AUTO_KEY = 'tissotAuto';
export interface TissotAutoSetting { editionId: string; enabled: boolean; minutes: number }
export interface TissotAutoState { at: string; ok: boolean; message: string }
export const TISSOT_AUTO_STATE = 'tissotAutoState';

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tissot Timing: Rennen wählen, Startliste laden, Ergebnisse holen, Fahrerdaten ergänzen, Auto-Aktualisierung. */
export function TissotPanel({ editionId, onStartlist }: { editionId: string; onStartlist: (matrix: string[][], name: string) => void }) {
  const app = useApp();
  const edition = useLiveQuery(() => (editionId ? db.editions.get(editionId) : undefined), [editionId]);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [races, setRaces] = useState<TtCompetition[] | null>(null);
  const [code, setCode] = useState('');
  const [stages, setStages] = useState<TtStage[]>([]);
  const [stageNo, setStageNo] = useState<number | ''>('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<SyncReport | null>(null);
  const [enrich, setEnrich] = useState<EnrichOptions>({ birthDates: true, places: true, accents: true, nationality: true });
  const [enrichRes, setEnrichRes] = useState<EnrichResult | null>(null);
  const [relink, setRelink] = useState(false);
  const auto = useLiveQuery(() => db.device.get(TISSOT_AUTO_KEY).then((r) => r?.value as TissotAutoSetting | undefined), []);
  const autoState = useLiveQuery(() => db.device.get(TISSOT_AUTO_STATE).then((r) => r?.value as TissotAutoState | undefined), []);

  const linked = edition?.tissot;
  const race = races?.find((r) => r.code === code);

  // Verknüpftes Rennen: Etappen automatisch laden
  useEffect(() => {
    setStages([]); setStageNo(''); setReport(null); setEnrichRes(null);
    if (!linked) return;
    let stop = false;
    void listStages(linked.id).then((s) => {
      if (stop) return;
      setStages(s);
      setStageNo((latestStartedStage(s) ?? s[0])?.number ?? '');
    }).catch((e) => !stop && setError(err(e)));
    return () => { stop = true; };
  }, [linked?.id]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(''); setMsg('');
    try { await fn(); } catch (e) { setError(err(e)); }
    setBusy('');
  };

  const loadRaces = () => run('Rennen werden geladen …', async () => { setRaces(await listRoadRaces(year)); setCode(''); });

  const createNew = () => run('Rennen wird angelegt …', async () => {
    if (!race) return;
    const id = competitionId(race.code, year);
    const exists = alive(await db.editions.toArray()).find((e) => e.tissot?.id === id);
    if (exists && !(await confirmDialog(`„${exists.name}“ ist bereits mit diesem Tissot-Rennen verknüpft. Trotzdem ein zweites Rennen anlegen?`, 'Neu anlegen'))) return;
    const st = await listStages(id);
    const newId = await createEditionFromTissot(race, year, st);
    app.setEdition(newId);
    setMsg(`Rennen „${race.name} ${year}“ mit ${st.length} ${st.length === 1 ? 'Lauf' : 'Etappen'} angelegt. Als Nächstes die Startliste laden.`);
  });

  const linkExisting = () => run('Verknüpfung …', async () => {
    if (!race || !editionId) return;
    const added = await linkEditionToTissot(editionId, race, year, await listStages(competitionId(race.code, year)));
    setRelink(false);
    setMsg(`Verknüpft.${added ? ` ${added} fehlende Etappen ergänzt.` : ''}`);
  });

  const loadStartlist = () => run('Startliste wird geladen …', async () => {
    if (!linked || stageNo === '') return;
    const teams = await getTeams(linked.id, stageNo);
    if (!teams.length) throw new Error('Tissot führt für diese Etappe (noch) keine Startliste.');
    const m = teamsToMatrix(teams);
    onStartlist(m, `Tissot Timing: ${edition?.name ?? linked.id}${stages.length > 1 ? `, Etappe ${stageNo}` : ''}`);
    setMsg(`${m.length - 1} Fahrer in ${teams.length} Teams geladen – unten prüfen, abgleichen und übernehmen.`);
  });

  const fetchResults = () => run('Ergebnisse werden geholt …', async () => {
    if (!linked || stageNo === '') return;
    const r = await syncTissotStage(editionId, linked.id, stageNo);
    setReport(r);
    if (!r.items.length) setMsg('Für diese Etappe liegen bei Tissot noch keine Ergebnisse vor.');
  });

  const runEnrich = () => run('Fahrerdaten …', async () => {
    if (!linked) return;
    setEnrichRes(await enrichRidersFromTissot(editionId, linked.id, enrich, (d, t) => setBusy(`Fahrerdaten: ${d} von ${t} …`)));
  });

  const setAuto = (patch: Partial<TissotAutoSetting>) =>
    void setDevice(TISSOT_AUTO_KEY, { enabled: false, minutes: 5, ...(auto?.editionId === editionId ? auto : {}), ...patch, editionId });
  const autoOn = auto?.enabled && auto.editionId === editionId;

  return (
    <fieldset className="form tissot">
      <legend>Tissot Timing – automatischer Abruf</legend>
      <p className="wide small muted">Offizielle Zeitnahme (Tour de France, Vuelta, Paris–Nice, Tour de Suisse, Romandie, Klassiker der ASO u. a.). Daten kommen direkt von Tissot; jede Übernahme läuft durch dieselben Prüfungen wie ein Datei-Import.</p>
      {!editionId && <p className="wide">Kein Rennen gewählt: unten ein Tissot-Rennen auswählen und als neues Rennen anlegen.</p>}

      {linked ? (
        <div className="wide">
          Verknüpft mit <strong>{linked.id}</strong> · <a href={tissotPageUrl(linked.code, linked.year)} target="_blank" rel="noreferrer noopener">auf tissottiming.com ansehen</a>
          {' · '}<button className="link" onClick={() => setRelink(true)}>andere Verknüpfung …</button>
        </div>
      ) : null}

      {(!linked || relink) && (
        <div className="wide row" style={{ margin: 0 }}>
          <label>Jahr <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setRaces(null); }}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y}>{y}</option>)}
          </select></label>
          <button onClick={loadRaces} disabled={!!busy}>Rennen von Tissot laden</button>
          {races && (
            <label>Rennen <select value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">– wählen ({races.length}) –</option>
              {races.map((r) => <option key={r.code} value={r.code}>{r.start.slice(5).split('-').reverse().join('.')} · {r.name}{r.type === 'GrandTour' ? '' : ' (Eintagesrennen)'}</option>)}
            </select></label>
          )}
          {race && <button onClick={createNew} disabled={!!busy}>Als neues Rennen anlegen</button>}
          {race && editionId && <button onClick={linkExisting} disabled={!!busy}>Mit „{edition?.name}“ verknüpfen</button>}
        </div>
      )}

      {linked && stages.length > 0 && (
        <>
          <label>{stages.length > 1 ? 'Etappe' : 'Lauf'}
            <select value={stageNo} onChange={(e) => { setStageNo(Number(e.target.value)); setReport(null); }}>
              {stages.map((s) => <option key={s.number} value={s.number}>{stages.length > 1 ? `${s.number} · ` : ''}{s.name}{s.start ? ` · ${s.start.slice(8, 10)}.${s.start.slice(5, 7)}.` : ''}</option>)}
            </select>
          </label>
          <div className="wide row" style={{ margin: 0 }}>
            <button onClick={loadStartlist} disabled={!!busy}>Startliste laden (zur Prüfung)</button>
            <button onClick={fetchResults} disabled={!!busy}>Ergebnisse und Wertungen holen</button>
          </div>

          <div className="wide row" style={{ margin: 0 }}>
            <strong>Fahrerdaten ergänzen</strong>
            <label className="confirm"><input type="checkbox" checked={enrich.birthDates} onChange={(e) => setEnrich({ ...enrich, birthDates: e.target.checked })} /> Geburtsdatum</label>
            <label className="confirm"><input type="checkbox" checked={enrich.places} onChange={(e) => setEnrich({ ...enrich, places: e.target.checked })} /> Geburtsort</label>
            <label className="confirm"><input type="checkbox" checked={enrich.nationality} onChange={(e) => setEnrich({ ...enrich, nationality: e.target.checked })} /> Nation</label>
            <label className="confirm"><input type="checkbox" checked={enrich.accents} onChange={(e) => setEnrich({ ...enrich, accents: e.target.checked })} /> Schreibweise mit Akzenten (Pogačar statt Pogacar)</label>
            <button onClick={runEnrich} disabled={!!busy}>Ergänzen</button>
          </div>
          <p className="wide small muted">Füllt nur leere Felder; vorhandene Angaben bleiben. Vorher entsteht ein Wiederherstellungspunkt. Dauert bei 180 Fahrern etwa eine Minute.</p>

          <div className="wide row" style={{ margin: 0 }}>
            <label className="confirm"><input type="checkbox" checked={!!autoOn} onChange={(e) => setAuto({ enabled: e.target.checked })} />
              <strong>Automatisch aktualisieren</strong>, solange das LK Board offen ist – alle</label>
            <select aria-label="Intervall" value={auto?.editionId === editionId ? auto.minutes : 5} onChange={(e) => setAuto({ minutes: Number(e.target.value) })}>
              {[2, 5, 10, 15].map((m) => <option key={m} value={m}>{m} Minuten</option>)}
            </select>
          </div>
          <p className="wide small muted">Holt jeweils die laufende bzw. zuletzt gestartete Etappe. Neue Stände erscheinen im Live-Modus als „Neuer Stand verfügbar“ und ersetzen nie die gerade gelesene Liste. Unveränderte Daten werden nicht doppelt gespeichert.
            {autoOn && autoState && <> Letzter Abruf: <span className={autoState.ok ? '' : 'warn'}>{new Date(autoState.at).toLocaleTimeString('de-CH')} – {autoState.message}</span></>}</p>
        </>
      )}

      {busy && <div className="wide banner warn" role="status" style={{ margin: 0 }}>{busy}</div>}
      {msg && <div className="wide banner ok" style={{ margin: 0 }}>{msg}</div>}
      {error && <div className="wide banner err" role="alert" style={{ margin: 0 }}>{error}</div>}
      {report && report.items.length > 0 && <ReportTable report={report} />}
      {enrichRes && (
        <div className="wide banner ok" style={{ margin: 0 }}>
          {enrichRes.checked} Fahrer bei Tissot nachgeschlagen, {enrichRes.updated} Profile ergänzt.
          {enrichRes.uciAdded > 0 && ` ${enrichRes.uciAdded} UCI-IDs über eindeutige Namen zugeordnet.`}
          {enrichRes.withoutUci > 0 && ` ${enrichRes.withoutUci} ohne UCI-ID (nicht in der Tissot-Startliste gefunden).`}
          {enrichRes.failed.length > 0 && <div className="warn small">Nicht möglich: {enrichRes.failed.slice(0, 6).join(', ')}{enrichRes.failed.length > 6 ? ' …' : ''}</div>}
        </div>
      )}
    </fieldset>
  );
}

function ReportTable({ report }: { report: SyncReport }) {
  return (
    <div className="wide">
      <table className="table compact">
        <thead><tr><th>{report.stageLabel}</th><th>Zeilen</th><th>Ergebnis</th><th>ohne Zuordnung</th></tr></thead>
        <tbody>
          {report.items.map((i) => (
            <tr key={i.kind}>
              <td>{CLASSIFICATION_LABEL[i.kind as ClassificationKind]}</td><td>{i.rows}</td>
              <td>{i.result.outcome === 'gespeichert' ? `neu gespeichert (Revision ${i.result.revision})` : `unverändert (Revision ${i.result.revision})`}</td>
              <td className={i.unresolved ? 'warn' : 'muted'}>{i.unresolved || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.statusUpdates > 0 && <p className="small">{report.statusUpdates} Ausfälle (DNF/DNS/OTL) in den Teilnehmerstatus übernommen.</p>}
      {report.items.some((i) => i.unresolved) && <p className="small warn">Fahrer ohne Zuordnung bleiben mit Tissot-Namen in der Rangliste. Abhilfe: Startliste von Tissot importieren.</p>}
    </div>
  );
}

/**
 * Automatische Aktualisierung im Hintergrund (App-weit, auch im Live-Modus).
 * Schonend: nur bei eingeschaltetem Schalter, nur für das verknüpfte Rennen, nur während
 * der Renntage; bei Fehlern wird das Intervall bis 30 Minuten verlängert.
 */
export function useTissotAutoSync() {
  const auto = useLiveQuery(() => db.device.get(TISSOT_AUTO_KEY).then((r) => r?.value as TissotAutoSetting | undefined), []);
  useEffect(() => {
    if (!auto?.enabled) return;
    let stop = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let state: TissotAutoState;
      try {
        const ed = (await db.editions.get(auto.editionId)) as Edition | undefined;
        if (!ed || ed.deleted || !ed.tissot) throw new Error('Rennen nicht (mehr) mit Tissot verknüpft');
        const stages = await listStages(ed.tissot.id, tissotFetcher);
        const st = latestStartedStage(stages);
        const last = stages[stages.length - 1];
        if (!st) state = { at: new Date().toISOString(), ok: true, message: 'Rennen hat noch nicht begonnen' };
        else if (last?.start && Date.now() - new Date(last.start).getTime() > 36 * 3600_000) {
          state = { at: new Date().toISOString(), ok: true, message: 'Rennen beendet – automatische Aktualisierung pausiert' };
        } else {
          const r = await syncTissotStage(ed.id, ed.tissot.id, st.number);
          const neu = r.items.filter((i) => i.result.outcome === 'gespeichert').map((i) => CLASSIFICATION_LABEL[i.kind as ClassificationKind]);
          state = { at: r.at, ok: true, message: `${r.stageLabel}: ${neu.length ? `neu – ${neu.join(', ')}` : r.items.length ? 'keine Änderung' : 'noch keine Ergebnisse'}${r.statusUpdates ? `, ${r.statusUpdates} Ausfälle` : ''}` };
        }
        failures = 0;
      } catch (e) {
        failures++;
        state = { at: new Date().toISOString(), ok: false, message: err(e) };
      }
      if (stop) return;
      await setDevice(TISSOT_AUTO_STATE, state);
      const base = Math.max(2, auto.minutes) * 60_000;
      timer = setTimeout(tick, Math.min(30 * 60_000, base * 2 ** Math.min(failures, 4)));
    };
    timer = setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(timer); };
  }, [auto?.enabled, auto?.editionId, auto?.minutes]);
}

/** Kleine Statusanzeige im Kopf, wenn die automatische Aktualisierung läuft. */
export function TissotBadge() {
  const auto = useLiveQuery(() => db.device.get(TISSOT_AUTO_KEY).then((r) => r?.value as TissotAutoSetting | undefined), []);
  const s = useLiveQuery(() => db.device.get(TISSOT_AUTO_STATE).then((r) => r?.value as TissotAutoState | undefined), []);
  if (!auto?.enabled) return null;
  return (
    <span className={`badge ${s && !s.ok ? 'warn' : 'ok'}`} title={s ? `${new Date(s.at).toLocaleTimeString('de-CH')}: ${s.message}` : 'Erster Abruf läuft gleich'}>
      Tissot {s ? new Date(s.at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '…'}{s && !s.ok ? ' ⚠' : ''}
    </span>
  );
}

