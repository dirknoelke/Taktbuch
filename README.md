# Zeitwerk

Persönliches Stundenkonto als Einzeldatei: Zeiterfassung, Tätigkeiten, Auswertung, Gehalt und Urlaubsplanung. Läuft komplett lokal im Browser, es gibt keinen Server und keine Anmeldung. Die Daten liegen in IndexedDB deines Browsers.

## Benutzen

1. Auf der Seite [Releases](../../releases/latest) die Datei `zeitwerk.html` herunterladen.
2. Per Doppelklick im Browser öffnen (Chrome oder Edge). Auf dem Firmenrechner reicht die lokale Datei, es ist kein Zugriff auf Webseiten nötig.
3. Beim ersten Start eine Vorlage wählen (mit oder ohne Urlaubsverfall und Kappung). Alle Regeln lassen sich unter **Daten** einzeln ändern.
4. Optional: unter **Daten** eine bestehende Stunden-Excel importieren.

Wichtig: Immer im selben Browser und mit demselben Profil öffnen, sonst sind die Daten nicht da. Unter **Daten** gibt es eine Sicherung als JSON (auch zum Umzug auf ein anderes Gerät).

## Updates

Die App fragt höchstens einmal am Tag bei GitHub nach der neuesten Version. Dabei geht nur die Versionsnummer raus, keine Daten. Gibt es eine neue Version, erscheint oben ein Hinweis mit Download-Button. Neue Datei laden, vorher unter **Daten** eine Sicherung speichern, dann die neue Datei statt der alten öffnen. Die Daten bleiben im Browser erhalten. Ist GitHub nicht erreichbar, passiert nichts.

## Entwickeln

```bash
python3 build.py              # baut dist/zeitwerk.html
node tests/engine.test.js     # Rechenlogik
pip install playwright && playwright install chromium
python3 tests/ui.py dist/zeitwerk.html   # UI-Smoketest
```

Aufbau: `src/engine.js` (reine Rechenlogik, kein DOM), `src/app/` (Zustand, Ansichten, Gehalt, Aktionen), `src/template.html` (Gerüst und CSS). Der Build setzt alles zu einer Datei ohne Fremdbibliotheken zusammen.

### Neue Version veröffentlichen

1. `VERSION` hochzählen und `CHANGELOG.md` ergänzen (Abschnitt `## x.y.z`).
2. Committen, dann Tag setzen und pushen:
   ```bash
   git tag vX.Y.Z && git push origin main --tags
   ```
3. Der Workflow `Release` baut die Datei, prüft Tag gegen `VERSION` und legt das Release mit `zeitwerk.html` an. Der Text kommt aus dem Changelog und erscheint in der App unter "Was ist neu?".

Die Update-Prüfung nutzt das Repo aus `REPO.txt` (im Release-Build automatisch das aktuelle Repo).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
