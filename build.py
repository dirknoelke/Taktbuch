#!/usr/bin/env python3
"""Baut die Einzeldatei dist/taktbuch.html (Offline-Variante).

Aufruf:  python3 build.py
Optional: ZW_REPO=owner/repo  (Repo für die Update-Prüfung, Standard siehe REPO.txt)
          TARGET=offline      dist/taktbuch.html, Daten in IndexedDB (Standard)
          TARGET=online       dist/online/taktbuch.html + login.html, Daten über die Server-API

Quellen:  packages/core  Rechenlogik (engine.js), ohne DOM, auch serverseitig nutzbar
          packages/web   Oberfläche; Speicherzugriff über packages/web/storage/<adapter>.js
"""
import os, pathlib, re, subprocess, sys

root = pathlib.Path(__file__).parent
read = lambda p: (root / p).read_text(encoding='utf-8')
version = read('VERSION').strip()
repo = os.environ.get('ZW_REPO') or read('REPO.txt').strip()

STORAGE = {'offline': 'indexeddb.js', 'online': 'api.js'}   # Build-Ziel -> Speicher-Adapter
target = os.environ.get('TARGET', 'offline')
if target not in STORAGE:
    sys.exit(f'Unbekanntes TARGET {target!r}, erlaubt: {", ".join(STORAGE)}')
if target == 'online':
    repo = ''   # online gibt es keine Update-Prüfung: der Server liefert immer die aktuelle Version

WEB = 'packages/web/'
order = ['1-kern.js', '2-ansichten.js', '3-gehalt.js', '4-aktionen.js', '5-hilfe.js']  # Reihenfolge ist wichtig
storage = read(WEB + 'storage/' + STORAGE[target])
app_files = [read(WEB + 'app/' + f) for f in order]
app_files.insert(1, storage)   # Adapter direkt nach 1-kern.js (dort sind PROFILES/PROFILE definiert)
app = '\n'.join([read(WEB + 'i18n-en.js'), read(WEB + 'i18n.js')] + app_files)
html = read(WEB + 'template.html')
assert '//@@ENGINE@@' in html and '//@@APP@@' in html
GOOGLE_FONTS = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">\n')
FONTS = [('IBM Plex Sans', 400, 'IBMPlexSans-Regular'), ('IBM Plex Sans', 500, 'IBMPlexSans-Medium'), ('IBM Plex Sans', 600, 'IBMPlexSans-SemiBold'),
         ('IBM Plex Sans Condensed', 500, 'IBMPlexSansCondensed-Medium'), ('IBM Plex Sans Condensed', 600, 'IBMPlexSansCondensed-SemiBold'), ('IBM Plex Sans Condensed', 700, 'IBMPlexSansCondensed-Bold'),
         ('IBM Plex Mono', 400, 'IBMPlexMono-Regular'), ('IBM Plex Mono', 500, 'IBMPlexMono-Medium'), ('IBM Plex Mono', 600, 'IBMPlexMono-SemiBold')]
if target == 'online':
    # Online: Schriften vom eigenen Server (unveränderte IBM-Plex-Dateien, SIL OFL), keine Anfrage an Google.
    assert GOOGLE_FONTS.search(html), 'Google-Fonts-Block im Template nicht gefunden'
    faces = ''.join(f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;font-display:swap;src:url('/fonts/{f}.woff2') format('woff2')}}\n" for fam, w, f in FONTS)
    html = GOOGLE_FONTS.sub('<style>\n' + faces + '</style>\n', html)
html = html.replace('//@@ENGINE@@', read('packages/core/engine.js'))
import json
help_ = json.loads(read(WEB + 'help.json')); whats = json.loads(read(WEB + 'whatsnew.json'))
js = lambda o: json.dumps(o, ensure_ascii=False).replace('</', '<\\/')
meta = f"window.__ZW_VERSION={version!r};window.__ZW_REPO={repo!r};window.__ZW_TARGET={target!r};window.ZW_HELP={js(help_)};window.ZW_WHATS={js(whats)};\n"
html = html.replace('//@@APP@@', meta + app)

out = root / 'dist' if target == 'offline' else root / 'dist' / 'online'
out.mkdir(parents=True, exist_ok=True)
(out / 'taktbuch.html').write_text(html, encoding='utf-8')
if target == 'online':
    for page in ('login.html', 'konto.html', 'admin.html'):
        (out / page).write_text(read(WEB + 'online/' + page), encoding='utf-8')
    import shutil
    shutil.copytree(root / WEB / 'fonts', out / 'fonts', dirs_exist_ok=True)
# Hilfe als Markdown-Dateien (gleiche Quelle wie in der App)
def md(h, whats_title, l):
    t = [f"# {h['title']}", '', h['intro'], '']
    for sec in h['sections']:
        t += [f"## {sec['h']}", ''] + [x + '\n' for x in sec.get('p', [])] + [f"- {x}" for x in sec.get('li', [])] + ['']
    t += [f'## {whats_title}', '']
    for v in sorted(whats, key=lambda v: [int(x) for x in v.split('.')], reverse=True):
        t += [f'### {v}', ''] + [f"- {x}" for x in whats[v][l]] + ['']
    return '\n'.join(t).rstrip() + '\n'
(root / 'docs').mkdir(exist_ok=True)
(root / 'docs' / 'HILFE.md').write_text(md(help_['de'], 'Was ist neu', 'de'), encoding='utf-8')
(root / 'docs' / 'HELP.md').write_text(md(help_['en'], "What's new", 'en'), encoding='utf-8')
print(f'{out.relative_to(root)}/taktbuch.html  Version {version}  Ziel {target}  Repo {repo}  {len(html)//1024} KB')

# Syntaxprüfung, falls Node vorhanden
try:
    tmp = out / '_check.js'
    tmp.write_text(app, encoding='utf-8')
    r = subprocess.run(['node', '--check', str(tmp)], capture_output=True, text=True)
    tmp.unlink()
    if r.returncode:
        print(r.stderr); sys.exit(1)
    print('Syntax OK')
except FileNotFoundError:
    print('Node nicht gefunden, Syntaxprüfung übersprungen')
