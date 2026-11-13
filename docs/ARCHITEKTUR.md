# LK Board Rad – Ziel, Annahmen und Architekturentscheid

Stand: 3. November 2026 · Version 0.1.0 (Durchstich Etappe A / Teile von B)

## 1 Verstandenes Ziel

Ein persönliches Werkzeug für die Live-Kommentierung von Radrennen. Es läuft vollständig im Browser und bleibt ohne Internet und ohne Server nutzbar. Es verbindet eine dauerhafte, rennunabhängige Fahrerdatenbank, Rennen mit Etappen und Wertungen sowie eine ruhige Live-Ansicht. Datenintegrität hat Vorrang vor Funktionsfülle: Nichts wird still überschrieben, gelöscht, erfunden oder als gespeichert gemeldet, wenn es nicht gespeichert ist.

## 2 Geklärte Angaben (3. 11. 2026)

| Punkt | Entscheid | Folge |
| --- | --- | --- |
| Hauptbrowser/-gerät | Chrome/Edge (aktuell) auf Windows-Laptop | Testmatrix: Chromium primär; Firefox und Safari werden vor Produktivbetrieb geprüft. Keine Chromium-only-Funktion in Kernfunktionen. |
| Hosting Sync-/Importserver | noch offen | Etappe B rein lokal; Sync-Protokoll ist vorbereitet (Outbox), Server folgt in Etappe C. |
| PCS-Zugang | keiner | Adaptervertrag + Testdaten. Automatischer PCS-Import ist **externe Blockade**, keine fertige Funktion. |
| Repository | vorerst ZIP | Code wird als Archiv geliefert; später `git init` und Push in ein Repo unter Kontrolle des Nutzers. |

## 3 Vorgeschlagene Voreinstellungen für übrige offene Punkte

- Startnummern-Eindeutigkeit: pro Rennen (umstellbar auf pro Kategorie).
- Vergleich: bis 4 angeheftete Fahrer.
- Wiederherstellungspunkte: alle 15 min bei Änderungen, letzte 20 behalten, geschützte nie automatisch löschen.
- Historischer PCS-Umfang (sobald Zugang besteht): aktuelle + vorherige Saison und die letzten 3 Austragungen des aktiven Rennens.
- Server (Vorschlag für Etappe C): kleiner VPS in der Schweiz/EU, Docker Compose, Caddy (automatisches TLS), Node/TypeScript-Dienst, PostgreSQL, nächtliche verschlüsselte Datenbanksicherung auf ein zweites Ziel. Geschätzt 5–15 CHF/Monat plus Domain, ohne PCS-Datenkosten.

## 4 Architekturentscheid

**Stack:** TypeScript, React 19, Vite 8, Dexie 4 (IndexedDB), eigener Service Worker ohne Workbox, papaparse (CSV), read-excel-file (XLSX), fflate (ZIP). Alle Abhängigkeiten MIT bzw. Apache-2.0, Versionen exakt fixiert, keine CDN-Abfragen, Systemschriften.

**Warum so:**
- *IndexedDB über Dexie*: transaktional, große Datenmengen, Indizes (Mehrfachindex für akzentfreie Suchschlüssel). Dexie ist eine dünne, verbreitete Schicht und keine Sync-Plattform. Alternativen: SQLite-WASM mit OPFS (stärkeres SQL, aber in Safari/Firefox uneinheitlicher und mit mehr Betriebsrisiko), RxDB/PouchDB (eingebaute Replikation, aber Lizenz- bzw. Konfliktmodell passt nicht zu feldweisen redaktionellen Konflikten).
- *Eigener Service Worker*: ca. 60 Zeilen, vollständig nachvollziehbar. Updates werden nur vorbereitet und nie automatisch aktiviert; im Live-Modus gibt es keinen Reload.
- *Hash-Routing*: Jede Renn-URL lädt offline aus `index.html`, ohne serverseitige Umschreiberegeln. Damit genügt jedes statische Hosting.

**Folgekosten:** IndexedDB-Migrationen sind selbst zu pflegen (Dexie-Versionen). Für den eigenen Sync-Server ist eigener Code nötig; dafür bleibt das Konfliktverhalten unter Kontrolle.

## 5 Datenmodell und Versionierung

Umgesetzt wie im Bauplan, Abschnitt 11 (siehe `src/domain/types.ts`). Wichtige Punkte:

