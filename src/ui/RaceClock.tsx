import { useEffect, useState } from 'react';
import { getDevice, setDevice } from '../db/db';
import { formatDuration } from '../domain/text';
import { confirmDialog, promptDialog } from './dialogs';

/**
 * Rennuhr: Start/Pause/Korrektur. Zustand wird bei jeder Aktion gespeichert
 * und nach Neustart aus Startzeitpunkt + akkumulierter Zeit wiederhergestellt
 * (Wanduhr-basiert, keine Abhängigkeit von laufenden Timern).
 */
interface ClockState { running: boolean; startedAt: number | null; accumulatedMs: number }
const INITIAL: ClockState = { running: false, startedAt: null, accumulatedMs: 0 };

export function raceClockSeconds(s: ClockState, now = Date.now()): number {
  return Math.floor((s.accumulatedMs + (s.running && s.startedAt ? now - s.startedAt : 0)) / 1000);
}

let current: ClockState = INITIAL;
export function currentRaceClockSec(): number | undefined {
  const sec = raceClockSeconds(current);
  return sec > 0 ? sec : undefined;
}

export function RaceClock() {
  const [s, setS] = useState<ClockState>(INITIAL);
  const [, tick] = useState(0);
  useEffect(() => { getDevice('raceClock', INITIAL).then((v) => { current = v; setS(v); }); }, []);
  useEffect(() => {
    if (!s.running) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [s.running]);
  const save = (n: ClockState) => { current = n; setS(n); void setDevice('raceClock', n); };
  const toggle = () => {
    if (s.running) save({ running: false, startedAt: null, accumulatedMs: s.accumulatedMs + (Date.now() - (s.startedAt ?? Date.now())) });
    else save({ ...s, running: true, startedAt: Date.now() });
  };
  const correct = async () => {
    const v = await promptDialog('Rennzeit korrigieren (h:mm:ss)', formatDuration(raceClockSeconds(s)));
    if (!v) return;
    const parts = v.split(':').map(Number);
    if (parts.some(isNaN)) { await confirmDialog('Ungültige Zeit – erwartet h:mm:ss'); return; }
    const sec = parts.reduce((a, p) => a * 60 + p, 0);
    save({ running: s.running, startedAt: s.running ? Date.now() : null, accumulatedMs: sec * 1000 });
  };
  const reset = async () => { if (await confirmDialog('Rennuhr auf 0 zurücksetzen?', 'Zurücksetzen')) save(INITIAL); };
  return (
    <div className="clock" title="Rennzeit (nicht Tageszeit)">
      <span className="clock-label">Rennzeit</span>
      <span className="clock-value">{formatDuration(raceClockSeconds(s))}</span>
      <button onClick={toggle} aria-label={s.running ? 'Rennuhr pausieren' : 'Rennuhr starten'}>{s.running ? '❚❚' : '▶'}</button>
      <button onClick={correct} aria-label="Rennzeit korrigieren">±</button>
      <button onClick={reset} aria-label="Rennuhr zurücksetzen">⟲</button>
    </div>
  );
}
