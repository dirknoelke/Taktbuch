"""Ende-zu-Ende-Test Taktbuch Online (Playwright): startet die API gegen TEST_DATABASE_URL,
lädt per Einladung ein, registriert mit TOTP, arbeitet in der App, prüft zweites Gerät und Konflikt.
Voraussetzung: npm install, TARGET=online python3 build.py
Aufruf: TEST_DATABASE_URL=postgres://... python3 tests/online.py"""
import asyncio, base64, hashlib, hmac, os, secrets, struct, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright

PORT = 18080
ORIGIN = f'http://localhost:{PORT}'
DB = os.environ['TEST_DATABASE_URL']
ENV = dict(os.environ, DATABASE_URL=DB, PUBLIC_ORIGIN=ORIGIN, PORT=str(PORT), HOST='127.0.0.1',
           TOTP_KEY=base64.b64encode(secrets.token_bytes(32)).decode(), SECURE_COOKIES='false', TRUST_PROXY='false')
API = ['node', 'packages/api/src/']

def totp(secret_b32, offset=0):
    key = base64.b32decode(secret_b32.replace(' ', '') + '=' * (-len(secret_b32.replace(' ', '')) % 8))
    step = int(time.time() // 30) + offset
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1_000_000).zfill(6)

ok = True
def check(name, cond):
    global ok
    print(('OK   ' if cond else 'FAIL ') + name); ok &= bool(cond)

async def main():
    server = subprocess.Popen(API[:1] + [API[1] + 'main.ts'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(ORIGIN + '/readyz', timeout=1); break
            except Exception: time.sleep(0.5)
        else:
            print(server.stderr.read().decode()[-3000:]); raise SystemExit('API startet nicht')
        email = f'e2e-{secrets.token_hex(3)}@example.org'
        out = subprocess.run(API[:1] + [API[1] + 'cli.ts', 'invite', email], env=ENV, capture_output=True, text=True, check=True).stdout
        link = out.strip().splitlines()[-1]
        check('CLI erzeugt Einladungslink', link.startswith(ORIGIN + '/login#invite='))

        async with async_playwright() as p:
            b = await p.chromium.launch()
            errs = []
            # Gerät 1: Registrierung
            d1 = await b.new_context(); pg = await d1.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            await pg.goto(link); await pg.wait_for_selector('#fRegister:not([hidden])')
            await pg.fill('#rEmail', email); await pg.fill('#rPw', 'ein-langes-passwort'); await pg.fill('#rPw2', 'ein-langes-passwort')
            await pg.click('#fRegister button'); await pg.wait_for_selector('#fSetup:not([hidden])')
            check('QR-Code angezeigt', (await pg.get_attribute('#sQr', 'src') or '').startswith('data:image/png'))
            secret = (await pg.inner_text('#sSecret')).replace(' ', '')
            await pg.fill('#sCode', totp(secret)); await pg.click('#fSetup button'); await pg.wait_for_selector('#recovery:not([hidden])')
            check('10 Recovery-Codes angezeigt', await pg.locator('#codes span').count() == 10)
            await pg.click('#toApp'); await pg.wait_for_selector('[data-pf]')
            check('App geladen, Kennzeichnung online', await pg.inner_text('#ver') == 'online')
            await pg.click('[data-pf=voll]'); await pg.wait_for_selector('#tabs .tab')
            await pg.evaluate("()=>{S.demo=false;S.cfg.standardThema='E2E-Thema';S.days['2026-10-20']={t:'arbeit',s:'08:00',e:'16:30'};recompute();save()}")
            await pg.wait_for_function("()=>['gespeichert','saved'].includes(document.querySelector('#saveState').textContent)", timeout=5000)
            check('Speichern auf dem Server', True)
            await pg.reload(); await pg.wait_for_selector('#tabs .tab')
            check('Nach Neuladen: Daten vom Server', await pg.evaluate("()=>S.cfg.standardThema==='E2E-Thema'&&!!S.days['2026-10-20']"))

            # Gerät 2: Login mit Passwort + TOTP, sieht dieselben Daten
            d2 = await b.new_context(); pg2 = await d2.new_page()
            await pg2.goto(ORIGIN + '/'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            check('Ohne Anmeldung: Login-Seite', pg2.url.endswith('/login'))
            await pg2.fill('#lEmail', email); await pg2.fill('#lPw', 'ein-langes-passwort'); await pg2.click('#fLogin button')
            await pg2.wait_for_selector('#fMfa:not([hidden])')
            await pg2.fill('#mCode', totp(secret, 1)); await pg2.click('#fMfa button')
            await pg2.wait_for_selector('[data-pf]'); await pg2.click('[data-pf=voll]'); await pg2.wait_for_selector('#tabs .tab')
            check('Gerät 2 sieht die Daten von Gerät 1', await pg2.evaluate("()=>S.cfg.standardThema==='E2E-Thema'"))

            # Gerät 2 speichert, Gerät 1 ist veraltet -> Konflikt statt Überschreiben
            await pg2.evaluate("()=>{S.cfg.standardThema='von Gerät 2';save()}")
            await pg2.wait_for_function("()=>['gespeichert','saved'].includes(document.querySelector('#saveState').textContent)", timeout=5000)
            await pg.evaluate("()=>{S.cfg.standardThema='veraltet von Gerät 1';save()}")
            await pg.wait_for_selector('#tbReload', timeout=5000)
            check('Konflikt: Hinweis auf Gerät 1', 'anderen Gerät' in await pg.inner_text('#banner'))
            await pg2.reload(); await pg2.wait_for_selector('#tabs .tab')
            check('Konflikt: Stand von Gerät 2 bleibt erhalten', await pg2.evaluate("()=>S.cfg.standardThema==='von Gerät 2'"))

            # Abmelden
            await pg2.click('#tbLogout'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            await pg2.goto(ORIGIN + '/'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            check('Nach Abmelden wieder Login', pg2.url.endswith('/login'))
            # erwartet: 404 (neuer Nutzer hat noch keine Daten) und 409 (gewollter Konflikt)
            errs = [e for e in errs if not ('Failed to load resource' in e and ('404' in e or '409' in e))]
            csp = [e for e in errs if 'Content Security Policy' in e or 'Refused' in e]
            check('Keine CSP-Verstöße', not csp)
            check('Keine Skriptfehler', not [e for e in errs if e not in csp])
            fonts = await pg.evaluate("async()=>(await document.fonts.load(\"600 16px 'IBM Plex Sans'\")).length>0")
            check('Schriften vom eigenen Server geladen', fonts)
            for e in errs: print('  ', e[:300])
            await b.close()
    finally:
        server.terminate()
    sys.exit(0 if ok else 1)

asyncio.run(main())
