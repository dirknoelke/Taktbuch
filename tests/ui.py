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
        bt = await pg.inner_text('#updbanner'); check('Update-Banner bei neuerer Version', 'Neue Version 9.9.9' in bt or 'New version 9.9.9' in bt)
        check('Download-Link zeigt auf Asset', (await pg.get_attribute('#updDl', 'href')).endswith('zeitwerk.html'))
        await pg.click('#updSkip'); check('Später blendet aus', await pg.inner_text('#updbanner') == '')
        await pg.click('button[data-v=einst]'); await pg.click('button[data-a=sub][data-v=daten]'); await pg.click('[data-a=chkUpd]'); await pg.wait_for_function("()=>document.querySelector('#updState').textContent.includes('9.9.9')")
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

        # 4) Englisch: Umschalten, Namen, keine deutschen Reste in allen Ansichten
        pg3 = await (await b.new_context()).new_page()
        await pg3.goto(url); await pg3.click('[data-pf=voll]'); await pg3.wait_for_selector('#tabs .tab')
        await pg3.click('[data-a=lang][data-v=en]'); await pg3.wait_for_timeout(300)
        check('Tabs englisch', await pg3.inner_text('#tabs') == 'Today\nWeek\nMonth\nVacation\nActivities\nReports\nSalary\nSettings')
        STOP = set('der die das und oder für mit von zu im am ist nicht wird werden ein eine einen dem den des auf bei als auch nur wenn dann nach vor über unter alle noch schon bis aus wie sich sind kann keine kein dein deine deiner deinen du ab pro je ohne sowie'.split())
        left = []
        for t in ['heute', 'woche', 'monat', 'urlaub', 'taet', 'auswertung', 'gehalt', 'einst', 'daten']:
            await pg3.click(f'button[data-v={"einst" if t == "daten" else t}]')
            if t in ('einst', 'daten'): await pg3.click(f'button[data-a=sub][data-v={t}]')
            await pg3.wait_for_timeout(200)
            txt = await pg3.evaluate("()=>{const o=[];const w=document.createTreeWalker(document.getElementById('view'),NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const v=n.nodeValue.trim();if(v)o.push(v)}document.querySelectorAll('#view [placeholder],#view [aria-label],#view [title]').forEach(e=>['placeholder','aria-label','title'].forEach(a=>{const v=e.getAttribute(a);if(v)o.push(v)}));return o}")
            import re
            for v in txt:
                ws = re.findall(r'[A-Za-zÄÖÜäöüß]+', v)
                if re.search(r'[äöüÄÖÜß]', v) or any(w.lower() in STOP for w in ws):
                    if 'Baden-W' in v or 'ab 20' in v or 'Zeiterfassung' in v or 'Stunden.xlsm' in v: continue   # Blattnamen der Excel
                    left.append(v[:80])
        check('keine deutschen Texte im englischen UI ' + (str(left[:5]) if left else ''), not left)
        await pg3.click('[data-a=lang][data-v=de]'); await pg3.wait_for_timeout(200)
        check('zurück auf Deutsch', await pg3.inner_text('#tabs') == 'Heute\nWoche\nMonat\nUrlaub\nTätigkeiten\nAuswertung\nGehalt\nEinstellungen')
        # Zeitraster und Spaltennamen
        await pg3.click('button[data-v=heute]')
        await pg3.evaluate("()=>{S.cfg.raster='15';S.cfg.spalten={cat:'Projekt'};commit()}"); await pg3.wait_for_timeout(200)
        r = await pg3.evaluate("()=>[snap('09:07'),snap('09:08'),snap('09:22'),snap('09:23'),snap('23:58'),snap('00:03')]")
        check('Raster rundet auf/ab', r == ['09:00', '09:15', '09:15', '09:30', '23:45', '00:00'])
        await pg3.fill('#f_s', '08:07'); await pg3.dispatch_event('#f_s', 'change')
        check('Eingabe wird auf Viertelstunde gerundet', await pg3.input_value('#f_s') == '08:00')
        await pg3.fill('#f_s', '930'); await pg3.dispatch_event('#f_s', 'change')
        check('Kurzform 930 wird 09:30', await pg3.input_value('#f_s') == '09:30')
        check('Textfeld mit Auswahlliste (96 Viertelstunden)', await pg3.get_attribute('#f_s', 'list') == 'dl-t15' and await pg3.evaluate("()=>document.querySelectorAll('#dl-t15 option').length") == 96)
        await pg3.fill('#f_u', '30'); await pg3.dispatch_event('#f_u', 'change')
        check('Unterbrechung 30 wird 00:30 (Liste dl-d15)', await pg3.input_value('#f_u') == '00:30' and await pg3.get_attribute('#f_u', 'list') == 'dl-d15')
        await pg3.fill('#d_p', '40'); await pg3.dispatch_event('#d_p', 'change')
        check('Pause 40 wird 00:45', await pg3.input_value('#d_p') == '00:45')
        check('Spalte umbenannt', 'projekt' in (await pg3.inner_text('#view')).lower())
        await pg3.evaluate("()=>{S.cfg.raster='min';S.cfg.spalten={};commit()}")
        await pg3.click('button[data-v=einst]'); await pg3.click('button[data-a=sub][data-v=einst]')
        await pg3.select_option('#c_rg', 'SN'); await pg3.wait_for_timeout(300)
        check('Bundesland Sachsen: Buß- und Bettag', await pg3.evaluate("()=>E.holidayName('2026-11-18')==='Buß- und Bettag'&&S.cfg.region==='SN'"))
        await pg3.select_option('#c_rg', 'NW')
        await pg3.select_option('[data-f="colv:pn"]', 'true'); await pg3.select_option('[data-f="colv:sys"]', 'false')
        await pg3.click('button[data-v=taet]'); hd = (await pg3.inner_text('#view thead')).lower()
        check('Spalten ein-/ausblendbar', 'projektnummer' in hd and 'system' not in hd and 'kategorie' in hd)
        await pg3.evaluate("()=>{S.cfg.pnAn=false;S.cfg.spaltenAus={};commit()}")
        await b.close()
    sys.exit(0 if ok else 1)
asyncio.run(main())
