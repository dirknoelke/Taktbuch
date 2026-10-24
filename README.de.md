# Taktbuch

*Früher: Zeitwerk.*

[English](README.md) | **Deutsch**

Persönliches Stundenkonto als Einzeldatei: Zeiterfassung, Tätigkeiten, Auswertung, Gehalt und Urlaubsplanung. Läuft komplett lokal im Browser, es gibt keinen Server und keine Anmeldung. Die Daten liegen in IndexedDB deines Browsers.

## Benutzen

1. Auf der Seite [Releases](../../releases/latest) die Datei `taktbuch.html` herunterladen.
2. Per Doppelklick im Browser öffnen (Chrome oder Edge). Auf dem Firmenrechner reicht die lokale Datei, es ist kein Zugriff auf Webseiten nötig.
3. Beim ersten Start eine Vorlage wählen (mit oder ohne Urlaubsverfall und Kappung). Alle Regeln lassen sich unter **Einstellungen** einzeln ändern.
4. Optional: unter **Einstellungen → Daten** eine bestehende Stunden-Excel importieren.

Wichtig: Immer im selben Browser und mit demselben Profil öffnen, sonst sind die Daten nicht da. Unter **Einstellungen → Daten** gibt es eine Sicherung als JSON (auch zum Umzug auf ein anderes Gerät).

## Sprache

Die App gibt es auf Deutsch und Englisch. Umschalten mit **DE / EN** oben rechts. Beim ersten Start wird die Browsersprache vorgewählt.

## Updates

Die App fragt höchstens einmal am Tag bei GitHub nach der neuesten Version. Dabei geht nur die Versionsnummer raus, keine Daten. Gibt es eine neue Version, erscheint oben ein Hinweis mit Download-Button. Neue Datei laden, vorher unter **Daten** eine Sicherung speichern, dann die neue Datei statt der alten öffnen. Die Daten bleiben im Browser erhalten. Ist GitHub nicht erreichbar, passiert nichts.

## Entwickeln

```bash
python3 build.py              # baut dist/taktbuch.html
node tests/engine.test.js     # Rechenlogik
pip install playwright && playwright install chromium
python3 tests/ui.py dist/taktbuch.html   # UI-Smoketest
```

Aufbau: `packages/core/engine.js` (reine Rechenlogik, kein DOM), `packages/web/app/` (Zustand, Ansichten, Gehalt, Aktionen), `packages/web/storage/` (Speicher-Adapter, offline: IndexedDB), `packages/web/template.html` (Gerüst und CSS), `packages/web/i18n.js` und `packages/web/i18n-en.js` (Sprachumschaltung und englisches Wörterbuch). Die App ist auf Deutsch geschrieben, der englische Text kommt aus dem Wörterbuch: neue deutsche Texte brauchen dort einen Eintrag (Schlüssel = deutscher Text, Zahlen als `#`). Der UI-Test meldet deutsche Reste im englischen UI. Der Build setzt alles zu einer Datei ohne Fremdbibliotheken zusammen.

### Neue Version veröffentlichen

1. `VERSION` hochzählen, `CHANGELOG.md` ergänzen (Abschnitt `## x.y.z`) und `packages/web/whatsnew.json` (Anzeige „Was ist neu“ nach dem Update).
2. Committen, dann Tag setzen und pushen:
   ```bash
   git tag vX.Y.Z && git push origin main --tags
   ```
3. Der Workflow `Release` baut die Datei, prüft Tag gegen `VERSION` und legt das Release mit `taktbuch.html` an. Der Text kommt aus dem Changelog und erscheint in der App unter "Was ist neu?".

Die Update-Prüfung nutzt das Repo aus `REPO.txt` (im Release-Build automatisch das aktuelle Repo).

## Lizenz

MIT, siehe [LICENSE](LICENSE).

Hilfe: [docs/HILFE.md](docs/HILFE.md)
