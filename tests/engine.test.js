// Mini-Test der Rechenlogik ohne Fremddaten. Aufruf: node tests/engine.test.js
const E = require('../src/engine.js');
let fail = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok ? '' : '  erwartet ' + JSON.stringify(b) + ', war ' + JSON.stringify(a))); };
// Feiertage NRW werden berechnet, nicht gelistet
eq('Karfreitag 2026', E.holidays(2026)['2026-04-03'] != null, true);
eq('Ostermontag 2031', E.holidays(2031)['2031-04-14'] != null, true);
eq('Fronleichnam 2040', E.holidays(2040)['2040-05-31'] != null, true);
eq('3. Oktober', E.holidayName('2026-10-03') != null, true);
// Zahltag
eq('Zahltag letzte4 Okt 2026', E.paydayMode(2026, 10, 'letzte4'), '2026-10-27');
eq('Zahltag 15. Nov 2026 (Sonntag) davor', E.paydayMode(2026, 11, 'tag15'), '2026-11-13');
eq('Zahltag erster Werktag Nov 2026', E.paydayMode(2026, 11, 'erster'), '2026-11-02');
eq('Zahltag letzter Werktag Dez 2026', E.paydayMode(2026, 12, 'letzter'), '2026-12-30');
// Zeitkonto: ohne Eintrag zählt jeder Werktag das Soll als Minus, Urlaub zählt nicht
const cfg = Object.assign({}, E.DEFAULTS, { startDatum: '2026-01-05', startSaldo: 0, startUrlaub: 10, soll: 7.5, sollVerlauf: [{ ab: '2026-01-05', soll: 7.5 }], kappungTag: '', urlaubVerfall: '' });
const last = r => r[r.length - 1];
eq('2 Werktage ohne Eintrag', Math.round(last(E.run({}, {}, cfg, '2026-01-06', null)).konto * 100) / 100, -15);
const ru = last(E.run({ '2026-01-05': { t: 'Urlaub' } }, {}, cfg, '2026-01-06', null));
eq('1 Urlaubstag: Konto nur 1 Tag Minus', Math.round(ru.konto * 100) / 100, -7.5);
eq('1 Urlaubstag: Resturlaub 9', ru.rest, 9);
console.log(fail ? fail + ' Fehler' : 'alle Tests bestanden'); process.exit(fail ? 1 : 0);
