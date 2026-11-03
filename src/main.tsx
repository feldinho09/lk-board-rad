import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/swClient';
import './ui/styles.css';

registerServiceWorker();

// Testanbindung für automatisierte Abnahmetests (nur mit ?testhooks in der Adresse)
if (location.search.includes('testhooks')) {
  void Promise.all([import('./db/db'), import('./domain/search')]).then(([dbm, s]) => {
    (window as unknown as Record<string, unknown>).__lk = { db: dbm.db, mutate: dbm.mutate, newRecord: dbm.newRecord, search: s.search };
  });
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
