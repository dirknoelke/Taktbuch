// Mini-Test der Rechenlogik ohne Fremddaten. Aufruf: node tests/engine.test.js
const E = require('../src/engine.js');
let fail = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok ? '' : '  erwartet ' + JSON.stringify(b) + ', war ' + JSON.stringify(a))); };
// Feiertage NRW werden berechnet, nicht gelistet
eq('Karfreitag 2026', E.holidays(2026)['2026-04-03'] != null, true);
eq('Ostermontag 2031', E.holidays(2031)['2031-04-14'] != null, true);
eq('Fronleichnam 2040', E.holidays(2040)['2040-05-31'] != null, true);
E.setRegion('BY'); eq('BY: Heilige Drei Könige 2026', E.holidayName('2026-01-06') != null, true); eq('BY: Mariä Himmelfahrt', E.holidayName('2026-08-15') != null, true);
E.setRegion('SN'); eq('SN: Buß- und Bettag 2026 (18.11.)', E.holidayName('2026-11-18'), 'Buß- und Bettag'); eq('SN: kein Fronleichnam', E.holidays(2026)['2026-06-04'], undefined);
E.setRegion('BE'); eq('BE: Frauentag 2026', E.holidayName('2026-03-08') != null, true); eq('BE: kein Allerheiligen', E.holidayName('2026-11-01'), null);
E.setRegion('HH'); eq('HH: Reformationstag 2026', E.holidayName('2026-10-31') != null, true);
E.setRegion('DE'); eq('DE: nur bundesweit', Object.keys(E.holidays(2026)).length, 9);
E.setRegion('NW'); eq('NW: 11 Feiertage', Object.keys(E.holidays(2026)).length, 11);
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
// Dienstreise: Markierung, rechnet wie ein normaler Arbeitstag
{
  const cfg = { startDatum: '2026-03-02', startSaldo: 0, startUrlaub: 10, soll: 7.5 };
  const mk = t => E.run({ '2026-03-04': Object.assign({ s: 8, e: 16.5, p: 0.5 }, t ? { t } : {}) }, {}, cfg, '2026-03-05', '2026-03-06');
  const a = last(mk(null)), b = last(mk('Dienstreise'));
  eq('Dienstreise: gleiches Zeitkonto wie Arbeit', b.konto, a.konto); eq('Dienstreise: gleicher Resturlaub', b.rest, a.rest); eq('Dienstreise: gleiche Stunden', b.stunden, a.stunden);
}
// Regeln ab Datum: Aenderungen wirken nur ab ihrem Tag
{
  const base = { startDatum: '2025-01-01', startSaldo: 0, startUrlaub: 0, soll: 8, urlaubJahr: 30, halbeTage: true, urlaubVerfall: '', kappungTag: '10-31', kappungMax: 10, urlaubVerfallAb: 0 };
  const jetzt = { regeln: [{ ab: '2026-01-01', urlaubJahr: 28, halbeTage: false, urlaubVerfall: '05-01', lzkMax: 5, kappungAn: false, kappungTag: '10-31', kappungMax: 10 }] };
  const A = E.run({ '2025-02-03': { s: 8, e: 17, p: 0.5, z: 2000 } }, {}, Object.assign({}, base, jetzt), '2026-12-31', null), idx = {}; A.forEach(r => { idx[r.k] = r; });
  eq('Regel: 24.12.2025 halber Tag (alte Regel)', idx['2025-12-24'].t, 'Urlaub - halb');
  eq('Regel: 24.12.2026 normaler Arbeitstag (neue Regel)', idx['2026-12-24'].t !== 'Urlaub - halb', true);
  eq('Regel: Urlaub 2025 mit 30 Tagen', idx['2025-12-31'].rest <= 30 && idx['2025-12-31'].rest > 28, true);
  eq('Regel: Kappung 2025 aktiv', idx['2025-10-31'].loss > 0, true);
  eq('Regel: Kappung 2026 ausgeschaltet', idx['2026-10-31'].loss, 0);
  eq('Regel: Verfall 2025 nicht, 2026 ja', idx['2025-05-01'].verfall === 0 && idx['2026-05-01'].verfall > 0 || idx['2026-05-01'].lzkIn > 0, true);
  // altes Verfall-ab-Jahr wird zur Regel
  const m = E.migrate(Object.assign({}, base, { urlaubVerfall: '05-01', urlaubVerfallAb: 2027, lzkMax: 10 }));
  eq('Migration: Basis ohne Verfall', m.urlaubVerfall, ''); eq('Migration: Regel ab 2027', m.regeln.length === 1 && m.regeln[0].ab === '2027-01-01' && m.regeln[0].urlaubVerfall === '05-01', true);
}
console.log(fail ? fail + ' Fehler' : 'alle Tests bestanden'); process.exit(fail ? 1 : 0);