- **Fahrer** existieren einmal. **Teilnahme** trägt Startnummer (immer Text), Team *bei diesem Rennen* (Momentaufnahme), Status und rennbezogene Übersteuerungen (z. B. Aussprache nur für dieses Rennen).
- **Rennserie → Austragung → Etappe** mit ausdrücklicher `order` (Prolog 0, Halbetappen z. B. 3 / 3.5).
- **Wertungsstand** ist ein eigener Datensatz je Art (Etappe, GC, Punkte, Berg, Nachwuchs, Team) und Etappe, mit Quelle, Abrufzeit, Quellrevision, Quellstatus und Abdeckung. Mannschaftswertungen referenzieren Teams und keine Fahrer. Fehlende Zeit ist `null` und nie 0.
- **Jeder Datensatz** hat `id` (UUID, lokal erzeugt, stabil), `rev` und eine Löschmarkierung (`deleted`) statt hartem Löschen.
- **Outbox**: Jede Änderung legt in *derselben* IndexedDB-Transaktion einen Versandauftrag (opId, Entität, Basisrevision) ab. Das ist die Grundlage für idempotenten Sync in Etappe C.

**Profiländerungen, Freigaben, Archiv – Zusammenspiel:**
- Alles Rennspezifische, das sich nicht still ändern darf (Team, Startnummer, Status, Rennkorrekturen), liegt in der Teilnahme. Profiländerungen wirken deshalb nie rückwirkend auf vergangene Rennen.
- Wertungsstände sind unveränderliche Revisionen; eine Korrektur erzeugt eine neue Revision. Die gerade gelesene Rangliste bleibt stehen, bis „Neuer Stand verfügbar – übernehmen“ geklickt wird.
- *Noch offen (Etappe B):* versionierte Board-Layouts (Entwurf → Freigabe) und eine Momentaufnahme der beim Archivieren verwendeten Profilangaben (Schlüsselfakten, Aussprache) je Rennen. Vorgesehen ist ein `editionSnapshot` beim Statuswechsel auf „archiviert“, damit nicht bei jeder Änderung dupliziert wird.

## 6 Offline, Speichern, Sicherung

- „✓ Lokal gespeichert“ erscheint erst nach erfolgreichem Transaktions-Commit. Ein Fehler wird dauerhaft als roter Banner angezeigt, und der eingegebene Text bleibt im Feld.
- Der Bereitschaftscheck zeigt getrennt: App-Code offline bereit, dauerhafter Speicher gewährt oder nicht (eine Ablehnung zählt nicht als Erfolg), Speicherbelegung, aktives Rennen, offene Importzeilen, letzter lokaler Wiederherstellungspunkt, letzter Archiv-Download (ausdrücklich nicht als „extern gesichert“ bezeichnet), Sync- und PCS-Status.
- Das Sicherungsarchiv (`.zip`) enthält `manifest.json` (Format, Version, SHA-256 je Datei), `data.json` als konsistenten Snapshot aus *einer* Lesetransaktion sowie offen lesbare CSV-Dateien mit Formelschutz. Gerätedaten und Warteschlange werden nicht exportiert.
- Wiederherstellung: Zuerst wird im Speicher vollständig geprüft (Prüfsummen, Format, Verweise). Danach folgt ein Wiederherstellungspunkt des aktuellen Bestands, dann ein atomarer Austausch. Anschließend ist Sync pausiert und die Gerätekennung neu.

## 7 Synchronisierung (Etappe C, Entwurf)

Push: Outbox-Operationen mit `opId` und Basisrevision; der Server bestätigt dauerhaft, eine erneut gesendete `opId` liefert dasselbe Ergebnis. Pull: Änderungen ab einem serverseitigen Fortschrittsmarker. Konflikte werden feldweise mit Basiswert, lokaler und entfernter Fassung behandelt; fachlich verbundene Felder (Startnummer + Kategorie) werden gemeinsam geprüft. Löschungen laufen über die vorhandenen Löschmarkierungen. Tab-Koordination erfolgt über die Web Locks API, mit BroadcastChannel als Rückfallebene. Nichts davon ist umgesetzt oder getestet.

## 7a Tissot Timing (automatischer Abruf, seit 13. 11. 2026)

**Rechtsgrundlage:** Laut Auskunft des Nutzers (13. 11. 2026) ist das automatische Holen der Daten bei Tissot Timing erlaubt. Die schriftliche Quelle (Link/Mail) wird hier nachgetragen, sobald sie vorliegt. Die allgemeinen Nutzungsbedingungen von tissotwatches.com untersagen Data-Mining; spezifische Bedingungen für tissottiming.com waren nicht auffindbar.

