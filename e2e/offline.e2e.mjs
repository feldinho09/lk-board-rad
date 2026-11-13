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
import { pathToFileURL } from 'node:url';

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
  await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'Testkriterium 2026' });
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
  await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'Link-Rennen' });
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

  // Manuell kopierte PCS-Startliste (Aufbau nachgebildet, Namen erfunden)
  const pcsPaste = ['search', 'Home', '2025', '2026', '2026   »   12th Fiktivia Classic ME (1.Pro)', 'One day race   »   Nordstadt  ›  Südstadt   (201.5km)',
    'Startlist', '4 riders', 'Team Testwerk (WT)', "1O'NEILL Seán", '2RENARD-DUPONT Jean-Luc', 'DS MUSTER Max', 'team statistics in race',
    'Squadra Prova (PRT)', '11VAN DEN AKKER Joris', '12ŁUKASZEWICZ Paweł', 'DS UNO Ugo', 'team statistics in race', 'Startlist', 'Tour de France'].join('\r\n');
  await page.goto(URL + '#rennen');
  await page.getByLabel('Name').first().fill('PCS-Kopie-Rennen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#import');
  await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'PCS-Kopie-Rennen' });
  await page.getByPlaceholder(/Aus Excel/).fill(pcsPaste);
  await page.getByRole('button', { name: 'Eingefügte Tabelle laden' }).click();
  const pcsBanner = await page.locator('text=ProCyclingStats-Startliste erkannt').locator('..').textContent();
  await page.getByRole('button', { name: /Abgleichen/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr td:nth-child(5) .badge').length === 4);
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  const pcsRes = await page.evaluate(async () => {
    const { db } = window.__lk;
    const ed = (await db.editions.toArray()).find((e) => e.name === 'PCS-Kopie-Rennen');
    const ps = await db.participations.where('editionId').equals(ed.id).toArray();
    const rs = await db.riders.bulkGet(ps.map((p) => p.riderId));
    return ps.map((p, i) => `${p.bib}:${rs[i].displayName}:${p.teamName}`).sort();
  });
  check('PCS-Kopie', 'Kopierte PCS-Startliste erkannt und importiert', /Fiktivia Classic 2026.*4 Fahrer in 2 Teams \(laut PCS: 4\)/.test(pcsBanner) && pcsRes.length === 4 && pcsRes.includes("1:Seán O'Neill:Team Testwerk"), JSON.stringify(pcsRes));

  // Manuell kopierte PCS-Rangliste speichern, in Live ansehen, Korrektur kommt als „Neuer Stand verfügbar“
  const rankText = (gap) => ['search', 'Home', '2026   »   12th Fiktivia Classic ME (1.Pro)', 'One day race   »   Nordstadt  ›  Südstadt   (201.5km)',
    'Rnk\tRider\tTeam\tUCI\tPCS\t\tTimelag',
    '1\t ŁUKASZEWICZ Paweł', 'Squadra Prova\t125\t100\t\t4:51:12',
    "2\t O'NEILL Seán", 'Team Testwerk\t85\t70\t\t,,',
    '3\t RENARD-DUPONT Jean-Luc', `Team Testwerk\t70\t50\t\t${gap}`,
    'DNF\t VAN DEN AKKER Joris', 'Squadra Prova\t\t\t\t',
    'Race information', 'Pageload 0.02s'].join('\r\n');
  const pasteRanking = async (gap) => {
    await page.goto(URL + '#import');
    await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'PCS-Kopie-Rennen' });
    await page.getByPlaceholder(/Aus Excel/).fill(rankText(gap));
    await page.getByRole('button', { name: 'Eingefügte Tabelle laden' }).click();
    await page.waitForSelector('text=ProCyclingStats-Rangliste (manuell kopiert)');
    await page.getByRole('button', { name: 'Wertungsstand speichern' }).click();
    return (await page.locator('.banner.ok').last().textContent()) ?? '';
  };
  const first = await pasteRanking('0:12');
  await page.screenshot({ path: `${screens}/pcs-rangliste.png`, fullPage: true });
  const again = await pasteRanking('0:12');
  const pcsEdId = await page.evaluate(async () => (await window.__lk.db.editions.toArray()).find((e) => e.name === 'PCS-Kopie-Rennen').id);
  const dnf = await page.evaluate(async (id) => (await window.__lk.db.participations.where('editionId').equals(id).toArray()).find((p) => p.bib === '11').status, pcsEdId);
  await page.goto(URL + '#live');
  await page.getByLabel('Aktives Rennen').selectOption(pcsEdId);
  await page.waitForSelector('.standing-label');
  const lbl1 = await page.locator('.standing-label').textContent();
  const row3 = await page.locator('.standings tbody tr').nth(2).textContent();
  // Korrektur importieren, während die Live-Ansicht in einem zweiten Tab offen ist
  const live = await ctx.newPage();
  await live.goto(URL + '#live');
  await live.waitForSelector('.standings tbody tr');
  const corrected = await pasteRanking('0:14');
  try {
    await live.waitForSelector('text=Neuer Stand verfügbar', { timeout: 10000 });
  } catch (e) {
    const d = await live.evaluate(async () => ({
      label: document.querySelector('.standing-label')?.textContent,
      rows: [...document.querySelectorAll('.standings tbody tr')].map((r) => r.textContent).slice(0, 3),
      revs: (await window.__lk.db.standings.toArray()).filter((s) => s.source.startsWith('PCS')).map((s) => s.sourceRevision),
      sel: document.querySelector('[aria-label="Aktives Rennen"]')?.selectedOptions[0]?.textContent,
      hash: location.hash,
    }));
    console.log('DIAG zweiter Tab:', JSON.stringify(d), '| Import:', corrected);
    await live.screenshot({ path: `${screens}/fehler-tab2.png` });
    throw e;
  }
  const stillOld = await live.locator('.standings tbody tr').nth(2).textContent();
  await live.getByRole('button', { name: /Neuer Stand verfügbar/ }).click();
  const nowNew = await live.locator('.standings tbody tr').nth(2).textContent();
  await live.close();
  check('PCS-Rangliste', 'Kopierte PCS-Rangliste gespeichert; gleiche Daten keine neue Revision; DNF übernommen',
    /Revision 1/.test(first) && /Unverändert/.test(again) && dnf === 'DNF' && /Etappenergebnis Rennen – PCS \(manuell kopiert\)/.test(lbl1) && /\+0:12/.test(row3),
    `${first.slice(0, 30)} | ${again.slice(0, 30)} | Status Nr. 11: ${dnf} | ${lbl1}`);
  check(28, 'Korrektur → Revision 2; Live-Liste bleibt stehen bis „Neuer Stand verfügbar“ übernommen wird',
    /Revision 2/.test(corrected) && /\+0:12/.test(stillOld) && /\+0:14/.test(nowNew), `vorher ${stillOld} → nachher ${nowNew}`);

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
  // Einzeltasten: Ziffern starten direkt die Startnummernsuche, „S“ die Namenssuche – ohne Klick
  await page.locator('.riders li').nth(5).click(); // Fokus liegt irgendwo in der Startliste
  await page.keyboard.type('31');
  const liveFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const liveVal = await page.locator('.live-search input').inputValue();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card.primary .big-bib:has-text("31")', { timeout: 5000 }).catch(() => {});
  const bibSel = await page.locator('.card.primary .big-bib').textContent();
  await page.keyboard.press('s');
  await page.keyboard.type('brandli');
  await page.waitForSelector('.live-hits li:first-child:has-text("Brändli")');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card.primary .rider-name:has-text("Brändli")', { timeout: 5000 }).catch(() => {});
  const sSel = await page.locator('.card.primary .rider-name').textContent();
  const box = await page.locator('.live-search input').boundingBox();
  const centered = box && Math.abs(box.x + box.width / 2 - 720) < 160 && box.y < 220;
  // P/F/N bleiben Kürzel und lösen keine Suche aus
  await page.keyboard.press('p');
  const pNoSearch = (await page.locator('.live-search input').inputValue()) === '';
  check('Suche', 'Live-Suche zentral; Ziffern = Startnummer, „S“ = Name, ohne vorherigen Klick',
    liveFocus === 'Fahrer suchen' && liveVal === '31' && bibSel === '31' && /Brändli/.test(sSel) && centered && pNoSearch,
    `Fokus ${liveFocus}, Feld „${liveVal}“, gewählt Nr. ${bibSel}, S→${sSel}, Feldmitte x=${box && Math.round(box.x + box.width / 2)} y=${box && Math.round(box.y)}`);
  await page.screenshot({ path: `${screens}/live-suche.png` });
  await page.keyboard.press('p'); // Anheften rückgängig

  // Name so groß wie die Startnummer
  const sizes = await page.evaluate(() => [getComputedStyle(document.querySelector('.card.primary .rider-name')).fontSize, getComputedStyle(document.querySelector('.card.primary .big-bib')).fontSize]);
  check('Name', 'Fahrername in der Karte so groß wie die Startnummer', sizes[0] === sizes[1], sizes.join(' / '));

  // Reiter Statistiken: tippen, automatisch speichern (ohne Feld zu verlassen), nach Neuladen vorhanden
  await page.getByRole('tab', { name: 'Statistiken' }).click();
  const statArea = page.getByRole('textbox', { name: 'Statistiken Ganzes Rennen' });
  await statArea.click();
  const statFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.keyboard.type('Vorjahressieger: ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Brändli');
  await page.keyboard.press('Control+b');
  await page.waitForSelector('text=✓ gespeichert', { timeout: 6000 });
  const statDb1 = await page.evaluate(async () => (await window.__lk.db.notes.toArray()).filter((n) => n.kind === 'statistik').map((n) => `${n.stageId ? 'E' : 'R'}:${n.text}`));
  await page.getByRole('tab', { name: 'Themen' }).click();
  await page.getByRole('textbox', { name: 'Themen Etappe 4' }).click();
  await page.keyboard.type('Duell am Schlussanstieg');
  await page.waitForSelector('text=✓ gespeichert', { timeout: 6000 });
  await page.screenshot({ path: `${screens}/themen.png` });
  await page.reload();
  await page.waitForSelector('.riders li');
  await page.getByRole('tab', { name: 'Statistiken' }).click();
  const statHtml = await page.getByRole('textbox', { name: 'Statistiken Ganzes Rennen' }).innerHTML();
  const statDb2 = await page.evaluate(async () => (await window.__lk.db.notes.toArray()).filter((n) => n.kind === 'statistik').map((n) => `${n.stageId ? 'E' : 'R'}:${n.deleted ? 'DEL:' : ''}${n.text}`));
  console.log('DIAG Statistik: Fokus', statFocus, '| DB nach Tippen', JSON.stringify(statDb1), '| DB nach Reload', JSON.stringify(statDb2), '| Editor', statHtml);
  await page.getByRole('tab', { name: 'Themen' }).click();
  const themaTxt = await page.getByRole('textbox', { name: 'Themen Etappe 4' }).textContent();
  // Live-Modus: Statistiken/Themen nur lesen
  await page.getByRole('button', { name: '● Live' }).click();
  await page.getByRole('tab', { name: 'Themen' }).click();
  await page.waitForSelector('.topic-read');
  const liveThema = await page.locator('.topic-read').textContent();
  await page.getByRole('tab', { name: 'Statistiken' }).click();
  await page.waitForSelector('.topic-read:has-text("Vorjahressieger")');
  const liveStat = await page.locator('.topic-read').innerHTML();
  const editable = await page.locator('.col-mid [contenteditable="true"], .col-mid .rt-toolbar').count();
  const liveBtn = await page.getByRole('button', { name: '● Live' }).boundingBox();
  check('Kopfzeile', 'Live-Knopf im Live-Modus normal groß (kein Layout-Konflikt)', liveBtn.width < 200 && liveBtn.height < 60, `${Math.round(liveBtn.width)}×${Math.round(liveBtn.height)} px`);
  await page.screenshot({ path: `${screens}/live-statistiken.png` });
  check('Live-Lesen', 'Live-Modus: Statistiken/Themen nur lesbar (kein Eingabefeld, keine Werkzeugleiste), Formatierung sichtbar',
    editable === 0 && /<b>Brändli<\/b>/.test(liveStat) && /Etappe 4.*Duell am Schlussanstieg/.test(liveThema), `${editable} bearbeitbare Elemente | ${liveThema}`);
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('tab', { name: 'Themen' }).click();
  const editAgain = await page.waitForSelector('.col-mid [contenteditable="true"]', { timeout: 5000 }).then(() => page.locator('.col-mid [contenteditable="true"]').count()).catch(() => 0);
  check('Live-Lesen', 'Im Bearbeitungsmodus wieder bearbeitbar', editAgain >= 1, `${editAgain} Editoren`);
  await page.keyboard.type('21'); await page.keyboard.press('Enter');
  const backToCard = await page.waitForSelector('.card.primary', { timeout: 5000 }).then(() => 1).catch(() => 0);
  check('Reiter', 'Statistiken/Themen: eigener Text automatisch gespeichert, fett erhalten; Fahrerwahl wechselt zur Karte',
    /<b>Brändli<\/b>/.test(statHtml) && /Duell am Schlussanstieg/.test(themaTxt) && backToCard === 1, `${statHtml.slice(0, 60)} | ${themaTxt}`);

  // Formatierung im Fahrerprofil: fett, kursiv, Markierung, Aufzählung, Einzug; Einfügen wird bereinigt
  const brId = await page.evaluate(async () => (await window.__lk.db.riders.toArray()).find((r) => r.lastName === 'Brändli').id);
  await page.goto(URL + '#fahrer-' + brId);
  const bio = page.getByRole('textbox', { name: 'Kurzbiografie' });
  await bio.click();
  await page.keyboard.type('Zeitfahrer ');
  await page.keyboard.press('Control+i'); await page.keyboard.type('aus Fiktivia'); await page.keyboard.press('Control+i');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Aufzählung' }).first().dispatchEvent('mousedown');
  await page.keyboard.type('Punkt eins');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('eingerückt');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Markieren Gelb' }).first().dispatchEvent('mousedown');
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Kurzbiografie"]');
    const dt = new DataTransfer();
    dt.setData('text/html', '<b>fett eingefügt</b><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:void(0)">Link</a>');
    dt.setData('text/plain', 'fett eingefügt');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.waitForTimeout(300);
  const bioSaved = await page.evaluate(async (id) => (await window.__lk.db.riders.get(id)).bio, brId);
  const xss = await page.evaluate(() => window.__xss ?? null);
  await page.screenshot({ path: `${screens}/formatierung.png` });
  check('Format', 'Formatierung gespeichert (kursiv, Aufzählung, Einzug, Markierung); eingefügter Schadcode entfernt',
    /<i>aus Fiktivia<\/i>/.test(bioSaved) && /<ul>/.test(bioSaved) && /<ul><li>eingerückt|<li>.*<ul>/.test(bioSaved) && /background-color:#fff1a8/.test(bioSaved) && /<b>fett eingefügt<\/b>/.test(bioSaved) && !/script|onerror|javascript|<img|<a /.test(bioSaved) && xss === null,
    bioSaved);

  // Wikipedia/Wikidata: simulierter Wikidata-Server mit CORS-Freigabe
  await page.route('https://www.wikidata.org/w/api.php**', (route) => {
    const p = new globalThis.URL(route.request().url()).searchParams;
    const json = (o) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (p.get('action') === 'wbsearchentities') {
      const s = p.get('search');
      if (s === 'Mateo Ibáñez') return json({ search: [{ id: 'Q901', label: 'Mateo Ibáñez' }] });
      if (s === 'Luca Bianchi') return json({ search: [{ id: 'Q902', label: 'Luca Bianchi' }, { id: 'Q903', label: 'Luca Bianchi' }] });
      return json({ search: [] });
    }
    const t = (time, precision = 11) => ({ mainsnak: { datavalue: { value: { time, precision } } } });
    const it = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
    const st = (v) => ({ mainsnak: { datavalue: { value: v } } });
    const E = {
      Q901: { descriptions: { de: { value: 'spanischer Radrennfahrer' } }, labels: { de: { value: 'Mateo Ibáñez' } }, claims: { P569: [t('+2003-02-14T00:00:00Z')], P1532: [it('Q29')] } },
      Q902: { descriptions: { en: { value: 'Italian cyclist' } }, labels: { en: { value: 'Luca Bianchi' } }, claims: { P569: [t('+1997-03-01T00:00:00Z')], P27: [it('Q38')] } },
      Q903: { descriptions: { en: { value: 'Italian racing cyclist' } }, labels: { en: { value: 'Luca Bianchi' } }, claims: { P569: [t('+2004-07-07T00:00:00Z')], P27: [it('Q38')] } },
      Q29: { labels: { de: { value: 'Spanien' } }, claims: { P984: [st('ESP')] } },
      Q38: { labels: { de: { value: 'Italien' } }, claims: { P984: [st('ITA')] } },
    };
    return json({ entities: Object.fromEntries(p.get('ids').split('|').map((id) => [id, E[id] ?? { missing: '' }])) });
  });
  await page.goto(URL + '#fahrer');
  await page.getByRole('button', { name: /aus Wikipedia ergänzen/ }).click();
  await page.getByText('Teilnehmer des aktiven Rennens').click();
  await page.getByRole('button', { name: 'Suchen' }).click();
  await page.waitForSelector('text=eindeutig ·', { timeout: 15000 });
  const summary = await page.locator('.wikidata p').nth(1).textContent();
  await page.screenshot({ path: `${screens}/wikidata.png`, fullPage: true });
  await page.getByRole('button', { name: /übernehmen$/ }).click();
  await page.waitForSelector('text=Fahrerprofile ergänzt');
  const wd = await page.evaluate(async () => {
    const rs = await window.__lk.db.riders.toArray();
    const m = rs.find((r) => r.lastName === 'Ibáñez');
    const bs = rs.filter((r) => r.lastName === 'Bianchi' && r.tags.includes('demo'));
    return { mateo: [m.birthDate, m.nationality, JSON.stringify(m.externalIds), m.sources], bianchi: bs.map((b) => `${b.birthDate}:${b.externalIds.length}`).sort() };
  });
  check('Wikipedia', 'Wikidata-Abgleich: Jahrgang zu Datum ergänzt, Quelle+ID gespeichert; mehrdeutige Namensvettern nur mit Jahrgang zugeordnet',
    wd.mateo[0] === '2003-02-14' && wd.mateo[1] === 'ESP' && /Q901/.test(wd.mateo[2]) && /Wikidata Q901/.test(wd.mateo[3]) && JSON.stringify(wd.bianchi) === '["1997-03-01:1","2004-07-07:1"]',
    `${summary} | ${JSON.stringify(wd)}`);
  await page.goto(URL + '#live');
  await page.waitForSelector('.riders li');
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
  globalThis.__page = page;
  const offlineLog = [];
  page.on('console', (m) => offlineLog.push(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => offlineLog.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => offlineLog.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) offlineLog.push(`response ${r.status()}: ${r.url()}`); });
  await page.goto(URL + '#live');
  try {
    await page.waitForSelector('.riders li', { timeout: 20000 });
  } catch (e) {
    const diag = await page.evaluate(async () => ({
      controller: !!navigator.serviceWorker.controller,
      caches: await caches.keys(),
      cached: (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url.split('/').pop())))).flat(),
      html: document.documentElement.outerHTML.slice(0, 300),
    })).catch((x) => String(x));
    console.log('DIAGNOSE offline:', JSON.stringify(diag, null, 1), '\n' + offlineLog.join('\n'));
    throw e;
  }
  const n = await page.locator('.riders li').count();
  const evOk = await page.locator('text=Attacke am Schlussanstieg').count();
  check('1/23', 'Offline nach Browser-Neustart ohne Server: App, Rennen, Startliste, Ereignisse verfügbar', n === 16 && evOk > 0, `${n} Fahrer`);
  await page.screenshot({ path: `${screens}/offline-neustart.png` });

  // Offline: Rennen anlegen, Startliste importieren, Notiz speichern, neu starten (Nr. 2)
  await page.goto(URL + '#rennen');
  await page.getByLabel('Name').first().fill('Offline-Rennen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.goto(URL + '#import');
  await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'Offline-Rennen' });
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
  await page.locator('fieldset:not(.tissot) select').first().selectOption({ label: 'PDF-Rennen' });
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

  // PDF-Export OFFLINE: Auswahl, Datei herunterladen, Inhalt mit pdf.js prüfen
  const cspErrors = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) cspErrors.push(m.text()); });
  await page.goto(URL + '#export');
  await page.locator('fieldset select').first().selectOption({ label: 'DEMO – Rundfahrt Fiktivia 2026' });
  await page.getByText('Nur Favoriten').click();
  const shownStage = await page.locator('fieldset select').nth(1).evaluate((el) => el.selectedOptions[0].textContent);
  await page.getByText('Gesamtwertung', { exact: true }).click();
  await page.getByText('Kurzbiografie').click();
  const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: 'PDF speichern' }).click()]);
  const pdfPath = join(userDataDir, '..', 'lk-export.pdf');
  await pdfDl.saveAs(pdfPath);
  const { getDocument } = await import(pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs', { paths: [process.cwd()] })).href);
  const pdfDoc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;
  let pdfTxt = '';
  for (let pg = 1; pg <= pdfDoc.numPages; pg++) pdfTxt += ' ' + (await (await pdfDoc.getPage(pg)).getTextContent()).items.map((i) => i.str).join(' ');
  await page.getByRole('button', { name: 'Vorschau' }).click();
  await page.waitForSelector('iframe.pdf-preview', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screens}/pdf-export.png`, fullPage: true });
  check('PDF', 'PDF-Export offline: Auswahl wirkt (Favoriten, Kurzbio, Gesamtwertung), Datei lesbar, Vorschau ohne Sicherheitsfehler',
    pdfDl.suggestedFilename().endsWith('.pdf') && /DEMO – Rundfahrt Fiktivia 2026/.test(pdfTxt) && /Jonas Brändli/.test(pdfTxt) && /Zeitfahrer/.test(pdfTxt) && /Gesamtwertung nach/.test(pdfTxt) && /Startliste \(3\)/.test(pdfTxt) && shownStage === 'Etappe 4' && /Etappe 4 · 2026/.test(pdfTxt) && cspErrors.length === 0,
    `${pdfDl.suggestedFilename()} · angezeigt ${shownStage} · ${pdfDoc.numPages} Seite(n) · CSP-Fehler ${cspErrors.length}${cspErrors[0] ? ': ' + cspErrors[0].slice(0, 80) : ''}`);

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
  const restored = await page.evaluate(async () => ({ riders: await window.__lk.db.riders.count(), editions: await window.__lk.db.editions.count(), standings: (await window.__lk.db.standings.toArray()).filter((s) => s.source.startsWith('PCS')).length }));
  check(13, 'Offline-Wiederherstellung aus Archiv in geleertem Bestand', restored.riders > 50000 && restored.editions === 4 && restored.standings >= 2, JSON.stringify(restored));

  // Tissot Timing: Abruf mit echten (gekürzten) Tissot-Antworten aus den Test-Fixtures
  await ctx.setOffline(false);
  const fxDir = 'src/import/fixtures/tissot/';
  const fxr = (n) => readFileSync(fxDir + n, 'utf8');
  const tissotHits = [];
  await page.route('https://prod.server.tissottiming.com/**', (route) => {
    const u = new globalThis.URL(route.request().url());
    tissotHits.push(u.pathname + u.search);
    const map = {
      '/competitions?year=2026': 'competitions-2026.json',
      '/competitions/tdf2026/stages': 'tdf2026-stages.json',
      '/competitions/tdf2026/stages/5/teams': 'tdf2026-s5-teams.json',
      '/competitions/tdf2026/stages/1/teams': 'tdf2026-s5-teams.json',
      '/competitions/tdf2026/stages/5/rankings/stage': 'tdf2026-s5-stage.json',
      '/competitions/tdf2026/stages/5/rankings/overall': 'tdf2026-s5-overall.json',
      '/athletes/infos/10014972740/tdf2026/0': 'athlete-pogacar.json',
      '/athletes/palmares/10014972740': 'palmares-pogacar.json',
    };
    const f = map[u.pathname + u.search];
    return route.fulfill(f
      ? { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: fxr(f) }
      : { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  await page.goto(URL + '#import');
  const tp = page.locator('fieldset.tissot');
  await tp.locator('select').first().selectOption('2026');
  await tp.getByRole('button', { name: 'Rennen von Tissot laden' }).click();
  await tp.locator('select').nth(1).selectOption('tdf');
  await tp.getByRole('button', { name: 'Als neues Rennen anlegen' }).click();
  await page.waitForSelector('text=Verknüpft mit');
  await tp.locator('select').first().selectOption('5');
  await tp.getByRole('button', { name: /Startliste laden/ }).click();
  await page.waitForSelector('text=8 Fahrer in 2 Teams');
  await page.getByRole('button', { name: '3 · Abgleichen' }).click();
  await page.getByRole('button', { name: /Bestätigte Zeilen übernehmen/ }).click();
  await page.waitForSelector('text=Import gespeichert');
  await tp.getByRole('button', { name: 'Ergebnisse und Wertungen holen' }).click();
  await page.waitForSelector('text=neu gespeichert (Revision 1)');
  await tp.getByRole('button', { name: 'Ergänzen' }).click();
  await page.waitForSelector('text=Profile ergänzt');
  await tp.getByLabel(/Automatisch aktualisieren/).click();
  await page.waitForFunction(() => document.querySelector('fieldset.tissot input[type=checkbox]:checked + strong, fieldset.tissot label.confirm input:checked') !== null);
  await page.screenshot({ path: `${screens}/tissot.png`, fullPage: true });
  const tt = await page.evaluate(async () => {
    const { db } = window.__lk;
    const ed = (await db.editions.toArray()).find((e) => e.tissot?.id === 'tdf2026');
    const st = (await db.standings.toArray()).filter((s) => s.editionId === ed.id);
    const pog = (await db.riders.toArray()).find((r) => r.externalIds.some((x) => x.value === '10014972740'));
    const gc = st.find((s) => s.kind === 'gc');
    return { name: ed.name, stages: (await db.stages.where('editionId').equals(ed.id).count()), kinds: st.map((s) => s.kind).sort().join(','), src: gc.source, pogRow: gc.rows.find((r) => r.riderId === pog.id), pog: [pog.displayName, pog.birthDate, pog.birthPlace], pal: pog.palmares?.length ?? 0, fact: pog.keyFacts[0] ?? '' };
  });
  await page.waitForFunction(() => /Tissot \d\d:\d\d/.test(document.querySelector('.status')?.textContent ?? ''), null, { timeout: 15000 });
  const badge = await page.locator('.status .badge:has-text("Tissot")').textContent();
  const autoMsg = await page.evaluate(async () => (await window.__lk.db.device.get('tissotAutoState'))?.value?.message);
  check('Tissot', 'Tissot Timing: Rennen anlegen, Startliste prüfen und übernehmen, alle Wertungen holen, Fahrerdaten mit Akzenten, Auto-Aktualisierung',
    tt.name === 'Tour de France 2026' && tt.stages === 6 && tt.kinds === 'berg,etappe,gc,nachwuchs,punkte,team' && tt.src === 'Tissot Timing' && tt.pogRow?.rank === 4 && tt.pogRow?.gapSec === 473
      && tt.pog.join('|') === 'Tadej Pogačar|1998-09-21|Komenda' && tt.pal > 300 && /^Gesamtsieg Tour de France/.test(tt.fact) && /Tissot \d\d:\d\d/.test(badge),
    `${JSON.stringify(tt)} · ${badge}: ${autoMsg} · ${tissotHits.length} Abrufe`);
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
