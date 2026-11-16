# Rad Command Center – Regeln für Claude

Persönliches Vorbereitungs- und Live-Werkzeug eines TV-Live-Kommentators für Radrennen.
Offline-fähige Browser-App, veröffentlicht unter https://feldinho09.github.io/lk-board-rad/.
Hauptbrowser des Nutzers: Chrome/Edge unter Windows. Aufbau und Entscheide: `docs/ARCHITEKTUR.md`.

## Sprache
- Mit dem Nutzer Deutsch (Schweiz) schreiben: „ss“ statt „ß“, Datumsformat de-CH.
- Oberfläche, Fehlermeldungen, Doku und Commit-Nachrichten auf Deutsch, in einfacher Sprache.

## Feste Regeln (nicht verhandelbar)
- **ProCyclingStats (PCS):** kein automatischer Abruf (kein Scraping, kein fetch auf procyclingstats.com) und keine Einbettung (kein iframe/Framing). PCS hat die Erlaubnis abgelehnt (Nutzungsbedingungen (f) und (g)). Erlaubt sind nur Links (`window.open(url, 'pcs')` bzw. `<a target="pcs">`) und das Lesen von Text, den der Nutzer selbst kopiert und einfügt.
- Echte PCS-Kopien nie ins Repository; Testdaten selbst nachbauen.
- Klassemente/Ranglisten-Import wurde auf Wunsch entfernt – nicht wieder einbauen.
- **Privatsphäre:** Die E-Mail-Adresse des Nutzers erscheint nirgends (Code, Commits, Doku, externe Anfragen).
- **Git:** Autor `feldinho09 <feldinho09@users.noreply.github.com>`. Kein Force-Push, kein Umschreiben der Historie. Zweig `board-v1` (alte Version) nicht löschen.
- Wikipedia-Abruf (Geosuche/Kurzfassungen mit `origin=*`) und Tissot Timing sind erlaubt.

## Technik
- Vite, React 19, TypeScript, Dexie 4 (IndexedDB `rad-command-center`), pdfmake, fflate, eigener Service Worker.
- Schreiben nur über `mutate()` (eine Transaktion, rev/updatedAt). Löschen = Löschmarkierung (`deleted`), nie hart.
- Neue Tabellen: neue Dexie-Version in `src/db/db.ts`, in `DATA_TABLES` aufnehmen und Sicherung (`src/backup/archive.ts`) prüfen – ältere Sicherungen müssen weiter einlesbar sein.
- Geräte-Einstellungen in der Tabelle `device` (nicht in der Sicherung).
- Rich-Text ist bereinigtes HTML (`src/domain/richtext.ts`); nur die Palette der fünf Leuchtstifte, ★ am Zeilenanfang hebt in LIVE hervor.
- Farben über CSS-Variablen (`--accent`, `--star-bg`, `--k-*`), damit Dunkel und Hell lesbar bleiben (Text ≥ 4.5:1). Keine festen Farben in Komponenten.
- LIVE ist nur zum Lesen und muss mit der Tastatur bedienbar bleiben (Ziffer = Startnummer, Buchstabe = Name, + / − = km to go, Esc).
- Ein Update wird nie automatisch aktiviert, nur auf Klick.

## Vor jedem Push
1. `npm run build` (inkl. `tsc -b`) ohne Fehler.
2. `npm test` (Vitest) grün; neue Logik bekommt Unit-Tests.
3. `npm run e2e` (Playwright gegen `vite preview`) grün; neue Abläufe dort ergänzen. Bildschirmfotos landen in `e2e/screens/`.
4. `docs/ARCHITEKTUR.md` und `docs/ABNAHMEBERICHT.md` nachführen, Version in `package.json` erhöhen.
5. Nach dem Push prüfen, dass der GitHub-Lauf „Test und Veröffentlichung“ erfolgreich ist.
