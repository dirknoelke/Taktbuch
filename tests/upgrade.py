"""Update-Test (Playwright): Daten, die mit der alten Version gespeichert wurden, müssen nach dem
Austausch der Datei in der neuen Version unverändert geladen und gleich berechnet werden (beide Profile).
Aufruf: python3 tests/upgrade.py alt.html dist/taktbuch.html
In der CI ist "alt" das zuletzt veröffentlichte Release (Branch dist)."""
import asyncio, json, shutil, sys, tempfile, pathlib
from playwright.async_api import async_playwright

old, new = sys.argv[1], sys.argv[2]
work = pathlib.Path(tempfile.mkdtemp()) / 'taktbuch.html'
prof = tempfile.mkdtemp()

async def main():
    async with async_playwright() as p:
        ok = True
        for profil in ('voll', 'einfach'):
            shutil.copy(old, work)
            ctx = await p.chromium.launch_persistent_context(prof + '-' + profil)
            await ctx.route('https://api.github.com/**', lambda r: r.fulfill(status=404, body=''))
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await pg.goto('file://' + str(work)); await pg.wait_for_selector('[data-pf]')
            await pg.click(f'[data-pf={profil}]'); await pg.wait_for_selector('#tabs .tab')
            await pg.evaluate("()=>{S.demo=false;S.cfg.standardThema='Upgrade-Test';S.days['2026-10-22']={t:'arbeit',s:'08:00',e:'16:30'};recompute();save()}")
            await pg.wait_for_timeout(1200)
            before = await pg.evaluate("()=>JSON.stringify(S)")
            saldo_before = await pg.evaluate("()=>JSON.stringify(R.map['2026-10-22'])")
            await ctx.close()

            shutil.copy(new, work)   # Update: neue Datei an derselben Stelle
            ctx = await p.chromium.launch_persistent_context(prof + '-' + profil)
            await ctx.route('https://api.github.com/**', lambda r: r.fulfill(status=404, body=''))
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await pg.goto('file://' + str(work)); await pg.wait_for_selector('#tabs .tab')
            after = await pg.evaluate("()=>JSON.stringify(S)")
            saldo_after = await pg.evaluate("()=>JSON.stringify(R.map['2026-10-22'])")
            st = await pg.inner_text('#saveState')
            await ctx.close()
            if json.loads(before) != json.loads(after):
                import json as J; b, a = J.loads(before), J.loads(after)
                for k in sorted(set(b) | set(a)):
                    if b.get(k) != a.get(k): print('  Unterschied in', k, str(b.get(k))[:200], '->', str(a.get(k))[:200])
            for name, cond in [(f'{profil}: Zustand identisch', json.loads(before) == json.loads(after)),
                               (f'{profil}: Berechnung identisch', json.loads(saldo_before) == json.loads(saldo_after) and json.loads(saldo_after) is not None),
                               (f'{profil}: Status geladen', st in ('geladen', 'loaded'))]:
                print(('OK   ' if cond else 'FAIL ') + name); ok &= cond
        sys.exit(0 if ok else 1)

asyncio.run(main())
