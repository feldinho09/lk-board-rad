import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Erzeugt dist/sw.js aus src/sw-template.js und trägt die Liste aller
 * Build-Dateien als Precache-Manifest ein. Keine Laufzeit-Abhängigkeit
 * (kein Workbox), damit der Offline-Vertrag vollständig im Repo nachvollziehbar ist.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'lk-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = readdirSync('public').filter((f) => !f.startsWith('_'));
      const assets = ['./', './index.html', ...files.filter((f) => f !== 'index.html').map((f) => './' + f), ...publicFiles.map((f) => './' + f)];
      const hash = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const template = readFileSync('src/sw-template.js', 'utf8');
      const source = template
        .replace('__PRECACHE__', JSON.stringify(assets))
        .replace('__VERSION__', hash);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Artefakt-Build: Plattform setzt eigene CSP und stellt window.claude bereit – keine eigene CSP, kein SW, kein Manifest. */
function artifactHtml(): Plugin {
  return {
    name: 'lk-artifact-html',
    transformIndexHtml: (html) =>
      html
        .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
        .replace(/\s*<link rel="manifest"[^>]*>/, '')
        .replace(/\s*<link rel="icon"[^>]*>/, ''),
  };
}

// Versionskennung: kurzer Git-Stand + Build-Datum, sichtbar in der App (Fehlersuche: „welche Version läuft?“)
function buildId(): string {
  let rev = 'lokal';
  try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* ohne Git */ }
  return `${rev} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig(({ mode }) => ({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  base: './',
  plugins: mode === 'artifact' ? [react(), artifactHtml()] : [react(), serviceWorkerPlugin()],
  publicDir: mode === 'artifact' ? false : 'public',
  build: { sourcemap: false, target: 'es2022', outDir: mode === 'artifact' ? 'dist-artifact' : 'dist' },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    // PDF-Erzeugung und IndexedDB-Simulation brauchen bei parallelen Läufen mehr als 5 s
    testTimeout: 30000,
  },
}));
