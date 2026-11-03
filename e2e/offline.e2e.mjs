/**
 * Browser-Abnahmetests (Chromium via Playwright) gegen den Produktions-Build.
 *   npm run build && npm run e2e
 * Prüft u. a. Abnahme Nr. 1, 2, 5, 17 (Messung), 18, 23, 27 sowie den Restore-Weg.
 * Ergebnisse: e2e/results.json, Screenshots in e2e/screens/.
 */
import { createRequire } from 'node:module';
// Playwright: lokal `npm i -D playwright && npx playwright install chromium`
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4173;
const URL = `http://localhost:${PORT}/?testhooks`;
const results = [];
const screens = 'e2e/screens';
mkdirSync(screens, { recursive: true });
let failShot = 0;
const check = (nr, name, ok, detail = '') => {
  results.push({ nr, name, ok, detail });
  if (!ok && globalThis.__page) globalThis.__page.screenshot({ path: `${screens}/fehler-${++failShot}.png` }).catch(() => {});
  console.log(`${ok ? 'BESTANDEN' : 'FEHLER   '}  [${nr}] ${name}${detail ? ' – ' + detail : ''}`);
};

function startServer() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  return new Promise((res) => {
    p.stdout.on('data', (d) => { if (String(d).includes('localhost')) res(p); });
    setTimeout(() => res(p), 5000);
  });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'lk-e2e-'));
const launch = () => chromium.launchPersistentContext(userDataDir, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });

let server = await startServer();
let ctx = await launch();
let page = ctx.pages()[0] ?? (await ctx.newPage());
globalThis.__page = page;
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

