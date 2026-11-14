/**
 * Service-Worker-Anbindung. Ein neues App-Update wird nur VORBEREITET.
 * Aktiviert wird es ausschließlich durch eine Nutzeraktion außerhalb des Live-Modus
 * (kein erzwungener Reload, Bauplan 10 / Abnahme Nr. 25).
 */
type SwState = { supported: boolean; controlled: boolean; updateWaiting: boolean; error?: string };
let state: SwState = { supported: 'serviceWorker' in navigator, controlled: false, updateWaiting: false };
const listeners = new Set<(s: SwState) => void>();
let registration: ServiceWorkerRegistration | null = null;

function emit(patch: Partial<SwState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function onSwState(l: (s: SwState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV || import.meta.env.MODE === 'artifact') return;
  emit({ controlled: !!navigator.serviceWorker.controller });
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) emit({ updateWaiting: true });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed') {
            if (navigator.serviceWorker.controller) emit({ updateWaiting: true });
            else emit({ controlled: true });
          }
        });
      });
      // Auch bei lange offenem Tab regelmässig nach einer neuen Version sehen
      const check = () => { if (navigator.onLine) reg.update().catch(() => undefined); };
      setInterval(check, 15 * 60_000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      window.addEventListener('online', check);
      return navigator.serviceWorker.ready;
    })
    .then(() => emit({ controlled: true }))
    .catch((e) => emit({ error: String(e) }));
}

/** Nur auf ausdrücklichen Wunsch und nicht im Live-Modus aufrufen. */
export function applyUpdate(): void {
  const w = registration?.waiting;
  if (!w) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  w.postMessage({ type: 'SKIP_WAITING' });
}
