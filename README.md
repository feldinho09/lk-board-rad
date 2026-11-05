# LK Board Rad

Offline-fähiges Kommentatorenwerkzeug für Radrennen – reine Browser-App, Daten im Browser (IndexedDB), kein KI-Dienst und kein Abo nötig.

**Stand 0.1.0:** lokal nutzbarer Durchstich. Sync-Server und automatischer PCS-Import fehlen noch (siehe `docs/ABNAHMEBERICHT.md`).

## Starten (Entwicklung)

```bash
npm ci            # Node 22 LTS empfohlen
npm run dev       # http://localhost:5173 (ohne Service Worker)
npm test          # Kerntests (Vitest, IndexedDB simuliert)
```

## Produktions-Build und Offline-Test

```bash
npm run build     # erzeugt dist/ inkl. sw.js
npm run preview   # http://localhost:4173
npm run e2e       # Browser-Abnahmetests (benötigt Playwright + Chromium)
```

Playwright einmalig: `npm i -D playwright && npx playwright install chromium`.

## Hosting (HTTPS)

`dist/` ist eine rein statische Website. Jeder HTTPS-Webserver genügt (Caddy, nginx, Netlify, Cloudflare Pages, GitHub Pages, Infomaniak). Service Worker funktionieren nur über HTTPS oder auf `localhost`.

Beispiel Caddy:
```
lk-board.example.ch {
  root * /srv/lk-board/dist
  file_server
  header /sw.js Cache-Control "no-cache"
  header /index.html Cache-Control "no-cache"
}
```
`sw.js` und `index.html` dürfen nicht lange gecacht werden, sonst kommen Updates verzögert an.

**Achtung beim Domainwechsel:** Browserdaten hängen an der Adresse (Origin). Vor einem Umzug unter „Sicherung“ ein Archiv herunterladen und auf der neuen Adresse wiederherstellen.

## Alltag in Kürze

1. **Vorbereitung:** Unter *Rennen* das Rennen anlegen (Eintages- oder Etappenrennen), unter *Import* die Startliste laden (CSV, XLSX, PDF, Link oder einfügen; PDF-Ergebnis vor dem Abgleich prüfen) und mehrdeutige Zeilen entscheiden. Unter *Fahrer* Aussprache, drei Schlüsselfakten und Notizen pflegen.
2. **Vor dem Start:** *Bereitschaft* öffnen, alle Punkte prüfen und „Dauerhaften Speicher anfordern“ wählen. Unter *Sicherung* ein Archiv herunterladen und extern ablegen. Die App einmal ohne Internet öffnen.
3. **Live:** Auf „● Live“ umschalten. Startnummer einfach eintippen und `Enter` (kein Kürzel nötig), `S` oder `/` sucht nach Namen (auch `Strg K`), `Esc` bricht ab, `↑ ↓` blättert durch die Startliste, `P` heftet an, `F` markiert als Favorit, `N` öffnet das Ereignisfeld, `?` zeigt die Hilfe. Kürzel wirken nicht, während in ein Feld geschrieben wird.
4. **PDF:** Unter *PDF* auswählen, was ins Dokument soll (Fahrer, Startliste, Fahrerkarten, Statistiken, Themen, Wertungen …) und „PDF speichern“. Funktioniert auch offline.
5. **Danach:** Archiv sichern und das Rennen unter *Rennen* auf „archiviert“ setzen.

**Serverausfall / kein Internet:** Ändert nichts am lokalen Arbeiten. **Gerätewechsel:** Archiv herunterladen, auf dem neuen Gerät die App einmal online öffnen und unter *Sicherung* wiederherstellen.

## Struktur

```
src/domain   Datenmodell, Text/Zeit, Wertungsauflösung, Suche, PCS-Adaptervertrag
src/db       Dexie-Schema, atomares Schreiben + Outbox, Speicherstatus
src/import   CSV/XLSX-Parser, Zuordnungsregeln (rein), Commit/Rücknahme
src/backup   Archivformat, Prüfung, Wiederherstellung, Wiederherstellungspunkte
src/demo     fiktive Demo-Rundfahrt
src/ui       Oberfläche
e2e          Browser-Abnahmetests
docs         Architektur, Abnahmebericht
```

## Lizenzen der Abhängigkeiten

react, react-dom, papaparse, read-excel-file, fflate, pdfmake (MIT); Roboto-Schrift (Apache-2.0); dexie, dexie-react-hooks, pdfjs-dist (Apache-2.0). Entwicklung: vite, vitest, typescript, fake-indexeddb, @vitejs/plugin-react.