**Quelle:** Die öffentliche Website tissottiming.com lädt ihre Daten als JSON von `https://prod.server.tissottiming.com` (CORS offen). Das LK Board nutzt dieselben Endpunkte direkt aus dem Browser, ohne Server dazwischen:

| Zweck | Endpunkt |
| --- | --- |
| Rennen eines Jahres | `/competitions?year=2026` (Strasse: sport `CRD`, Typ `GrandTour`/`SingleRace`) |
| Etappen | `/competitions/{kürzel}{jahr}/stages` (z. B. `tdf2026`) |
| Startliste mit UCI-ID und Status (OK/DNF/DNS/OTL) | `/competitions/{id}/stages/{n}/teams` |
| Etappenergebnis bzw. Gesamtstände nach der Etappe | `/competitions/{id}/stages/{n}/rankings/stage` bzw. `/overall` |
| Fahrer: Vor-/Nachname mit Akzenten, Geburtsdatum, Geburtsort | `/athletes/infos/{uciId}/{id}/0` |

Nicht genutzt (noch): Live-Endpunkte während der Etappe (`/live`, `/liverankings`, SignalR), Timeline (Sprint-/Bergwertungen unterwegs), Palmarès (`/athletes/palmares/{uciId}`), Weltmeisterschaften (`/events`/`phases`). Die Live-Endpunkte liessen sich ausserhalb der Saison nicht prüfen.

**Abdeckung (geprüft 13. 11. 2026, alle Werte lesbar):** 2025 und 2026 Paris–Nice, Critérium du Dauphiné / Tour Auvergne-Rhône-Alpes, Tour de Romandie, Tour de Suisse (Männer/Frauen), Tour de France (Männer/Frauen), Vuelta (Männer/Frauen), Deutschland Tour, Paris–Roubaix, Flèche Wallonne, Liège–Bastogne–Liège (je Männer/Frauen), Eschborn–Frankfurt, Paris–Tours.

**Regeln:**
- Startlisten laufen durch den normalen Prüf-Import (Abgleich, Bestätigung, Rücknahme, Wiederherstellungspunkt).
- Wertungen: jede inhaltlich neue Fassung = neue Quellrevision; unveränderte Daten erzeugen keine Revision. Zuordnung zuerst über UCI-ID, dann eindeutigen Namen; Rest bleibt mit Quellnamen erhalten.
- Ausfälle werden nur Richtung „ausgeschieden“ übernommen, nie automatisch zurück auf „aktiv“.
- Fahrerdaten: nur leere Felder; Akzent-Schreibweise nur bei sonst identischem Namen (alte Schreibweise wird Aliasname).
- Schonend: Anfragen streng nacheinander, ≥ 350 ms Abstand, ohne Cookies/Referrer. Automatische Aktualisierung nur auf Wunsch, alle 2–15 Minuten, nur für das verknüpfte Rennen, pausiert 36 h nach Start der letzten Etappe; bei Fehlern verlängert sich das Intervall bis 30 Minuten.
- Zeiten: Tissot schreibt je nach Rennen `16:32:07`, `4:59:39"`, `21:47''`, `15h08'43"`, `06'32"`, `28`; `' '` = gleiche Zeit; negative Rückstände kommen vor. Alle Varianten werden gelesen und als Originalwert zusätzlich gespeichert.

## 8 Verbesserungsvorschläge zum Bauplan

1. **Zwei getrennte Zeitstempel je Wertung**: „fachlicher Stand“ (nach Etappe X) und „Abrufzeit“. Das ist umgesetzt, sollte aber im Bauplan als Pflichtfeld stehen.
2. **Namensgleichheit plus ein bestätigendes Merkmal** (Nationalität oder Jahrgang) als ausdrückliche Zuordnungsregel; ein widersprechendes Merkmal schließt aus. Das ist präziser als „mehrere Merkmale“.
3. **Startnummern-Plausibilität am Endzustand prüfen** statt pro Zeile: So sind Startnummerntausch zwischen zwei Fahrern beim Re-Import möglich, Doppelvergaben aber blockiert.
4. **Testanbindung `?testhooks`**: für automatisierte Abnahmetests im echten Browser. Sie verschafft keinen zusätzlichen Zugriff über die Entwicklertools hinaus.
5. **PCS früh klären**: Ohne Zugang bleiben die Abnahmekriterien 26–31 dauerhaft offen. Eine Anfrage an PCS ist ein gesonderter Nutzerauftrag.
