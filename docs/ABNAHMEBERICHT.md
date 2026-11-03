# Abnahmebericht – LK Board Rad 0.1.0

Stand 3. November 2026. Ehrliche Einordnung nach Bauplan Abschnitt 16. Eine visuelle Demo oder simulierte Funktion zählt **nicht** als bestanden.

**Testumgebung:** Linux-Cloud-Container, Node 22.23, Chromium (Playwright 1.x, headless, 1440×900). Das ist **nicht** das Referenzgerät (Windows-Laptop, Chrome/Edge). Alle Leistungswerte sind deshalb vorläufig und auf dem Hauptgerät zu wiederholen.

**Wiederholbar:** `npm test` (20 Kerntests, IndexedDB simuliert) und `npm run build && npm run e2e` (11 Browserprüfungen im echten Chromium, 3 Läufe in Folge bestanden; Ergebnisse in `e2e/results.json`).

Legende: ✅ bestanden (automatisiert geprüft) · 🟡 teilweise / nur Teilaspekt geprüft · ⬜ offen, nicht umgesetzt · ⛔ externe Blockade

| Nr. | Prüfung | Stand | Nachweis / Bemerkung |
| --- | --- | --- | --- |
| 1 | Offline nach vollständigem Schließen neu starten | ✅ | e2e: Server gestoppt, Browserprofil geschlossen und neu geöffnet, Netz aus → Rennen, Startliste, Ereignisse da. Anhänge gibt es noch nicht. |
| 2 | Offline Fahrer/Rennen anlegen, importieren, Notiz, Neustart | ✅ | e2e |
| 3 | Hartes Beenden nach bestätigtem Speichern | 🟡 | „Lokal gespeichert“ erst nach Commit; abgebrochene Transaktion speichert nichts (Unit-Test). Ein echter Prozess-Kill wurde nicht getestet. |
| 4 | Dieselbe Startliste zweimal | ✅ | Unit-Test: keine neuen Personen/Teilnahmen, Bericht „3 unverändert“ |
| 5 | Namensgleiche, Akzente, 007, widersprüchliche IDs | ✅ | Unit + e2e |
| 6 | Aktualisierte Liste mit fehlendem Fahrer/neuer Nummer | ✅ | Unit-Test; fehlende Person wird nur angezeigt |
| 7 | Teamänderung im Profil | 🟡 | Team ist Momentaufnahme der Teilnahme (Unit-Test). „Vorbereitete Rennen kontrolliert aktualisieren“ fehlt noch. |
| 8 | Layout/Infos während Live ändern | ⬜ | Konfigurierbares Board mit Entwurf/Freigabe fehlt (Etappe B). Wertungen bleiben bis zur Übernahme stehen; Bearbeitungsformulare sind im Live-Modus gesperrt. |
| 9–11 | Mehrgeräte-Konflikte, Netzabbruch, Löschung vs. Altstand | ⬜ | Sync-Server fehlt. Vorbereitet: Outbox in derselben Transaktion, stabile IDs, Revisionen, Löschmarkierungen. |
| 12 | Server nicht erreichbar | 🟡 | Ohne Server ist lokales Arbeiten der Normalzustand; ein echter Server-Ausfall ist erst mit Etappe C prüfbar. |
| 13 | Backup in leerem, vorbereitetem Browser offline wiederherstellen | ✅ | e2e (50 017 Fahrer, 2 Rennen). Ohne Anhänge, weil es noch keine gibt. |
| 14 | Beschädigtes Archiv | ✅ | Unit-Test: Prüfsummenfehler und Nicht-ZIP werden vor dem Ersetzen erkannt; Bestand bleibt unverändert. |
| 15 | Alten Stand wiederherstellen, dann Server verbinden | 🟡 | Nach Restore: Sync pausiert, Warteschlange geleert, neue Gerätekennung. Der Wiederaufnahmeprozess fehlt mit dem Server. |
| 16 | Speicher voll / Schreibfehler | 🟡 | Unit-Test: Transaktionsfehler → nichts gespeichert, Fehlerbanner, Eingabetext bleibt. Volles Kontingent im Browser nicht simuliert. |
| 17 | 50 000 Profile, Suche p95 < 200 ms | 🟡 | Gemessen: p50 5 ms, p95 13 ms (90 Suchanfragen). Das Referenzgerät fehlt noch, außerdem hat das Testrennen 16 statt 500 Teilnehmer. |
| 18 | Tastaturbedienung, kein horizontales Scrollen | ✅ | e2e auf 1440×900. Andere Auflösungen bzw. großer Schriftmodus sind noch zu prüfen. |
| 19 | Eingehender Sync bei aktiver Karte | ⬜ | Abhängig vom Sync; Startliste ist fest nach Startnummer sortiert, Auswahl per ID. |
| 20 | Ohne KI-Dienst | ✅ | Die App ruft keinerlei externe Dienste auf (CSP `connect-src 'self'`). |
| 21 | Externe Datenquelle unterbrochen | ⬜ | Keine externe Live-Quelle angebunden; Gruppenabstände werden nach 5 min als „VERALTET“ markiert. |
| 22 | 8-Stunden-Simulation | ⬜ | Nicht durchgeführt. |
| 23 | Browser schließen, Renn-URL offline öffnen | ✅ | e2e (zusammen mit Nr. 1) |
| 24 | Persistenz abgelehnt, Speichergrenze, Daten gelöscht | 🟡 | Bereitschaftscheck zeigt eine Ablehnung als Warnung; Restore nach Löschung ist geprüft (Nr. 13). Eine Ablehnung wurde nicht simuliert. |
| 25 | Zwei Tabs + App-Update | 🟡 | Kein automatischer Reload/skipWaiting, Update im Live-Modus nur „vorbereitet“. Tab-Koordination und Migrationssperre fehlen noch. |
| 26–31 | PCS-Import, Revisionen, Historie, Fehlerfälle | ⛔ | Kein autorisierter PCS-Zugang. Adaptervertrag und Revisionsregel (Fehler/leere Antwort ersetzt nichts) sind per Unit-Test geprüft. |
| 27 | Etappenergebnis vor Gesamtwertung | ✅ | e2e + Unit-Test mit Demo-Daten: „Gesamtwertung nach Etappe 3 … Stand nach Etappe 4 noch nicht vorhanden“ |
| 32 | Punkte, Team, Prolog, gleiche Zeit, DNS/DNF | 🟡 | Demo-Fixtures: DNF ohne Platz und Zeit (Unit-Test), Team-Wertung mit Teams. OTL- und echte PCS-Fixtures fehlen. |
| 33 | Domainwechsel | 🟡 | Export/Restore-Weg ist vorhanden und geprüft; ein Umzug wurde nicht durchgespielt. In der README dokumentiert. |
| 34 | Backupordner-Berechtigung entzogen | ⬜ | Optionaler Backupordner nicht umgesetzt; nur Archiv-Download. |

