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

## Ergänzung 0.1.2 – PCS-Inhalte per Kopieren & Einfügen, Offline-Fehler behoben

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| Manuell kopierte PCS-Startliste (Strg A / Strg C) erkennen | ✅ | Unit-Tests (nachgebildeter Aufbau, erfundene Namen) + e2e; zusätzlich lokal mit einer echten Kopie geprüft: 175 von 175 Fahrern, 25 Teams, Rennname/Jahr/Klasse/Distanz erkannt |
| Abgleich der erkannten Zahl mit der PCS-Angabe „N riders“ | ✅ | Warnung bei Abweichung (Unit-Test) |
| Normale Tabellen nicht fälschlich als PCS erkennen | ✅ | Beim Testen gefundener Fehler (Tab-Tabelle wurde als PCS gelesen) behoben, Regressionstest ergänzt |
| Kein automatischer Abruf von PCS | ✅ | PCS-Nutzungsbedingungen untersagen automatisierte Werkzeuge; die App liest nur, was der Nutzer selbst kopiert |
| Offline-Start trotz `Vary`-Header des Servers | ✅ | Sporadischer Fehler (1 von 4 Läufen: leere Seite offline) reproduziert; Ursache: Cache-Abgleich scheiterte an `Vary: Origin`. Behoben mit `ignoreVary`; danach 6 von 6 Läufen fehlerfrei |

### PCS-Ranglisten (manuell kopiert)

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| Etappe, Gesamt, Punkte, Berg, Nachwuchs, Team erkennen | ✅ | Lokal mit echten Kopien (Tour de France 2026, Etappe 2): 184 / 183 / 30 / 9 / 41 / 23 Zeilen, alle Fahrer zugeordnet, DNS erkannt. Unit-Tests mit nachgebildetem Aufbau |
| Spalten über die Kopfzeile, nicht über Position geraten (UCI-/PCS-Punkte ≠ Zeit) | ✅ | Unit-Test |
| „,,“ = gleiche Zeit, Siegerzeit absolut, DNS/DNF ohne Platz und Zeit | ✅ | Unit-Test |
| General vs. Today bei Punkten nicht sicher erkennbar | ✅ | App verlangt Bestätigung „Reiter General“ statt zu raten |
| Nr. 28: gleiche Daten → keine neue Revision, Korrektur → neue Revision, alte bleibt | ✅ | Unit-Test + e2e |
| Live-Liste bleibt beim Eintreffen eines neuen Stands stehen („Neuer Stand verfügbar“) | ✅ | e2e mit zweitem Tab |
| Ausfälle (DNF/DNS/OTL) optional in Teilnehmerstatus übernehmen | ✅ | e2e |
| Fahrer ohne Profil im Rennen | ✅ | bleiben mit PCS-Namen in der Liste, markiert ⚠, keine Fehlzuordnung |

## Ergänzung 0.1.3 – Formatierung, Statistiken/Themen, Wikipedia, Live-Suche

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| Formatierung (fett, kursiv, unterstrichen, Markierung in 4 Farben, Aufzählung, Nummerierung, Einzug) in Kurzbio, Stärken, Schlüsselfakten, Notizen, Rennnotizen, Statistiken, Themen | ✅ | e2e (Tastatur + Werkzeugleiste) |
| Eingefügter fremder Inhalt wird bereinigt (Skripte, Bilder, Links, Ereignis-Attribute) | ✅ | Unit-Tests + e2e mit präpariertem Einfügen: kein Code ausgeführt |
| Bisheriger Klartext bleibt gültig; Klartext für Suche/Notfallübersicht | ✅ | Unit-Tests |
| Reiter „Statistiken“ und „Themen“ (Rennen gesamt + je Etappe), automatisches Speichern beim Tippen | ✅ | e2e inkl. Neuladen; Datenbankinhalt vor/nach Neuladen identisch |
| Fahrername so groß wie Startnummer | ✅ | e2e (berechnete Schriftgröße gleich) |
| Land/Geburtsdatum aus Wikipedia (Wikidata) mit Vorschau, nur Bestätigtes, nur leere Felder (optional überschreiben), Quelle + ID gespeichert, Wiederherstellungspunkt vorher | 🟡 | Unit-Tests + e2e gegen **simulierten** Wikidata-Server. Gegen das echte Wikidata nicht getestet, weil die Testumgebung keinen Internetzugang zu Wikimedia hat – erster echter Lauf beim Nutzer |
| Live-Suche: Ziffern/S ohne Klick | ✅ | e2e; dabei Wettlauf beim schnellen Wiederöffnen gefunden und behoben |
| Statistiken/Themen im Live-Modus nur lesen (kompakt, große Schrift, Etappe zuerst, leere Bereiche ausgeblendet) | ✅ | e2e: kein Eingabefeld, keine Werkzeugleiste; im Bearbeitungsmodus wieder editierbar |
| Live-Knopf überdeckte im Live-Modus die Kopfzeile (Namenskonflikt der Stilklasse „live“) | ✅ | behoben, e2e prüft Knopfgröße |
| Editor zeigte nach dem Laden kurz ein leeres Feld | ✅ | behoben (Inhalt vor dem ersten Zeichnen gesetzt); 4 von 4 Läufen fehlerfrei |
| PDF-Export mit wählbaren Inhalten (Fahrerauswahl, Startliste, Fahrerkarten mit Einzelfeldern, Statistiken, Themen, Rennnotizen, Wertungen Top N, Renngruppen, Ereignisse; Layout hoch/quer, Schrift, Spalten) | ✅ | Unit-Tests (echtes PDF erzeugt und zurückgelesen) + e2e **offline** mit Download und Prüfung des Inhalts |
| Formatierung im PDF (fett, kursiv, unterstrichen, Markierung, Aufzählung, Einzug), Sonderzeichen | ✅ | Unit-Test + Sichtprüfung der gerenderten Seite |
| Private Notizen nur bei ausdrücklicher Wahl; Fußzeile warnt dann rot | ✅ | Unit-Test |
| PDF-Vorschau im Browser | 🟡 | Funktioniert technisch (keine Sicherheitsfehler); im Testbrowser ohne PDF-Anzeige nicht sichtbar prüfbar |

