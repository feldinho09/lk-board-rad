# Abnahmebericht – Rad Command Center 2.0

Stand: 15. November 2026. Geprüft mit Chromium (Playwright, headless) gegen den Produktions-Build sowie mit Unit-Tests (Vitest).

| Prüfung | Stand | Nachweis |
| --- | --- | --- |
| Rennen anlegen (Rundfahrt mit Etappen und Daten, Eintagesrennen) | ✅ | Unit + Browser |
| PCS-Startliste einfügen; Namen lesbar („HIRSCHI Marc“ → „Marc Hirschi“), Partikel korrekt, Profile über den Namen verknüpft | ✅ | Unit + Browser |
| Startliste erneut einfügen: Notizen und Status bleiben, Nachmeldungen und neue Nummern werden übernommen, Entfernen nur auf Wunsch | ✅ | Unit |
| Profil aus der Startliste anlegen; Stammdaten und Abschnitte bearbeiten; „Aktuell“ mit Änderungsdatum | ✅ | Unit + Browser |
| Formatierung wie MotoGP: schwebende Leiste, Leuchtstift mit Bedeutung, Stern, Aufzählung, Einzug | ✅ | Browser (Leuchtstift und Stern gespeichert), Unit (Bereinigung) |
| PCS-Fahrerseite einfügen: nur leere Felder und Abschnitte; eigene Angaben bleiben | ✅ | Unit + Browser |
| PCS-Knöpfe öffnen ein eigenes Fenster „pcs“; keine Einbettung, kein automatischer Abruf | ✅ | Browser |
| Profile von Rennen zu Rennen übernehmen (ein Profil, mehrere Rennen) | ✅ | Unit + Browser |
| Themen mit Rennen-, Etappen- und Fahrerbezug, ★ hervorgehoben | ✅ | Unit + Browser |
| LIVE: Startnummer oder Name tippen, Fahrerkarte mit ★ zuoberst, Etappe und Themen rechts | ✅ | Browser |
| Suche über alles (Strg K), akzentunabhängig, auch in Texten | ✅ | Unit + Browser |
| PDF mit wählbaren Inhalten | ✅ | Unit (Inhalt) + Browser (Datei) |
| Sicherung herunterladen, prüfen, wiederherstellen; Wiederherstellungspunkte | ✅ | Unit + Browser |
| Start ohne Internet mit allen Daten | ✅ | Browser |
| Keine Programmfehler im Browser während des ganzen Ablaufs | ✅ | Browser |

Offen bzw. nicht geprüft:
- Darstellung in Firefox und Safari (Hauptbrowser ist Chrome/Edge).
- Echte, vollständige PCS-Kopien sind nur lokal geprüft; im Repository liegen erfundene Beispiele im PCS-Aufbau.