try {
  // --- Vorbereitung online
  await page.goto(URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('Vorb.', 'Service Worker kontrolliert die Seite', controlled);

  await page.goto(URL + '#rennen');
  await page.getByRole('button', { name: /Demo-Rundfahrt laden/ }).click();
  await page.waitForSelector('text=DEMO-RENNEN');

  // Neues Eintagesrennen + Import mit 007, Akzenten, Namensgleichheit
  await page.getByLabel('Name').first().fill('Testkriterium 2026');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#import');
  await page.locator('fieldset select').first().selectOption({ label: 'Testkriterium 2026' });
  const csv = 'Nr\tVorname\tNachname\tTeam\tNation\n007\tLars\tØvrebø\tNordlys Cycling\tNOR\n12\tLuca\tBianchi\tSquadra Fiume\tITA\n13\tNeu\tFahrerin\tTeam X\tSUI\n';
  await page.getByPlaceholder(/Aus Excel/).fill(csv);
  await page.getByRole('button', { name: 'Eingefügte Tabelle laden' }).click();
  await page.getByRole('button', { name: /Abgleichen/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr td:nth-child(5) .badge').length === 3);
  const statuses = await page.$$eval('tbody tr td:nth-child(5) .badge', (els) => els.map((e) => e.textContent));
  check(5, 'Import: Akzent-Fahrer zugeordnet, namensgleicher Bianchi mehrdeutig, neue Person neu',
    statuses[0] === 'eindeutig zugeordnet' && statuses[1].startsWith('mehrdeutig') && statuses[2] === 'neu', statuses.join(' | '));
  await page.screenshot({ path: `${screens}/import-abgleich.png`, fullPage: true });
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  const bibs = await page.evaluate(async () => {
    const { db } = window.__lk;
    const eds = await db.editions.toArray();
    const ed = eds.find((e) => e.name === 'Testkriterium 2026');
    return (await db.participations.where('editionId').equals(ed.id).toArray()).map((p) => p.bib).sort();
  });
  check(5, 'Startnummer 007 bleibt 007; zurückgestellte Zeile nicht still übernommen', JSON.stringify(bibs) === '["007","13"]', JSON.stringify(bibs));

  // Link-Import (Nr. 5/7): simulierte Veranstalter-Seite mit CORS-Freigabe, liefert ein PDF
  await page.route('https://veranstalter.example/**', (route) => route.fulfill({
    status: 200, headers: { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' },
    body: readFileSync('src/import/fixtures/startliste-tabelle.pdf'),
  }));
  await page.goto(URL + '#/rennen');
  await page.getByLabel('Name').first().fill('Link-Rennen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#/import');
  await page.locator('fieldset select').first().selectOption({ label: 'Link-Rennen' });
  await page.getByLabel('Link zur Startliste').fill('https://www.procyclingstats.com/race/x/2026/startlist');
  await page.getByRole('button', { name: 'Link laden' }).click();
  const pcsMsg = await page.locator('.banner.err').textContent();
  check('7a', 'ProCyclingStats-Link wird ohne autorisierten Zugang nicht abgerufen', /autorisierten PCS-Zugang/.test(pcsMsg), pcsMsg.slice(0, 80));
  await page.getByLabel('Link zur Startliste').fill('https://veranstalter.example/startliste.pdf');
  await page.getByRole('button', { name: 'Link laden' }).click();
  await page.waitForSelector('text=Aus dem PDF erkannte Tabelle');
  await page.getByLabel('Erkennung').selectOption('tabelle');
  const abgleichDisabled = await page.getByRole('button', { name: /Abgleichen/ }).isDisabled();
  await page.getByText('Ich habe die erkannte Tabelle geprüft').click();
  await page.getByRole('button', { name: /Abgleichen/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr td:nth-child(5) .badge').length === 3);
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  const linkParts = await page.evaluate(async () => {
    const { db } = window.__lk;
    const ed = (await db.editions.toArray()).find((e) => e.name === 'Link-Rennen');
    return (await db.participations.where('editionId').equals(ed.id).toArray()).map((p) => p.bib).sort();
  });
  check('PDF/Link', 'PDF über Link geladen; Abgleich erst nach Prüf-Bestätigung', abgleichDisabled && linkParts.length >= 2, `Abgleich vorher gesperrt: ${abgleichDisabled}; Nummern ${JSON.stringify(linkParts)}`);

  // Live-Ansicht Demo: Etappe 4 → Gesamtwertung zeigt Stand nach Etappe 3
  const demoId = await page.evaluate(async () => (await window.__lk.db.editions.toArray()).find((e) => e.dataOrigin === 'demo').id);
  await page.goto(URL + '#live');
  await page.getByLabel('Aktives Rennen').selectOption(demoId);
  await page.getByLabel('Etappe').selectOption({ label: 'Etappe 4' });
  await page.locator('.riders li').nth(1).click();
  await page.getByRole('tab', { name: 'Gesamt' }).click();
  const label = await page.locator('.standing-label').textContent();
  check(27, 'Gesamtwertung bei Etappe 4 zeigt ausdrücklich Stand nach Etappe 3', /nach Etappe 3 \(EZF\).*Etappe 4 noch nicht vorhanden/.test(label), label);
  await page.getByRole('tab', { name: 'Etappe', exact: true }).click();
  await page.locator('.riders li').first().click();
  await page.keyboard.press('p');
  await page.locator('.riders li').nth(2).click();
  await page.screenshot({ path: `${screens}/live-dunkel.png` });

  // Tastatur: Suche ohne Maus (Nr. 18)
  await page.keyboard.press('Control+k');
  await page.keyboard.type('ovrebo');
  await page.waitForSelector('.hits li:first-child:has-text("Øvrebø")');
  const hit = await page.locator('.hits li').first().textContent();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.dialog.search', { state: 'detached' });
  await page.waitForSelector('.card.primary .rider-name:has-text("Øvrebø")', { timeout: 5000 }).catch(() => {});
  const selName = await page.locator('.card.primary .rider-name').textContent();
  check(18, 'Suche per Tastatur (ohne Akzente) wählt Fahrer', /Øvrebø/.test(hit) && /Øvrebø/.test(selName), selName);
  await page.keyboard.press('n');
  await page.keyboard.type('Attacke am Schlussanstieg');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Attacke am Schlussanstieg');
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(18, 'Kernansicht ohne horizontales Scrollen (1440×900)', !hscroll);

  // Suchleistung mit 50.000 Fahrern (Nr. 17) – Messung, kein Grenzwertversprechen
  await page.evaluate(async () => {
    const { db } = window.__lk;
    const syll = ['ka', 'lo', 'mi', 'ne', 'ro', 'sa', 'ti', 'vu', 'ze', 'ba', 'de', 'fo', 'gu', 'hi', 'jo'];
    const word = (i, n) => Array.from({ length: n }, (_, k) => syll[(i * 7 + k * 13 + Math.floor(i / (k + 1))) % syll.length]).join('');
    const now = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < 50000; i++) {
      const f = word(i, 2), l = word(i * 3 + 1, 3);
      rows.push({ id: crypto.randomUUID(), rev: 1, createdAt: now, updatedAt: now, firstName: f, lastName: l, displayName: `${f} ${l}`, aliases: [], keyFacts: [], tags: ['last'], externalIds: [], searchTokens: [f, l, `${f} ${l}`] });
    }
    await db.riders.bulkAdd(rows);
  });
  const times = await page.evaluate(async (demo) => {
    const { search } = window.__lk;
    const qs = ['ka', 'lomi', 'ze', 'rosa', 'bi', 'øvr', 'brändli', '11', '23', 'tiv', 'nemi', 'jo', 'dufaux', 'pe', 'saka'];
    const t = [];
    for (let k = 0; k < 6; k++) for (const q of qs) { const t0 = performance.now(); await search(q, demo); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return { p50: t[Math.floor(t.length * 0.5)], p95: t[Math.floor(t.length * 0.95)], n: t.length };
  }, demoId);
  check(17, 'Suche bei 50.000 Profilen: p95 < 200 ms (Chromium headless, Cloud-Container)', times.p95 < 200, `p50 ${times.p50.toFixed(1)} ms, p95 ${times.p95.toFixed(1)} ms, n=${times.n}`);

  // Sicherung herunterladen
  await page.goto(URL + '#sicherung');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Archiv herunterladen/ }).click()]);
  const backupPath = join(userDataDir, '..', 'lk-e2e-backup.zip');
  await dl.saveAs(backupPath);
  check('13a', 'Archiv-Download erzeugt', readFileSync(backupPath).length > 1000, `${readFileSync(backupPath).length} Bytes`);

  // --- Offline: Server stoppen, Browser komplett schließen, neu öffnen (Nr. 1, 23)
  await ctx.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 800));
  ctx = await launch();
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL + '#live');
  await page.waitForSelector('.riders li', { timeout: 20000 });
  const n = await page.locator('.riders li').count();
  const evOk = await page.locator('text=Attacke am Schlussanstieg').count();
  check('1/23', 'Offline nach Browser-Neustart ohne Server: App, Rennen, Startliste, Ereignisse verfügbar', n === 16 && evOk > 0, `${n} Fahrer`);
  await page.screenshot({ path: `${screens}/offline-neustart.png` });

  // Offline: Rennen anlegen, Startliste importieren, Notiz speichern, neu starten (Nr. 2)
  await page.goto(URL + '#rennen');
  await page.getByLabel('Name').first().fill('Offline-Rennen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#import');
  await page.locator('fieldset select').first().selectOption({ label: 'Offline-Rennen' });
  await page.getByPlaceholder(/Aus Excel/).fill('Nr;Name;Team\n1;SZYMAŃSKA Ewa;Team Offline\n');
  await page.getByRole('button', { name: 'Eingefügte Tabelle laden' }).click();
  await page.getByRole('button', { name: /Abgleichen/ }).click();
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  await page.goto(URL + '#live');
  await page.locator('.riders li').first().click();
  await page.getByLabel('Ereignis notieren').fill('Offline-Notiz');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.event-list >> text=Offline-Notiz');
  await ctx.close();
  ctx = await launch();
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL + '#live');
  await page.waitForSelector('.riders li');
  const persisted = await page.evaluate(async () => {
    const { db } = window.__lk;
    const ed = (await db.editions.toArray()).find((e) => e.name === 'Offline-Rennen');
    const p = await db.participations.where('editionId').equals(ed.id).toArray();
    const r = await db.riders.get(p[0].riderId);
    const ev = await db.events.where('editionId').equals(ed.id).toArray();
    return { name: r.displayName, first: r.firstName, last: r.lastName, ev: ev.map((e) => e.text) };
  });
  check(2, 'Offline angelegtes Rennen, Import und Notiz nach Neustart vorhanden', persisted.last === 'Szymańska' && persisted.ev.includes('Offline-Notiz'), JSON.stringify(persisted));

  // PDF-Datei OFFLINE importieren (Teamblöcke nebeneinander, zwei Seiten)
  await page.goto(URL + '#/rennen');
  await page.getByLabel('Name').first().fill('PDF-Rennen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#/import');
  await page.locator('fieldset select').first().selectOption({ label: 'PDF-Rennen' });
  await page.locator('input[type=file]').setInputFiles('src/import/fixtures/startliste-teambloecke.pdf');
  await page.waitForSelector('text=Aus dem PDF erkannte Tabelle', { timeout: 15000 });
  await page.screenshot({ path: `${screens}/pdf-pruefung.png`, fullPage: true });
  // Korrektur in der Zwischenstufe: Team von Nr. 1 umbenennen
  const firstTeam = page.getByLabel('Zeile 1 Spalte 3');
  await firstTeam.fill('ALPENFIRN RACING TEAM');
  await page.getByText('Ich habe die erkannte Tabelle geprüft').click();
  await page.getByRole('button', { name: /Abgleichen/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr td:nth-child(5) .badge').length === 18);
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  const pdfRes = await page.evaluate(async () => {
    const { db } = window.__lk;
    const ed = (await db.editions.toArray()).find((e) => e.name === 'PDF-Rennen');
    const ps = await db.participations.where('editionId').equals(ed.id).toArray();
    return { n: ps.length, b007: ps.find((p) => p.bib === '007')?.teamName, b1: ps.find((p) => p.bib === '1')?.teamName, b41: ps.find((p) => p.bib === '41')?.teamName };
  });
  check('PDF', 'PDF-Startliste offline importiert; Korrektur aus der Prüftabelle übernommen', pdfRes.n >= 16 && pdfRes.b007 === 'ZERO ONE' && pdfRes.b1 === 'ALPENFIRN RACING TEAM' && pdfRes.b41 === 'TEAM KAIZEN', JSON.stringify(pdfRes));

  // Restore in leerem, mit App-Code vorbereitetem Browserbestand (Nr. 13)
  await page.evaluate(async () => {
    const { db } = window.__lk;
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  await page.goto(URL + '#sicherung');
  await page.getByLabel('Sicherungsarchiv wählen').setInputFiles(backupPath);
  await page.waitForSelector('text=Archiv geprüft');
  await page.getByRole('button', { name: 'Aktuellen Bestand ersetzen' }).click();
  await page.waitForSelector('text=Wiederhergestellt');
  const restored = await page.evaluate(async () => ({ riders: await window.__lk.db.riders.count(), editions: await window.__lk.db.editions.count() }));
  check(13, 'Offline-Wiederherstellung aus Archiv in geleertem Bestand', restored.riders > 50000 && restored.editions === 3, JSON.stringify(restored));
} catch (e) {
  check('!', 'Unerwarteter Abbruch', false, String(e && e.stack || e));
  await page.screenshot({ path: `${screens}/fehler.png` }).catch(() => {});
} finally {
  await ctx.close().catch(() => {});
  server.kill();
  const env = { browser: `Chromium ${chromium.name()} (Playwright, headless)`, os: process.platform, node: process.version, date: new Date().toISOString() };
  writeFileSync('e2e/results.json', JSON.stringify({ env, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  process.exit(failed ? 1 : 0);
}
