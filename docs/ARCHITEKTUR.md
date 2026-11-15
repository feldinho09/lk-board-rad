# Rad Command Center – Ziel und Aufbau

Stand: 15. November 2026 · Version 2.0 (Neubau, ersetzt das „LK Board Rad“)

## 1 Ziel

Persönliches Vorbereitungs- und Live-Werkzeug für TV-Kommentare von Radrennen. Das Center ist die Sammelstelle für alles Eigene: Fahrerprofile, Renn- und Etappenwissen, Statistiken, Geschichten, Hintergründe, Notizen und Zitate. Startliste und Fahrerinfos holt der Nutzer selbst von ProCyclingStats (PCS): Seite kopieren und einfügen. Es gibt keinen automatischen Abruf.

Vorbild für Gestaltung und Bedienung ist das MotoGP Command Center des Nutzers. Übernommen sind:
- **Farben:** Asphalt #1a1d21 als Grundton, Flaggen-Gelb #ffc93c als Akzent.
- **Schriften:** Bahnschrift/DIN für Überschriften, Segoe UI für Text.
- **Formatierung:** dieselbe schwebende Leiste mit Aufzählung, Einzug, Stern, Fett, Kursiv, fünf Leuchtstiften und Entfernen.

## 2 Entscheide (15. 11. 2026)

| Punkt | Entscheid |
| --- | --- |
| Ort | wie bisher eigene URL: https://feldinho09.github.io/lk-board-rad/, offline-fähig |
| Aus dem alten Board übernommen | nur PDF-Export (neu gebaut). Tissot-Abruf, Ranglisten-Live, Wikipedia-Abruf und alter Datenbestand entfallen |
| Alte Version | im Repository als Zweig `board-v1` erhalten. Die alten Daten bleiben im Browser unberührt (anderer Datenbankname) |
| PCS | kein automatischer Abruf und keine Einbettung als Reiter (Nutzungsbedingungen, Ziffern (f) und (g): weder automatisierte Werkzeuge noch Framing ohne schriftliche Erlaubnis; PCS hat abgelehnt). Stattdessen PCS-Knöpfe, die ein eigenes Fenster „pcs“ öffnen und wiederverwenden, sowie Chrome Split View bzw. Edge „Geteilter Bildschirm“ |

## 3 Inhalte

- **Fahrer:** werden nur für die wichtigsten Fahrer angelegt, vom Nutzer selbst. Ein Profil gilt über alle Rennen hinweg.
  - Stammdaten: Name, Nation, Team, Geburtsdatum und -ort, Wohnort, Grösse, Gewicht, Fahrertyp, Aussprache, PCS-Kennung.
  - Abschnitte in dieser Reihenfolge: **Aktuell** (zuoberst, mit Änderungsdatum), Erfolge, Person, Persönliches, Allgemein, Zitate.
- **Rennen:** Rundfahrt oder Eintagesrennen.
  - Abschnitte: Aktuell, Favoriten, Strecke, Geschichte, Statistik, Zitate.
  - Etappen mit Datum, Start, Ziel, km, Profil und Notizen.
  - Startliste mit Startnummer, Team, Status und einer Notiz pro Fahrer für dieses Rennen.
- **Fahrer von Rennen zu Rennen:** Beim Einfügen einer Startliste werden Profile über den Namen verknüpft (akzent- und reihenfolgeunabhängig). „Profil-Fahrer übernehmen“ fügt Profile hinzu, die zuletzt gefahrenen zuerst.
- **Themen:** Statistik, Geschichte, Hintergrund, Notiz und Zitat, jeweils mit Titel, Text und Quelle. Ein Thema kann mit einem Rennen, einer Etappe und mehreren Fahrern verknüpft und mit ★ hervorgehoben werden.
- **LIVE (nur Lesen):**
  - links das Feld nach Teams, Profile markiert,
  - Mitte die Fahrerkarte (★-Zeilen zuoberst, danach Aktuell, Themen, Erfolge …),
  - rechts Etappe, Rennabschnitte und Themen.
  - Tastatur: Eine Ziffer sucht die Startnummer, ein Buchstabe oder `/` sucht den Namen.
- **Suche** (Strg K): über Fahrer (auch in den Texten), Rennen und Themen.
- **PDF:** Rennabschnitte, Etappen, Startliste, Profile mit gewählten Abschnitten und Themen, jeweils wählbar.
- **Sicherung:**
  - ZIP mit Prüfsummen und offen lesbarer Fahrerliste; wird vor dem Wiederherstellen vollständig geprüft.
  - Wiederherstellungspunkte entstehen automatisch vor Startliste, PCS-Übernahme, Löschen und Wiederherstellen; die letzten 20 bleiben erhalten.

## 4 Formatierung

Gespeichert wird bereinigtes HTML. Erlaubt sind nur fett, kursiv, unterstrichen, Listen, Einzug und Hintergrundfarben aus der Palette; alles andere wird beim Speichern, Einfügen und Anzeigen entfernt.

Leuchtstifte (Farben wie MotoGP, Bedeutungen für den Radsport):

| Farbe | Bedeutung |
| --- | --- |
| Gelb | Titel / Leadertrikot |
| Grün | Rekord / Bestwert |
| Blau | Statistik |
| Rot | Sturz / Ausfall |
| Orange | Hintergrund |

**Stern:** „★“ am Anfang einer Zeile oder eines Listenpunkts holt diese Zeile in LIVE nach oben und hebt sie hervor (siehe `splitStarred`).

## 5 Technik

- **Bibliotheken:** Vite, React 19, TypeScript, Dexie (IndexedDB, Datenbank `rad-command-center`), pdfmake (PDF), fflate (ZIP).
- **Offline:** eigener Service Worker; ein Update wird nur auf Klick aktiviert, nie in LIVE. Alle 15 Minuten und beim Zurückkehren zum Tab sucht das Center nach einer neuen Version.
- **Speichern:** Jeder Schreibvorgang läuft in einer Transaktion. „Gespeichert“ erscheint erst nach dem Abschluss. Gelöscht wird als Löschmarkierung.
- **Tests:**
  - Unit-Tests: Fachlogik, PCS-Erkennung, Formatierung, PDF, Sicherung.
  - Browser-Tests: der ganze Ablauf inklusive Offline-Neustart.
