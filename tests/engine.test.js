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
// Jobwechsel
{
  eq('Halbmonate: Wechsel 01.07. = 6', E.monthsBefore('2026-07-01'), 6); eq('Wechsel 15.07. = 6,5', E.monthsBefore('2026-07-15'), 6.5); eq('Wechsel 16.07. = 6,5', E.monthsBefore('2026-07-16'), 6.5); eq('Wechsel 17.07. = 7', E.monthsBefore('2026-07-17'), 7);
  const c = { startDatum: '2026-01-01', startSaldo: 0, startUrlaub: 0, soll: 8, urlaubJahr: 30, kappungTag: '', urlaubVerfall: '', halbeTage: false, regeln: [{ ab: '2026-07-01', urlaubJahr: 24, wechsel: { rest: 12, konto: 0, lzk: 0 } }] };
  const R = E.run({ '2026-01-02': { s: 8, e: 17, p: 0.5, z: 50 } }, {}, c, '2027-01-02', null), ix = {}; R.forEach(r => { ix[r.k] = r; });
  eq('Jobwechsel: alter Job anteilig 15 Tage', ix['2026-06-30'].rest, 15); eq('Jobwechsel: Rest am Wechseltag 12', ix['2026-07-01'].rest, 12); eq('Jobwechsel: Zeitkonto zurueck auf Startwert', ix['2026-07-01'].konto, 0 + ix['2026-07-01'].za);
  eq('Jobwechsel: 01.01. danach 24 neue Tage', ix['2027-01-01'].rest, 12 + 24);
}
// Arbeitsort und Auszahlung
{
  const c = { startDatum: '2026-03-02', startSaldo: 0, startUrlaub: 10, soll: 8, ortAn: true, standardOrt: 'buero', hoWochentage: [3], kappungTag: '', urlaubVerfall: '', halbeTage: false };
  const d = { '2026-03-02': { s: 8, e: 17, p: 1 }, '2026-03-03': { s: 8, e: 17, p: 1, o: 'mix', hoAb: 14 }, '2026-03-04': { s: 8, e: 17, p: 1 }, '2026-03-05': { s: 8, e: 17, p: 1, o: 'ho' }, '2026-03-06': { t: 'Dienstreise', s: 8, e: 16, p: 0 }, '2026-03-09': { s: 8, e: 17, p: 1, az: 2 } };
  const R = E.run(d, {}, c, '2026-03-09', null), Y = E.summarize(R, c)[2026].tot, ix = {}; R.forEach(r => { ix[r.k] = r; });
  eq('Ort: Standard Buero', ix['2026-03-02'].ort, 'buero'); eq('Ort: geteilt, 3 h Homeoffice', ix['2026-03-03'].hoH, 3); eq('Ort: Mittwoch fest Homeoffice', ix['2026-03-04'].ort, 'ho'); eq('Ort: Dienstreise', ix['2026-03-06'].ort, 'dr');
  eq('Ort: Jahressumme Tage', [Y.tB, Y.tH, Y.tM, Y.tD].join(), '2,2,1,1'); eq('Ort: Homeoffice-Stunden', Y.hH, 8 + 8 + 3 + 0 + 0 === 19 ? 19 : -1);
  { const R2 = E.run({ '2026-03-02': { s: 8, e: 17, p: 1, o: 'mix', hoAb: 11, hoZ: 'ho' } }, {}, c, '2026-03-02', null); eq('Ort: zuerst Homeoffice bis 11 Uhr = 3 h', R2[0].hoH, 3); }
  eq('Auszahlung mindert Konto', Math.round((ix['2026-03-09'].konto - ix['2026-03-06'].konto) * 100) / 100, Math.round((ix['2026-03-09'].za - 2) * 100) / 100); eq('Auszahlung in Summe', Y.ausz, 2);
}
// Pausenrechnung
{
  eq('Pause gesetzlich 8 h = 0,5', E.autoPause(8, { pauseModus: 'gesetz' }), 0.5); eq('Pause ohne Angabe = gesetzlich', E.autoPause(8), 0.5);
  eq('Pause fest ab 6 h: 5,5 h = 0', E.autoPause(5.5, { pauseModus: 'fest', pauseAb: 6, pauseFest: 1 }), 0); eq('Pause fest ab 6 h: 8 h = 1', E.autoPause(8, { pauseModus: 'fest', pauseAb: 6, pauseFest: 1 }), 1);
  eq('Pause keine', E.autoPause(9, { pauseModus: 'keine' }), 0);
  const c = { startDatum: '2026-03-02', startSaldo: 0, startUrlaub: 10, soll: 8, kappungTag: '', urlaubVerfall: '', halbeTage: false, regeln: [{ ab: '2026-03-04', pauseModus: 'fest', pauseAb: 6, pauseFest: 1 }] };
  const R = E.run({ '2026-03-02': { s: 8, e: 16.5 }, '2026-03-04': { s: 8, e: 16.5 } }, {}, c, '2026-03-04', null);
  eq('Pause Regel ab Datum: vorher gesetzlich 0,5', R[0].pause, 0.5); eq('Pause Regel ab Datum: nachher fest 1', R[2].pause, 1);
}
// Dienstreise Kunde und Ort
{
  const R = E.run({ '2026-03-04': { t: 'Dienstreise', kd: 'ACME', ot: 'Ingelheim', s: 8, e: 16.5 } }, {}, { startDatum: '2026-03-02', soll: 8 }, '2026-03-04', null);
  eq('Dienstreise: Kunde und Ort in der Zeile', R[2].kd + '|' + R[2].ot, 'ACME|Ingelheim');
}
// Urlaub mit eingetragenen Zeiten: ignoriert (Zeitausgleich nicht) (Werktag)
{ const c = Object.assign({}, E.DEFAULTS, { startDatum: '2026-10-05', startSaldo: 0, startUrlaub: 10, sollVerlauf: [{ ab: '2026-10-05', soll: 8 }] });
  const r = E.run({ '2026-10-05': { t: 'Urlaub', s: 8, e: 16.5 }, '2026-10-06': { t: 'Zeitausgleich', s: 8, e: 16.5 }, '2026-10-10': { t: 'Urlaub', s: 8, e: 12 } }, {}, c, '2026-10-10', '2026-12-01');
  eq('Urlaub mit Zeiten: Konto 0', r[0].konto, 0); eq('Zeitausgleich mit Zeiten zählt weiter', r[1].konto, 8); eq('Samstag bleibt wie bisher', r[5].stunden, 4); }
console.log(fail ? fail + ' Fehler' : 'alle Tests bestanden'); process.exit(fail ? 1 : 0);
