/**
 * Browser-Abnahmetests (Chromium via Playwright) gegen den Produktions-Build.
 *   npm run build && npm run e2e
 * Bedient die Oberfläche wie ein Nutzer: Rennen anlegen, PCS-Startliste einfügen, Profil
 * anlegen und formatieren (Leuchtstift, Stern), PCS-Fahrerseite einfügen, Themen, LIVE mit
 * Tastatursuche, Profil ins nächste Rennen übernehmen, PDF, Sicherung, Offline-Neustart.
 * Ergebnisse: e2e/results.json, Screenshots in e2e/screens/.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4173;
const URL = `http://localhost:${PORT}/?testhooks`;
const results = [];
const screens = 'e2e/screens';
rmSync(screens, { recursive: true, force: true });
mkdirSync(screens, { recursive: true });
const check = (nr, name, ok, detail = '') => {
  results.push({ nr, name, ok, detail });
  console.log(`${ok ? 'BESTANDEN' : 'FEHLER   '}  [${nr}] ${name}${detail ? ' – ' + detail : ''}`);
};

function startServer() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  return new Promise((res) => {
    p.stdout.on('data', (d) => { if (String(d).includes('localhost')) res(p); });
    setTimeout(() => res(p), 5000);
  });
}

// Erfundene Inhalte im Aufbau einer kopierten PCS-Seite
const STARTLIST = [
  'search', 'Home', '2027   »   90th Tour de Suisse ME (2.UWT)', 'Startlist', '6 riders', '',
  'Lidl - Trek (WT)', '1AYUSO Juan', '2CICCONE Giulio', 'DS GUERCILENA Luca', 'team statistics in race',
  'Tudor Pro Cycling Team (PRT)', '11HIRSCHI Marc', '12STORER Michael', 'DS GUBLER Ricardo', 'team statistics in race',
  'Team Visma | Lease a Bike (WT)', '21VINGEGAARD Jonas', '22KUSS Sepp', 'DS ZEEMAN Merijn', 'team statistics in race', 'Pageload 0.02s',
].join('\n');
const RIDERPAGE = ['Name:Marc Hirschi', 'Date of birth:24thAugust 1998 (29)', 'Nationality:Switzerland', 'Weight:61kgHeight:1.74m', 'Place of birth:Bern',
  'Specialties', '900Oneday', '300GC', '100TT', '50Sprint', '400Climber', '1200Hills', 'Top results', "  La Flèche Wallonne  ('20)", "  stage Tour de France  ('20)",
  'Teams', '2027Tudor Pro Cycling Team (PRT)', '2026Tudor Pro Cycling Team (PRT)', '2025Tudor Pro Cycling Team (PRT)', 'Program', 'Key statistics', '20Wins', 'Family', 'Ueli Hirschi (Brother)', 'Grand Tours'].join('\n');

const userDataDir = mkdtempSync(join(tmpdir(), 'rcc-e2e-'));
const launch = () => chromium.launchPersistentContext(userDataDir, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, acceptDownloads: true });

let server = await startServer();
let ctx = await launch();
let page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
watch(page);
const lk = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check('Offline', 'Service Worker kontrolliert die Seite', await page.evaluate(() => !!navigator.serviceWorker.controller));
  await page.waitForSelector('main >> text=Noch kein Rennen');

  // 1 Rennen anlegen
  await page.goto(URL + '#rennen');
  await page.getByRole('button', { name: '+ Rennen' }).click();
  await page.getByLabel('Name').fill('Tour de Suisse');
  await page.getByLabel('Jahr').fill('2027');
  await page.getByLabel('Startdatum').fill('2027-06-13');
  await page.getByLabel('Anzahl Etappen').fill('8');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForSelector('h1:has-text("Tour de Suisse 2027")');
  const st = await lk(async () => (await window.__lk.db.stages.toArray()).length);
  check('Rennen', 'Rennen mit 8 Etappen angelegt und als aktuelles Rennen gewählt', st === 8 && (await page.getByLabel('Rennen', { exact: true }).inputValue()) !== '', `${st} Etappen`);

  // 2 PCS-Startliste einfügen
  await page.getByRole('tab', { name: /Startliste/ }).click();
  await page.getByRole('button', { name: 'Startliste einfügen …' }).click();
  await page.getByLabel('PCS-Startliste einfügen').fill(STARTLIST);
  // Wie beim echten Einfügen aus dem Browser: neben dem Text liegt das HTML mit den Fahrer-Links in der Zwischenablage
  await page.getByLabel('PCS-Startliste einfügen').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<a href="rider/marc-hirschi">HIRSCHI Marc</a><a href="rider/jonas-vingegaard-rasmussen">VINGEGAARD Jonas</a><a href="team/tudor-2027">Tudor</a>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('text=Erkannt: 6 Fahrer');
  await page.waitForSelector('text=2 von 6 mit Link zur PCS-Fahrerseite');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await page.waitForSelector('text=Übernommen: 6 neu');
  const names = await page.locator('table.tbl tbody td:nth-child(2)').allTextContents();
  const slugs = await lk(async () => (await window.__lk.db.entries.toArray()).filter((e) => e.pcsSlug).map((e) => e.pcsSlug).sort().join(','));
  check('Startliste', 'PCS-Startliste eingefügt: 6 Fahrer, Namen lesbar, nach Startnummer sortiert, PCS-Kennungen aus den Links', names.join('|') === 'Juan Ayuso|Giulio Ciccone|Marc Hirschi|Michael Storer|Jonas Vingegaard|Sepp Kuss' && slugs === 'jonas-vingegaard-rasmussen,marc-hirschi', `${names.join('|')} · ${slugs}`);

  // 3 Profil aus Startliste anlegen, Felder und Abschnitte bearbeiten
  await page.locator('tr', { hasText: 'Marc Hirschi' }).getByRole('button', { name: '+ Profil' }).click();
  await page.waitForSelector('h1:has-text("Marc Hirschi")');
  await page.getByLabel('Nation (IOC, z. B. SUI)').fill('SUI');
  await page.getByLabel('Fahrertyp').fill('Puncheur');
  await page.keyboard.press('Tab');
  const aktuell = page.getByLabel('Aktuell – Marc Hirschi');
  await aktuell.click();
  await page.keyboard.type('Nach Sturz wieder fit');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Erster Start seit 6 Wochen');
  // Stern auf die zweite Zeile, Leuchtstift „Sturz / Ausfall“ auf ein Wort der ersten
  await page.getByRole('button', { name: 'Stern ein oder aus' }).click();
  await aktuell.evaluate((el) => {
    const t = el.firstChild?.nodeType === 3 ? el.firstChild : el.querySelector('div')?.firstChild ?? el.firstChild;
    const r = document.createRange(); r.setStart(t, 5); r.setEnd(t, 10);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.getByRole('button', { name: 'Leuchtstift Rot: Sturz / Ausfall' }).click();
  await page.screenshot({ path: `${screens}/formatieren.png` });
  await page.getByLabel('Erfolge – Marc Hirschi').click(); // Fokus weg → speichert
  await page.waitForTimeout(400);
  const prof = await lk(async () => { const r = (await window.__lk.db.riders.toArray())[0]; return { nation: r.nation, type: r.riderType, akt: r.sections.aktuell ?? '', at: !!r.aktuellAt }; });
  check('Profil', 'Profil angelegt; Felder gespeichert; Aktuell mit ★ und Leuchtstift (#ffa8a8)', prof.nation === 'SUI' && prof.type === 'Puncheur' && prof.akt.includes('★ Erster Start') && prof.akt.includes('background-color:#ffa8a8') && prof.at, prof.akt);

  // 4 PCS-Fahrerseite einfügen (füllt nur Leeres)
  await page.getByRole('button', { name: 'PCS-Seite einfügen …' }).click();
  await page.getByLabel('PCS-Fahrerseite einfügen').fill(RIDERPAGE);
  await page.waitForSelector('text=Wird ergänzt:');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await page.waitForSelector('text=Übernommen:');
  const pcs = await lk(async () => { const r = (await window.__lk.db.riders.toArray())[0]; return { bd: r.birthDate, h: r.heightCm, type: r.riderType, erf: r.sections.erfolge ?? '', pers: r.sections.persoenlich ?? '', person: r.sections.person ?? '' }; });
  check('PCS', 'PCS-Fahrerseite: Geburtsdatum, Grösse, Erfolge, Teams, Familie ergänzt; eigener Fahrertyp bleibt', pcs.bd === '1998-08-24' && pcs.h === 174 && pcs.type === 'Puncheur' && pcs.erf.includes('20 Profisiege') && pcs.erf.includes('Sieg La Flèche Wallonne (2020)') && pcs.person.includes('Tudor Pro Cycling Team') && pcs.pers.includes('Ueli Hirschi (Bruder)'), JSON.stringify(pcs).slice(0, 200));
  const pcsHref = await page.getByRole('link', { name: /PCS-Seite/ }).getAttribute('href');
  check('PCS-Link', 'PCS-Knopf öffnet im eigenen Fenster „pcs“ (keine Einbettung)', pcsHref.startsWith('https://www.procyclingstats.com/') && (await page.getByRole('link', { name: /PCS-Seite/ }).getAttribute('target')) === 'pcs', pcsHref);

  // 5 Thema anlegen
  await page.goto(URL + '#themen');
  await page.getByRole('button', { name: '+ Statistik' }).click();
  await page.getByLabel('Titel').fill('Schweizer Etappensiege');
  await page.getByLabel('Text').click();
  await page.keyboard.type('Seit 2019 nur drei Schweizer Etappensiege.');
  await page.getByRole('button', { name: /hervorheben/ }).click();
  await page.getByLabel('Titel').click();
  await page.waitForTimeout(1000);
  const topic = await lk(async () => (await window.__lk.db.topics.toArray())[0]);
  check('Themen', 'Thema mit Titel, Text, Stern und Rennbezug gespeichert', topic.title === 'Schweizer Etappensiege' && topic.body.includes('drei Schweizer') && topic.starred && !!topic.raceId, JSON.stringify({ t: topic.title, s: topic.starred }));

  // 6 LIVE: Startnummer tippen, ★ zuoberst, Etappe und Thema rechts
  await page.goto(URL + '#live');
  await page.waitForSelector('nav.startlist');
  // PCS wird im Test nie aufgerufen: Anfragen ans PCS-Fenster werden lokal beantwortet
  await ctx.route('https://www.procyclingstats.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>PCS (Test)</title>' }));
  const popup = ctx.waitForEvent('page', { timeout: 10000 });
  await page.keyboard.type('11');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.live-card h1:has-text("Marc Hirschi")');
  const pcsPage = await popup;
  const pcsUrl = pcsPage.url();
  const pcsName = await pcsPage.evaluate(() => window.name);
  check('LIVE → PCS', 'Startnummer suchen öffnet direkt die PCS-Fahrerseite im Fenster „pcs“', pcsUrl === 'https://www.procyclingstats.com/rider/marc-hirschi' && pcsName === 'pcs', pcsUrl);
  let extraPopup = false;
  ctx.once('page', () => { extraPopup = true; });
  const firstStar = await page.locator('.live-card ul.starred li').first().textContent();
  const side = await page.locator('.live-side').textContent();
  await page.screenshot({ path: `${screens}/live.png` });
  check('LIVE', 'Startnummer tippen öffnet die Fahrerkarte; ★-Zeile zuoberst; Thema rechts', firstStar?.includes('Erster Start seit 6 Wochen') && side.includes('Schweizer Etappensiege'), firstStar);
  await page.keyboard.type('vin');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.live-card h1:has-text("Jonas Vingegaard")');
  await page.waitForTimeout(500);
  check('LIVE-Suche', 'Buchstaben tippen sucht nach Namen (auch ohne Profil), ohne PCS zu öffnen', !extraPopup && await page.locator('.live-card').textContent().then((t) => t.includes('Kein Profil')));
  await pcsPage.close();

  // 7 Neues Rennen, Profil-Fahrer übernehmen
  await page.goto(URL + '#rennen');
  await page.getByRole('button', { name: '+ Rennen' }).click();
  await page.getByLabel('Name').fill('Tour de France');
  await page.getByLabel('Jahr').fill('2027');
  await page.getByLabel('Startdatum').fill('2027-07-03');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForSelector('h1:has-text("Tour de France 2027")');
  await page.getByRole('tab', { name: /Startliste/ }).click();
  await page.getByRole('button', { name: 'Profil-Fahrer übernehmen …' }).click();
  await page.getByLabel(/Marc Hirschi/).check();
  await page.getByRole('button', { name: '1 übernehmen' }).click();
  await page.waitForSelector('table.tbl >> text=Marc Hirschi');
  const carry = await lk(async () => { const races = await window.__lk.db.races.toArray(); const tdf = races.find((r) => r.name === 'Tour de France'); return (await window.__lk.db.entries.where('raceId').equals(tdf.id).toArray()).map((e) => !!e.riderId); });
  check('Übernehmen', 'Profil-Fahrer ins nächste Rennen übernommen (verknüpft, Profil bleibt eins)', carry.length === 1 && carry[0] && (await lk(async () => (await window.__lk.db.riders.count()))) === 1);

  // 8 Suche über alles
  await page.keyboard.press('Control+k');
  await page.getByLabel('Suchbegriff').fill('bruder');
  await page.waitForSelector('.qsearch li >> text=Marc Hirschi');
  check('Suche', 'Strg K findet Text in Profilen (Persönliches: „Bruder“)', true);
  await page.keyboard.press('Escape');

  // 9 PDF
  await page.getByLabel('Rennen', { exact: true }).selectOption({ label: 'Tour de Suisse 2027' });
  await page.goto(URL + '#pdf');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF erstellen' }).click()]);
  const pdfPath = join(userDataDir, 'test.pdf');
  await dl.saveAs(pdfPath);
  const head = (await import('node:fs')).readFileSync(pdfPath).subarray(0, 5).toString();
  check('PDF', 'PDF wird erstellt und heruntergeladen', head === '%PDF-' && dl.suggestedFilename().startsWith('Tour-de-Suisse-2027'), dl.suggestedFilename());

  // 9a SRF-Programm: Ablauf aus Excel einfügen, Zeiten fortschreiben, LIVE zeigt JETZT
  await page.goto(URL + '#programm');
  await page.getByRole('button', { name: 'Aus Excel/Word einfügen …' }).click();
  const hh = new Date(); const t0 = `${String(hh.getHours()).padStart(2, '0')}:00`;
  await page.getByLabel('Sendeablauf einfügen').fill(`Zeit\tDauer\tElement\tInhalt\n${t0}\t90\tLive-Rennen\tAusreisser\n\t5\tSiegerehrung\t`);
  await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
  await page.getByRole('button', { name: 'Zeiten aus Dauern' }).click();
  await page.waitForSelector('text=1 Zeiten berechnet');
  const rd = await lk(async () => (await window.__lk.db.rundown.toArray()).filter((r) => !r.deleted).sort((a, b) => a.order - b.order).map((r) => `${r.time} ${r.item}`));
  await page.screenshot({ path: `${screens}/09a-programm.png`, fullPage: true });
  await page.goto(URL + '#live');
  await page.waitForSelector('.onair-tag');
  const onair = await page.locator('.onair-panel, .onair').first().textContent();
  check('SRF-Programm', 'Ablauf einfügen (mit Kopfzeile), Zeiten aus Dauern, LIVE zeigt JETZT', rd.length === 2 && rd[1].startsWith(String(Number(t0.slice(0, 2)) + 1).padStart(2, '0') + ':30') && onair.includes('Live-Rennen'), rd.join(' | '));

  // 9b Geographisches: GPX laden, Wikipedia (simuliert) holen, km to go
  await ctx.route('https://de.wikipedia.org/**', (route) => {
    const u = new globalThis.URL(route.request().url());
    const body = u.searchParams.get('generator') === 'geosearch'
      ? { query: { pages: [
          { title: 'Cully VD', coordinates: [{ lat: 46.4885, lon: 6.7305 }], description: 'Ortschaft im Kanton Waadt, Schweiz', categories: [] },
          { title: 'Schloss Chillon', coordinates: [{ lat: 46.4142, lon: 6.9275 }], description: 'Wasserschloss am Genfersee', categories: [{ title: 'Kategorie:Kulturgut von nationaler Bedeutung im Kanton Waadt' }] },
        ] } }
      : { query: { pages: [{ title: 'Cully VD', extract: 'Cully [kyˈji] ist eine Ortschaft im Lavaux.' }, { title: 'Schloss Chillon', extract: 'Das Schloss Chillon ist ein Wasserschloss.' }] } };
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  const trk = Array.from({ length: 41 }, (_, i) => [46.52 - i * 0.0028, 6.63 + i * 0.0075, 380 + (i % 8) * 25]);
  const gpxText = `<?xml version="1.0"?><gpx><trk><name>Lausanne–Villeneuve</name><trkseg>${trk.map(([a, b, e]) => `<trkpt lat="${a}" lon="${b}"><ele>${e}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  await page.goto(URL + '#geo');
  await page.getByLabel('GPX-Datei laden').setInputFiles({ name: 'etappe.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxText) });
  await page.waitForSelector('svg.profile');
  await page.getByRole('button', { name: 'Orte & Sehenswürdigkeiten von Wikipedia holen' }).click();
  await page.waitForSelector('text=Orte und Sehenswürdigkeiten gefunden', { timeout: 30000 });
  const rowsTxt = await page.locator('.geo-row').allTextContents();
  await page.screenshot({ path: `${screens}/09b-geo.png`, fullPage: true });
  check('Geographisches', 'GPX laden, Höhenprofil, Wikipedia-Orte nach km to go (Cully vor Chillon, Lautschrift entfernt)', rowsTxt.length === 2 && rowsTxt[0].includes('Cully') && rowsTxt[1].includes('Chillon') && !rowsTxt.join().includes('kyˈji'), rowsTxt.map((t) => t.slice(0, 40)).join(' | '));
  await page.goto(URL + '#live');
  await page.waitForSelector('.geo-live-row');
  check('LIVE Geo', 'LIVE zeigt die nächsten Punkte entlang der Strecke', (await page.locator('.geo-live-row').count()) === 2);

  // 9b2 Tastatur + / − verstellt km to go
  const ktg0 = Number(await page.locator('#ktg').inputValue());
  await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => {});
  await page.keyboard.press('-'); await page.keyboard.press('-'); await page.keyboard.press('+'); await page.keyboard.press('-');
  await page.waitForFunction((v) => Number(document.querySelector('#ktg').value) === v, Math.round((ktg0 - 2) * 10) / 10);
  check('LIVE Tastatur', 'Tasten + / − verstellen km to go ohne Maus', true, `${ktg0} → ${await page.locator('#ktg').inputValue()}`);

  // 9b3 Rennsituation: Gruppen anlegen, Startnummern tippen, Fahrer anklicken
  await page.getByRole('button', { name: '+ Feld' }).click();
  await page.locator('.situation').getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByLabel('Startnummern Spitze').fill('21 22');
  await page.getByLabel('Abstand Verfolger').fill('+1:40');
  await page.getByLabel('Startnummern Verfolger').fill('11');
  await page.getByLabel('Startnummern Verfolger').press('Tab');
  await page.locator('.situation').getByRole('button', { name: 'Fertig' }).click();
  await page.locator('.sit-rider', { hasText: 'Vingegaard' }).click();
  await page.waitForSelector('.live-card h1:has-text("Jonas Vingegaard")');
  const sitChip = await page.locator('.live-ranks').textContent();
  const sitTxt = await page.locator('.situation').textContent();
  check('Rennsituation', 'Gruppen mit Abstand und Startnummern; Klick auf Fahrer öffnet Karte mit Gruppe', sitChip.includes('Spitze') && sitTxt.includes('+1:40') && sitTxt.includes('Hirschi'), sitTxt.slice(0, 80));

  // 9b5 Schriftgrösse und Stichworte
  await page.getByRole('button', { name: 'Schrift grösser' }).click();
  await page.waitForFunction(() => document.querySelector('.live-board').style.zoom === '1.1');
  await page.screenshot({ path: `${screens}/09b5-live-situation.png`, fullPage: false });
  await page.getByRole('button', { name: 'Schrift kleiner' }).click();
  await page.waitForFunction(() => !document.querySelector('.live-board').style.zoom);
  check('LIVE Schrift', 'Schrift grösser/kleiner für LIVE (gemerkt)', true);

  // 9c Hell-Ansicht
  await page.getByRole('button', { name: /Hell/ }).click();
  const theme = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  await page.screenshot({ path: `${screens}/09c-live-hell.png`, fullPage: true });
  await page.reload();
  const theme2 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /Dunkel/ }).click();
  check('Hell-Ansicht', 'Umschalten auf Hell, bleibt nach Neuladen erhalten', theme[0] === 'light' && theme[1] === 'rgb(244, 243, 239)' && theme2 === 'light', theme.join(' '));

  // 10 Sicherung herunterladen, ändern, wiederherstellen
  await page.goto(URL + '#sicherung');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sicherung herunterladen' }).click()]);
  const bkPath = join(userDataDir, bk.suggestedFilename());
  await bk.saveAs(bkPath);
  await lk(async () => { await window.__lk.center.createRider({ firstName: 'Weg', lastName: 'Damit' }); });
  await page.getByLabel('Sicherungsdatei wählen').setInputFiles(bkPath);
  await page.waitForSelector('text=Geprüft: Sicherung');
  await page.getByRole('button', { name: 'Wiederherstellen' }).first().click();
  await page.locator('.dialog').getByRole('button', { name: 'Wiederherstellen' }).click();
  await page.waitForSelector('text=Sicherung wiederhergestellt');
  const after = await lk(async () => (await window.__lk.db.riders.toArray()).filter((r) => !r.deleted).map((r) => r.name));
  check('Sicherung', 'Sicherung herunterladen und wiederherstellen (späterer Fahrer wieder weg, Wiederherstellungspunkt angelegt)', after.join() === 'Marc Hirschi' && (await page.locator('text=Vor Wiederherstellung').count()) > 0, after.join());

  // 11 Offline-Neustart
  await ctx.close();
  ctx = await launch();
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  watch(page);
  await page.goto(URL + '#live');
  await page.waitForSelector('nav.startlist', { timeout: 15000 });
  const offRider = await page.locator('nav.startlist').textContent();
  check('Offline-Start', 'Nach Neustart ohne Internet: Center startet mit allen Daten', offRider.includes('Marc Hirschi'));
  await ctx.setOffline(false);

  check('Fehler', 'Keine Programmfehler im Browser', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('!', 'Unerwarteter Abbruch', false, String(e && e.stack || e));
  await page.screenshot({ path: `${screens}/fehler.png` }).catch(() => {});
} finally {
  await ctx.close().catch(() => {});
  server.kill();
  const env = { browser: `Chromium (Playwright, headless)`, os: process.platform, node: process.version, date: new Date().toISOString() };
  writeFileSync('e2e/results.json', JSON.stringify({ env, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  process.exit(failed ? 1 : 0);
}
