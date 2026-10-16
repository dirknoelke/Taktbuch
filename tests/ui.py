"""UI-Smoketest (Playwright): Profilwahl, Erkennung vorhandener Daten, Update-Banner.
Aufruf: python3 tests/ui.py dist/zeitwerk.html"""
import asyncio, json, sys, pathlib
from playwright.async_api import async_playwright
url = 'file://' + str(pathlib.Path(sys.argv[1]).resolve())
REL = {'tag_name': 'v9.9.9', 'html_url': 'https://github.com/x/y/releases/tag/v9.9.9', 'body': 'Test-Hinweise',
       'assets': [{'name': 'zeitwerk.html', 'browser_download_url': 'https://github.com/x/y/releases/download/v9.9.9/zeitwerk.html'}]}
async def main():
    ok = True
    def check(name, cond):
        nonlocal ok; print(('OK   ' if cond else 'FAIL ') + name); ok &= bool(cond)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # 1) frischer Start: Profilwahl, dann Beispieldaten
        ctx = await b.new_context(); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await ctx.route('https://api.github.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(REL)))
        await pg.goto(url); await pg.wait_for_selector('[data-pf]')
        check('Profilwahl erscheint', await pg.locator('[data-pf]').count() == 2)
        await pg.click('[data-pf=einfach]'); await pg.wait_for_selector('#tabs .tab')
        check('Profil einfach: kein Verfall', await pg.evaluate("()=>S.cfg.urlaubVerfall===''&&S.cfg.mirAn===false"))
        await pg.wait_for_selector('#updbanner .banner', timeout=8000)
        check('Update-Banner bei neuerer Version', 'Neue Version 9.9.9' in await pg.inner_text('#updbanner'))
        check('Download-Link zeigt auf Asset', (await pg.get_attribute('#updDl', 'href')).endswith('zeitwerk.html'))
        await pg.click('#updSkip'); check('Später blendet aus', await pg.inner_text('#updbanner') == '')
        await pg.click('button[data-v=daten]'); await pg.click('[data-a=chkUpd]'); await pg.wait_for_function("()=>document.querySelector('#updState').textContent.includes('9.9.9')")
        check('manuelle Prüfung meldet Version', True)
        await pg.evaluate("()=>{S.cfg.standardThema='Testthema';save()}"); await pg.wait_for_timeout(900)
        # 2) Neuladen im selben Kontext: Profil wird erkannt, keine Wahl
        await pg.reload(); await pg.wait_for_selector('#tabs .tab')
        check('zweiter Start ohne Wahl, Daten da', await pg.evaluate("()=>PROFILE==='einfach'&&S.cfg.standardThema==='Testthema'"))
        check('keine JS-Fehler', not errs)
        # 3) Update-Prüfung offline: kein Fehler, kein Banner
        ctx2 = await b.new_context(); pg2 = await ctx2.new_page(); e2 = []
        pg2.on('pageerror', lambda e: e2.append(str(e)))
        await ctx2.route('https://api.github.com/**', lambda r: r.abort())
        await pg2.goto(url); await pg2.click('[data-pf=voll]'); await pg2.wait_for_selector('#tabs .tab'); await pg2.wait_for_timeout(2500)
        check('offline: kein Banner, keine Fehler', await pg2.inner_text('#updbanner') == '' and not e2)
        check('Profil voll hat Verfall', await pg2.evaluate("()=>S.cfg.urlaubVerfall==='05-01'"))
        await b.close()
    sys.exit(0 if ok else 1)
asyncio.run(main())
