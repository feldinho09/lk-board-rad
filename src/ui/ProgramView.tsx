import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Race, RundownRow, Stage } from '../domain/types';
import { addRow, copyRundown, currentRow, fillTimes, fmtDur, moveRow, normTime, parseDuration, parseRundownTable, pasteRows, removeRow, rundownRows, toMin, updateRow } from '../domain/rundown';
import { updateStage } from '../domain/center';
import { CommitInput, CommitTextarea, useNow } from './inputs';
import { confirmDialog } from './dialogs';
import { stageLabel, useCurrent } from './state';
import { createRestorePoint } from '../backup/archive';

/** SRF-Programm: Sendeablauf der aktuellen Sendung (je Etappe) als Tabelle. */
export function ProgramView() {
  const cur = useCurrent();
  if (!cur.ready) return null;
  if (!cur.race || !cur.stage) return <main><div className="panel empty-state">Zuerst unter <a href="#rennen">Rennen</a> ein Rennen anlegen.</div></main>;
  return <Program race={cur.race} stage={cur.stage} stages={cur.stages} />;
}

function Program({ race, stage, stages }: { race: Race; stage: Stage; stages: Stage[] }) {
  const rows = useLiveQuery(() => rundownRows(race.id, stage.number), [race.id, stage.number]) ?? [];
  const now = useNow(10000);
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const { current, next, nextInMin } = currentRow(rows, nowMin);
  const [paste, setPaste] = useState(false);
  const [msg, setMsg] = useState('');
  const b = stage.broadcast ?? {};
  const setB = (patch: Partial<NonNullable<Stage['broadcast']>>) => updateStage(stage.id, { broadcast: { ...b, ...patch } });
  const total = rows.reduce((a, r) => a + (r.durationMin ?? 0), 0);
  const windowMin = b.start && b.end ? toMin(b.end) - toMin(b.start) : undefined;

  return (
    <main>
      <div className="panel">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>SRF-Programm · {race.name} {race.year} · {stageLabel(stage, race.kind)}</h2>
          <span className="clock" aria-label="Uhrzeit">{now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="fields" style={{ marginTop: 10 }}>
          <label className="field">Sendung<CommitInput value={b.title} placeholder="Rad: Tour de Suisse, 5. Etappe" onCommit={(v) => setB({ title: v.trim() || undefined })} /></label>
          <label className="field">Sender<CommitInput value={b.channel} placeholder="SRF zwei" onCommit={(v) => setB({ channel: v.trim() || undefined })} /></label>
          <label className="field">Beginn<CommitInput value={b.start} placeholder="14:00" onCommit={(v) => setB({ start: normTime(v) })} /></label>
          <label className="field">Ende<CommitInput value={b.end} placeholder="17:30" onCommit={(v) => setB({ end: normTime(v) })} /></label>
        </div>
        <label className="field" style={{ marginTop: 8 }}>Hinweise zur Sendung (Regie, Schaltungen, Gäste)
          <CommitTextarea value={b.notes} onCommit={(v) => setB({ notes: v.trim() || undefined })} />
        </label>
        {(current || next) && (
          <div className="onair">
            {current && <div><span className="onair-tag">JETZT</span> <b>{current.item}</b>{current.content ? <span className="muted"> – {current.content}</span> : null}</div>}
            {next && <div><span className="onair-tag next">DANACH</span> <b>{next.item}</b> <span className="muted">um {next.time}{nextInMin != null ? ` · in ${Math.max(0, Math.round(nextInMin))}'` : ''}</span></div>}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="row">
          <button className="btn small primary" onClick={() => addRow(race.id, stage.number)}>+ Zeile</button>
          <button className="btn small" onClick={() => setPaste(!paste)}>Aus Excel/Word einfügen …</button>
          <button className="btn small" disabled={!rows.length} title="Uhrzeiten aus der ersten Zeit und den Dauern fortschreiben (leere Zeiten)" onClick={async () => { try { const n = await fillTimes(race.id, stage.number, false); setMsg(`${n} Zeiten berechnet.`); } catch (e) { setMsg((e as Error).message); } }}>Zeiten aus Dauern</button>
          {stages.length > 1 && (
            <select aria-label="Ablauf übernehmen von" value="" onChange={async (e) => { const n = Number(e.target.value); if (Number.isFinite(n) && e.target.value !== '') { const k = await copyRundown(race.id, n, stage.number); setMsg(`${k} Zeilen von ${stageLabel({ number: n })} übernommen.`); } }}>
              <option value="">Ablauf übernehmen von …</option>
              {stages.filter((s) => s.number !== stage.number).map((s) => <option key={s.id} value={s.number}>{stageLabel(s)}</option>)}
            </select>
          )}
          <span className="grow" />
          <span className="small muted">{rows.length} Zeilen · Summe {fmtDur(Math.round(total * 100) / 100) || "0'"}{windowMin != null ? ` von ${windowMin}' Sendezeit` : ''}{windowMin != null && Math.abs(total - windowMin) >= 1 ? <b className={total > windowMin ? 'err' : 'warn'}> ({total > windowMin ? '+' : ''}{Math.round(total - windowMin)}')</b> : null}</span>
        </div>
        {msg && <p className="small okc">{msg}</p>}
        {paste && <PasteBox race={race} stage={stage} hasRows={rows.length > 0} onDone={(m) => { setPaste(false); setMsg(m); }} />}
        <table className="tbl rundown" style={{ marginTop: 8 }}>
          <thead><tr><th style={{ width: 80 }}>Zeit</th><th style={{ width: 70 }}>Dauer</th><th style={{ width: '22%' }}>Element</th><th>Inhalt</th><th style={{ width: '14%' }}>Wer</th><th style={{ width: 34 }} title="erledigt">✓</th><th style={{ width: 120 }} /></tr></thead>
          <tbody>
            {rows.map((r) => <Row key={r.id} r={r} race={race} stage={stage} live={r.id === current?.id} />)}
          </tbody>
        </table>
        {!rows.length && <p className="muted">Noch kein Ablauf. Lege Zeilen an oder füge den Sendeablauf aus Excel/Word ein (Spalten Zeit, Dauer, Element, Inhalt, Wer – mit oder ohne Kopfzeile).</p>}
      </div>
    </main>
  );
}

function Row({ r, race, stage, live }: { r: RundownRow; race: Race; stage: Stage; live: boolean }) {
  return (
    <tr className={`${live ? 'live-row' : ''} ${r.done ? 'out' : ''}`}>
      <td><CommitInput value={r.time} style={{ width: 70 }} aria-label="Zeit" onCommit={(v) => updateRow(r.id, { time: normTime(v) })} /></td>
      <td><CommitInput value={r.durationMin != null ? fmtDur(r.durationMin) : ''} style={{ width: 60 }} aria-label="Dauer" onCommit={(v) => updateRow(r.id, { durationMin: parseDuration(v) })} /></td>
      <td><CommitTextarea value={r.item} aria-label="Element" className="cell" onCommit={(v) => updateRow(r.id, { item: v.trim() })} /></td>
      <td><CommitTextarea value={r.content} aria-label="Inhalt" className="cell" onCommit={(v) => updateRow(r.id, { content: v.trim() || undefined })} /></td>
      <td><CommitTextarea value={r.who} aria-label="Wer" className="cell" onCommit={(v) => updateRow(r.id, { who: v.trim() || undefined })} /></td>
      <td><input type="checkbox" checked={!!r.done} onChange={(e) => updateRow(r.id, { done: e.target.checked })} aria-label="erledigt" /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn small" title="nach oben" aria-label="nach oben" onClick={() => moveRow(race.id, stage.number, r.id, -1)}>↑</button>{' '}
        <button className="btn small" title="nach unten" aria-label="nach unten" onClick={() => moveRow(race.id, stage.number, r.id, 1)}>↓</button>{' '}
        <button className="btn small" title="Zeile darunter einfügen" aria-label="Zeile darunter einfügen" onClick={() => addRow(race.id, stage.number, {}, r.order)}>+</button>{' '}
        <button className="btn small danger" title="Zeile löschen" aria-label="Zeile löschen" onClick={async () => { if (!r.item && !r.content || await confirmDialog(`Zeile „${r.item || r.time}“ löschen?`, 'Löschen')) await removeRow(r.id); }}>✕</button>
      </td>
    </tr>
  );
}

function PasteBox({ race, stage, hasRows, onDone }: { race: Race; stage: Stage; hasRows: boolean; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const parsed = text.trim() ? parseRundownTable(text) : [];
  return (
    <div className="banner">
      <p className="small" style={{ marginTop: 0 }}>Tabelle in Excel, Word oder der Mail markieren, kopieren und hier einfügen. Erkannt werden Spalten wie <i>Zeit, Dauer, Element/Beitrag, Inhalt/Bemerkung, Wer/Sprecher</i>; ohne Kopfzeile gilt diese Reihenfolge.</p>
      <textarea rows={5} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Sendeablauf einfügen" placeholder={'14:00\t2\'\tOpener\tBilder Start\tSRF\n14:02\t5\'\tLive Strecke\tAusreisser\tKommentar'} autoFocus />
      {parsed.length > 0 && <p className="small">Erkannt: <b>{parsed.length} Zeilen</b>, z. B. „{[parsed[0].time, parsed[0].item, parsed[0].content].filter(Boolean).join(' · ')}“</p>}
      {hasRows && <label className="check small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> bestehenden Ablauf ersetzen (sonst wird angehängt)</label>}
      <div className="row">
        <button className="btn small primary" disabled={!parsed.length} onClick={async () => { if (replace) await createRestorePoint('Vor Ersetzen des SRF-Programms'); const n = await pasteRows(race.id, stage.number, text, replace); onDone(`${n} Zeilen eingefügt.`); }}>Einfügen</button>
        <button className="btn small" onClick={() => onDone('')}>Abbrechen</button>
      </div>
    </div>
  );
}

/** Kompakte Anzeige für LIVE: jetzt / danach mit Countdown. */
export function OnAir({ race, stage }: { race: Race; stage: Stage }) {
  const rows = useLiveQuery(() => rundownRows(race.id, stage.number), [race.id, stage.number]) ?? [];
  const now = useNow(10000);
  if (!rows.length) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const { current, next, nextInMin } = currentRow(rows, nowMin);
  return (
    <div className="panel onair-panel">
      <div className="row"><h2 className="grow" style={{ margin: 0 }}>Sendung</h2><span className="clock small">{now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</span><a href="#programm" className="small">Ablauf</a></div>
      {current ? <div><span className="onair-tag">JETZT</span> <b>{current.item}</b>{current.who ? <span className="muted"> · {current.who}</span> : null}{current.content ? <div className="small">{current.content}</div> : null}</div> : <p className="muted small">Sendung noch nicht begonnen.</p>}
      {next && <div style={{ marginTop: 6 }}><span className="onair-tag next">{nextInMin != null ? `IN ${Math.max(0, Math.round(nextInMin))}'` : 'DANACH'}</span> <b>{next.item}</b> <span className="muted small">{next.time}</span></div>}
    </div>
  );
}
