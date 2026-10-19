# Zeitwerk

**English** | [Deutsch](README.de.md)

A personal time account as a single file: time tracking, activities, reports, salary and vacation planning. It runs entirely in your browser. There is no server and no login, your data is stored in the browser's IndexedDB. The app is available in English and German.

## Use it

1. Download `zeitwerk.html` from the [latest release](../../releases/latest).
2. Open it by double-click in a browser (Chrome or Edge). The local file is enough, no web access is needed.
3. On first start choose a template (with or without vacation expiry and time-balance cap). Every rule can be changed individually later under **Daten / Data**.
4. Optional: import an existing hours Excel file under **Daten / Data**.

Always open the file in the same browser, otherwise your data is not there. Under **Data** you can save a JSON backup (also to move to another device).

## Language

Switch between English and German with **DE / EN** in the top right. On first start the browser language is preselected.

## Updates

The app asks GitHub for the latest release at most once a day. Only the version number is requested, no data is sent. When a newer version exists, a banner appears at the top with a download button. Download the new file, save a backup under **Data**, then open the new file instead of the old one. Your data stays in the browser. If GitHub is not reachable, nothing happens.

## Develop

```bash
python3 build.py              # builds dist/zeitwerk.html
node tests/engine.test.js     # calculation logic
pip install playwright && playwright install chromium
python3 tests/ui.py dist/zeitwerk.html   # UI smoke test, incl. English UI
```

Layout: `src/engine.js` (pure calculation logic, no DOM), `src/app/` (state, views, salary, actions), `src/template.html` (markup and CSS), `src/i18n.js` and `src/i18n-en.js` (language switch and English dictionary). The build bundles everything into one file without third-party libraries.

The app is written in German (including code comments). The English text comes from the dictionary in `src/i18n-en.js`: key = German text with numbers as `#`, value = English text. A new German text needs an entry there, otherwise it stays German in the English UI. The UI test reports leftover German.

### Publish a new version

1. Bump `VERSION` and add a section `## x.y.z` to `CHANGELOG.md`, commit and push.
2. Run the **Release** workflow (GitHub: Actions, Release, Run workflow), or push a tag `vX.Y.Z`.
3. The workflow builds the file, creates the tag and the release with `zeitwerk.html`. The release text comes from the changelog and shows in the app under “What’s new?”.

The update check uses the repository from `REPO.txt` (in release builds automatically the current repository).

## License

MIT, see [LICENSE](LICENSE).