## Umgesetzt in 0.1.0

Rennen (Eintages-/Etappenrennen, Prolog/EZF/MZF, Halbetappen über Reihenfolge), Status und Archivierung · rennunabhängige Fahrerverwaltung mit Aliasnamen, Aussprache, 3 Schlüsselfakten, Notizen und Teilnahmehistorie · Startlistenimport CSV/XLSX/Einfügen mit Spaltenerkennung, speicherbaren Zuordnungen, Zeilenstatus, Endzustandsprüfung, atomarem Commit, Protokoll, Fehlerbericht und sicherer Rücknahme · Live-Ansicht (Startliste mit Filtern, Fahrerkarte mit Rennkorrektur, Vergleich bis 4, Wertungen mit Stand-Beschriftung und „Neuer Stand verfügbar“, Renngruppen mit Abstand/Messzeit, Ereignisprotokoll mit Rennzeit) · Rennuhr · Suche (Startnummer zuerst, akzentfrei) · Tastenkürzel · hell/dunkel/Kontrast, große Schrift · Bereitschaftscheck · Archiv-Sicherung mit Prüfsummen, Wiederherstellung, Wiederherstellungspunkte · druckbare Notfallübersicht · fiktive Demo-Rundfahrt · Service Worker mit Offline-Start.

## Ergänzung 0.1.1 – PDF- und Link-Import

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| PDF mit Teamblöcken nebeneinander (2 Seiten), Sonderzeichen, Nr. 007 | ✅ | Unit-Test mit echtem PDF + e2e **offline** im Browser |
| PDF als Tabelle (Spalten nach Position), automatische Spaltenzuordnung | ✅ | Unit-Test + e2e |
| Kontrollierbare Zwischenstufe (Bauplan 7): Werte korrigierbar, Abgleich erst nach Bestätigung | ✅ | e2e: Abgleich-Knopf vorher gesperrt, Korrektur wird übernommen |
| PDF ohne Textebene (Scan) | 🟡 | Klare Meldung statt erfundener Einträge; OCR nicht umgesetzt (Etappe D) |
| Link zu PDF/CSV/XLSX/HTML-Tabelle | 🟡 | e2e mit simuliertem Veranstalter-Server **mit** CORS-Freigabe. Seiten ohne CORS-Freigabe sind aus dem Browser nicht lesbar → verständliche Meldung; automatischer Abruf folgt mit dem Importserver |
| ProCyclingStats-Link | ✅ | wird ohne autorisierten Zugang bewusst nicht abgerufen (e2e) |

Bekannte Grenze der Erkennung: ungewöhnliche Layouts (z. B. Name vor Nummer, Teams nur als Fußnote) werden unvollständig erkannt – die Prüftabelle zeigt das, und „Tabelle (Spalten nach Position)“ ist die Ausweichvariante.

## Nicht umgesetzt (nächste Schritte, Etappe B → C)

1. Konfigurierbares Board (Blöcke, Vorlagen) mit Entwurf → Vorschau → Freigabe.
2. Anhänge (Streckenprofil als Bild/PDF), Audio-Aussprache.
3. Fahrer zusammenführen, Mehrfachbearbeitung, eigene Felder, Duplizieren von Rennen mit Auswahl.
4. Rennpaket-Export/-Import (Teilbestand), verschlüsselte Archive, optionaler Backupordner.
5. Tab-Koordination (Web Locks), Migrationssperre bei mehreren Tabs.
6. Import-/Sync-Server (nach Hosting-Entscheid) und PCS-Anbindung (nach Zugang).
7. Tests auf dem Windows-Hauptgerät, in Firefox und in Safari sowie die 8-Stunden-Simulation.
