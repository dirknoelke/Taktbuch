#!/usr/bin/env python3
"""Baut die Einzeldatei dist/zeitwerk.html.

Aufruf:  python3 build.py
Optional: ZW_REPO=owner/repo  (Repo für die Update-Prüfung, Standard siehe REPO.txt)
"""
import os, pathlib, re, subprocess, sys

root = pathlib.Path(__file__).parent
read = lambda p: (root / p).read_text(encoding='utf-8')
version = read('VERSION').strip()
repo = os.environ.get('ZW_REPO') or read('REPO.txt').strip()

order = ['1-kern.js', '2-ansichten.js', '3-gehalt.js', '4-aktionen.js']  # Reihenfolge ist wichtig
app = '\n'.join([read('src/i18n-en.js'), read('src/i18n.js')] + [read('src/app/' + f) for f in order])
html = read('src/template.html')
assert '//@@ENGINE@@' in html and '//@@APP@@' in html
html = html.replace('//@@ENGINE@@', read('src/engine.js'))
meta = f"window.__ZW_VERSION={version!r};window.__ZW_REPO={repo!r};\n"
html = html.replace('//@@APP@@', meta + app)

out = root / 'dist'
out.mkdir(exist_ok=True)
(out / 'zeitwerk.html').write_text(html, encoding='utf-8')
print(f'dist/zeitwerk.html  Version {version}  Repo {repo}  {len(html)//1024} KB')

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
