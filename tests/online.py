"""Ende-zu-Ende-Test Taktbuch Online (Playwright): startet die API gegen TEST_DATABASE_URL,
lädt per Einladung (Mail über einen lokalen SMTP-Fänger) ein, registriert mit TOTP, arbeitet in der App,
prüft zweites Gerät, Live-Abgleich, Zusammenführen, Verbindungsabbruch und „Passwort vergessen“.
Voraussetzung: npm install, TARGET=online python3 build.py
Aufruf: TEST_DATABASE_URL=postgres://... python3 tests/online.py"""
import asyncio, secrets, sys
from playwright.async_api import async_playwright
from online_lib import ORIGIN, ENV, API, MAILS, mail_link, totp, check, RESULT, start_server

async def synced(page, timeout=8000):
    await page.wait_for_function("()=>document.querySelector('#tbSync')?.dataset.state==='ok'", timeout=timeout)
import subprocess

async def main():
    server = start_server()
    try:
        addr = f'e2e-{secrets.token_hex(3)}@example.org'
        out = subprocess.run(API[:1] + [API[1] + 'cli.ts', 'invite', addr], env=ENV, capture_output=True, text=True, check=True).stdout
        check('CLI meldet verschickte Mail', 'Mail ist verschickt' in out)
        link = mail_link(addr, 'invite')
        check('Einladungsmail kommt an, Link wie im Terminal', link is not None and link == out.strip().splitlines()[-1])

        async with async_playwright() as p:
            b = await p.chromium.launch()
            errs = []
            # Gerät 1: Registrierung
            d1 = await b.new_context(); pg = await d1.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            await pg.goto(ORIGIN + '/login'); await pg.wait_for_selector('#fLogin:not([hidden])')
            await pg.goto(link); await pg.wait_for_selector('#fRegister:not([hidden])')   # Link im schon offenen Tab
            await pg.fill('#rEmail', addr); await pg.fill('#rPw', 'ein-langes-passwort'); await pg.fill('#rPw2', 'ein-langes-passwort')
            await pg.click('#fRegister button'); await pg.wait_for_selector('#fSetup:not([hidden])')
            check('QR-Code angezeigt', (await pg.get_attribute('#sQr', 'src') or '').startswith('data:image/png'))
            secret = (await pg.inner_text('#sSecret')).replace(' ', '')
            await pg.fill('#sCode', totp(secret)); await pg.click('#fSetup button'); await pg.wait_for_selector('#recovery:not([hidden])')
            codes = await pg.eval_on_selector_all('#codes span', 'els => els.map(e => e.textContent)')
            check('10 Recovery-Codes angezeigt', len(codes) == 10)
            await pg.click('#toApp'); await pg.wait_for_selector('[data-pf]')
            check('App geladen, Kennzeichnung online', await pg.inner_text('#ver') == 'online')
            await pg.wait_for_function(f"()=>document.querySelector('#tbKonto').textContent==='{addr}'")
            order = await pg.evaluate("()=>['.brand','#tbSync','#tbKonto'].map(s=>document.querySelector(s).getBoundingClientRect().left)")
            check('Kopfzeile: Adresse im Konto-Knopf, Titel links davor', order[0] < order[1] < order[2])
            await pg.click('[data-pf=voll]'); await pg.wait_for_selector('#tabs .tab')
            check('Neues Konto: Beispieldaten, nichts gespeichert', await pg.get_attribute('#tbSync', 'data-state') == 'demo')
            await pg.evaluate("()=>{S.demo=false;S.cfg.standardThema='E2E-Thema';S.days['2026-10-20']={t:'arbeit',s:'08:00',e:'16:30'};recompute();save()}")
            await synced(pg)
            check('Speichern auf dem Server, Anzeige „Synchronisiert“', await pg.inner_text('#tbSync') == 'Synchronisiert')
            await pg.reload(); await pg.wait_for_selector('#tabs .tab')
            check('Nach Neuladen: Daten vom Server', await pg.evaluate("()=>S.cfg.standardThema==='E2E-Thema'&&!!S.days['2026-10-20']"))
            fonts = await pg.evaluate("async()=>(await document.fonts.load(\"600 16px 'IBM Plex Sans'\")).length>0")
            check('Schriften vom eigenen Server geladen', fonts)

            # Gerät 2: Login mit Passwort + TOTP, sieht dieselben Daten, ohne Vorlagen-Frage
            d2 = await b.new_context(); pg2 = await d2.new_page()
            await pg2.goto(ORIGIN + '/'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            check('Ohne Anmeldung: Login-Seite', pg2.url.endswith('/login'))
            await pg2.fill('#lEmail', addr); await pg2.fill('#lPw', 'ein-langes-passwort'); await pg2.click('#fLogin button')
            await pg2.wait_for_selector('#fMfa:not([hidden])')
            await pg2.fill('#mCode', totp(secret, 1)); await pg2.click('#fMfa button')
            await pg2.wait_for_selector('#tabs .tab')
            check('Gerät 2: keine Vorlagen-Frage, Konto hat schon Daten', await pg2.locator('[data-pf]').count() == 0)
            check('Gerät 2 sieht die Daten von Gerät 1', await pg2.evaluate("()=>S.cfg.standardThema==='E2E-Thema'"))
            await synced(pg2)

            # Live: Gerät 2 ändert, Gerät 1 aktualisiert sich ohne Neuladen
            await pg2.evaluate("()=>{S.cfg.standardThema='von Gerät 2';save()}")
            await pg.wait_for_function("()=>S.cfg.standardThema==='von Gerät 2'", timeout=8000)
            check('Live: Gerät 1 übernimmt Änderung von Gerät 2', True)

            # Zusammenführen: beide ändern gleichzeitig verschiedene Tage, nichts geht verloren
            await pg.evaluate("()=>{S.days['2026-10-21']={t:'arbeit',s:'07:00',e:'15:00'};recompute();save()}")
            await pg2.evaluate("()=>{S.days['2026-10-22']={t:'urlaub'};recompute();save()}")
            both = "()=>!!S.days['2026-10-21']&&!!S.days['2026-10-22']&&!!S.days['2026-10-20']"
            await pg.wait_for_function(both, timeout=8000); await pg2.wait_for_function(both, timeout=8000)
            check('Gleichzeitige Änderungen an verschiedenen Tagen: beide erhalten', True)

            # Verbindung weg: Änderung bleibt lokal, übersteht Neuladen, wird danach von selbst übertragen
            await pg2.route('**/api/sync**', lambda r: asyncio.ensure_future(r.abort()))
            await pg2.evaluate("()=>{S.cfg.standardThema='offline geändert';save()}")
            await pg2.wait_for_function("()=>['offline','error'].includes(document.querySelector('#tbSync').dataset.state)", timeout=8000)
            check('Ohne Verbindung: Anzeige „Offline · lokal gesichert“', 'lokal gesichert' in await pg2.inner_text('#tbSync'))
            await pg2.reload(); await pg2.wait_for_selector('#tabs .tab')
            check('Neuladen ohne Verbindung: lokale Kopie samt Änderung', await pg2.evaluate("()=>S.cfg.standardThema==='offline geändert'&&!!S.days['2026-10-22']"))
            await pg2.unroute('**/api/sync**')
            await synced(pg2, 20000)
            await pg.wait_for_function("()=>S.cfg.standardThema==='offline geändert'", timeout=8000)
            check('Verbindung zurück: von selbst übertragen, Gerät 1 hat es', True)

            # Abmelden
            await pg2.click('#tbLogout'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            await pg2.goto(ORIGIN + '/'); await pg2.wait_for_selector('#fLogin:not([hidden])')
            check('Nach Abmelden wieder Login', pg2.url.endswith('/login'))

            # Passwort vergessen: Link per Mail, neues Passwort nur mit zweitem Faktor
            await pg2.wait_for_selector('#forgotWrap:not([hidden])')
            await pg2.fill('#lEmail', addr); await pg2.click('#toForgot'); await pg2.wait_for_selector('#fForgot:not([hidden])')
            check('E-Mail wird ins Vergessen-Formular übernommen', await pg2.input_value('#fEmail') == addr)
            await pg2.click('#fForgot button'); await pg2.wait_for_selector('#forgotSent:not([hidden])')
            reset = mail_link(addr, 'reset')
            check('Mail mit Link zum neuen Passwort kommt an', reset is not None)
            await pg2.goto(reset); await pg2.wait_for_selector('#fReset:not([hidden])')
            await pg2.fill('#xPw', 'ganz-neues-passwort'); await pg2.fill('#xPw2', 'ganz-neues-passwort'); await pg2.fill('#xCode', '000000')
            await pg2.click('#fReset button'); await pg2.wait_for_function("()=>document.querySelector('#err').textContent.length>0")
            check('Falscher Code: neues Passwort abgelehnt', 'stimmt nicht' in await pg2.inner_text('#err'))
            await pg2.fill('#xCode', codes[0]); await pg2.click('#fReset button')   # Recovery-Code als zweiter Faktor
            await pg2.wait_for_selector('#tabs .tab')
            check('Neues Passwort gesetzt, direkt angemeldet', await pg2.evaluate("()=>S.cfg.standardThema==='offline geändert'"))
            await pg.reload(); await pg.wait_for_selector('#fLogin:not([hidden])')
            check('Gerät 1 danach abgemeldet', pg.url.endswith('/login'))
            await pg.fill('#lEmail', addr); await pg.fill('#lPw', 'ganz-neues-passwort'); await pg.click('#fLogin button')
            await pg.wait_for_selector('#fMfa:not([hidden])')
            check('Login mit neuem Passwort', True)
            # erwartet: 401 nach dem Abmelden durch das Passwort-Zurücksetzen, abgebrochene Anfragen im Offline-Test
            errs = [e for e in errs if not ('Failed to load resource' in e and ('404' in e or '409' in e or '401' in e or 'net::ERR_FAILED' in e))]
            csp = [e for e in errs if 'Content Security Policy' in e or 'Refused' in e]
            check('Keine CSP-Verstöße', not csp)
            check('Keine Skriptfehler', not [e for e in errs if e not in csp])
            for e in errs: print('  ', e[:300])
            await b.close()
    finally:
        server.terminate()
    sys.exit(0 if RESULT['ok'] else 1)

asyncio.run(main())