## Ergänzung 0.1.4 – Tissot Timing (automatischer Abruf)

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| Rennen von Tissot wählen, als neues Rennen samt Etappen anlegen oder bestehendes verknüpfen | ✅ | Unit-Tests + e2e |
| Startliste (mit UCI-ID) über den normalen Prüf-Import | ✅ | Unit-Tests + e2e; echter Lauf Tour de Suisse 2026: 140 Fahrer |
| Etappenergebnis, Gesamt-, Punkte-, Berg-, Nachwuchs- und Mannschaftswertung holen; zweiter Abruf ohne Änderung erzeugt keine Revision | ✅ | Unit-Tests + e2e; echter Lauf Tour de Suisse 2026 Etappe 5: alle Fahrer zugeordnet, Pogačar 15:08:43, Carapaz +6:32 |
| Alle Zeitformate lesbar | ✅ | Prüfung gegen 79 Etappen/Rennen 2025–2026 bei Tissot: keine unlesbaren Werte |
| Ausfälle (DNF/DNS/OTL) übernehmen, nie automatisch zurücksetzen | ✅ | Unit-Tests; echter Lauf: 48 Ausfälle Tour de Suisse 2026 |
| Fahrerdaten: Geburtsdatum, Geburtsort, Nation, Akzente – nur leere Felder | ✅ | Unit-Tests + e2e; echter Lauf: 140/140 ergänzt in 84 s |
| Fehlende UCI-IDs nur über eindeutige Namen zuordnen | ✅ | Unit-Test |
| Automatische Aktualisierung mit Statusanzeige im Kopf, pausiert nach Rennende | ✅ | e2e |
| Automatische Aktualisierung während einer laufenden Etappe | 🟡 | Logik getestet; ein echter Renntag liegt ausserhalb der Saison noch nicht vor |
| Live-Zwischenstände während der Etappe (Tissot-Live-Endpunkte) | ⬜ | nicht umgesetzt; ausserhalb der Saison nicht prüfbar |

## Nicht umgesetzt (nächste Schritte, Etappe B → C)

1. Konfigurierbares Board (Blöcke, Vorlagen) mit Entwurf → Vorschau → Freigabe.
2. Anhänge (Streckenprofil als Bild/PDF), Audio-Aussprache.
3. Fahrer zusammenführen, Mehrfachbearbeitung, eigene Felder, Duplizieren von Rennen mit Auswahl.
4. Rennpaket-Export/-Import (Teilbestand), verschlüsselte Archive, optionaler Backupordner.
5. Tab-Koordination (Web Locks), Migrationssperre bei mehreren Tabs.
6. Import-/Sync-Server (nach Hosting-Entscheid) und PCS-Anbindung (nach Zugang).
7. Tests auf dem Windows-Hauptgerät, in Firefox und in Safari sowie die 8-Stunden-Simulation.
