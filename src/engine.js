// Stunden engine: pure functions, no DOM. Port of the Excel rules.
(function (root) {
  const DEFAULTS = {
    soll: 7.5,            // Sollstunden pro Arbeitstag (aktuell)
    sollAlt: null,        // Soll vor dem Wechseldatum (z. B. Teilzeit), null = kein Wechsel
    sollWechsel: '',      // Wechseldatum YYYY-MM-DD
    urlaubJahr: 30,       // Urlaubstage, werden am 1.1. gutgeschrieben
    tagesMax: 10,         // max. anrechenbare Stunden pro Tag
    kappungTag: '10-31',  // Stichtag Kappung Zeitkonto (MM-TT) oder ''
    kappungMax: 10,       // max. Saldo nach Stichtag
    startSaldo: 0,        // Zeitkonto vor erstem Datum
    startUrlaub: 0,       // Resturlaub vor erstem Datum
    startDatum: '2020-01-01',
    urlaubVerfall: '05-01', // MM-TT: nicht genommener Vorjahresurlaub verfällt
    urlaubVerfallAb: 2025,  // alt: wird beim Laden in eine Regel mit Datum umgewandelt
    ortAn: false,           // Arbeitsort (Buero/Homeoffice) erfassen
    standardOrt: 'buero',   // 'buero' | 'ho'
    hoWochentage: [],       // feste Homeoffice-Wochentage (1=Mo ... 5=Fr)
    auszahlAn: false,       // Auszahlung von Ueberstunden erfassen
    pauseModus: 'gesetz',   // automatische Pause: 'gesetz' | 'fest' | 'keine'
    pauseAb: 6,             // bei 'fest': ab dieser Anwesenheit (h)
    pauseFest: 1,           // bei 'fest': Pause (h)
    regeln: [],             // Regeln ab Datum: urlaubJahr, halbeTage, urlaubVerfall, lzkMax, kappungAn, kappungTag, kappungMax
    lzkMax: 10,             // Urlaubstage, die am Stichtag ins Langzeitkonto gehen (Rest verfällt)
    startLzk: 0,            // Langzeitkonto in Tagen vor dem Startdatum
    halbeTage: true         // 24.12. und 31.12. zählen als halber Urlaubstag
  };
  const TYPES = {
    arbeit: { label: 'Arbeit', work: true },
    Urlaub: { label: 'Urlaub' }, 'Urlaub - halb': { label: 'Urlaub halb' }, Sonderurlaub: { label: 'Sonderurlaub' }, Betriebsfrei: { label: 'Betriebsfrei' },
    Zeitausgleich: { label: 'Zeitausgleich' }, krank: { label: 'Krank' },
    Dienstreise: { label: 'Dienstreise', work: true },   // nur Markierung: rechnet wie ein normaler Arbeitstag
    Feiertag: { label: 'Feiertag' }, WE: { label: 'Wochenende' }
  };

  const sollAt = (cfg, k) => {
    const v = cfg.sollVerlauf;
    if (v && v.length) { let s = v[0].soll; for (const x of v) { if (x.ab <= k) s = x.soll; else break; } return s; }
    return cfg.sollAlt != null && cfg.sollWechsel && k < cfg.sollWechsel ? cfg.sollAlt : cfg.soll;
  };
  const pad = n => (n < 10 ? '0' : '') + n;
  const key = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const parse = k => ({ y: +k.slice(0, 4), m: +k.slice(5, 7), d: +k.slice(8, 10) });
  const toUTC = k => { const p = parse(k); return Date.UTC(p.y, p.m - 1, p.d); };
  const fromUTC = t => { const x = new Date(t); return key(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };
  const addDays = (k, n) => fromUTC(toUTC(k) + n * 864e5);
  const weekday = k => { const w = new Date(toUTC(k)).getUTCDay(); return w === 0 ? 7 : w; }; // 1=Mo..7=So
  function isoWeek(k) { // ISO-8601 KW (WEEKNUM(...,21))
    const t = new Date(toUTC(k)); const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  }
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
      da = ((h + l - 7 * m + 114) % 31) + 1;
    return key(y, mo, da);
  }
  /* Gesetzliche Feiertage je Bundesland (Kuerzel nach ISO 3166-2:DE). Regionale Sonderfaelle
     (z. B. Augsburger Friedensfest, Fronleichnam in Teilen von Sachsen/Thueringen) sind nicht enthalten. */
  const REGIONS = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];
  let region = 'NW'; const holCache = {};
  const setRegion = r => { region = REGIONS.indexOf(r) >= 0 ? r : (r === 'DE' ? 'DE' : 'NW'); };
  const getRegion = () => region;
  function holidays(y) {
    const ck = region + y; if (holCache[ck]) return holCache[ck];
    const e = easter(y), h = {}, R = region, is = (...l) => l.indexOf(R) >= 0;
    h[key(y, 1, 1)] = 'Neujahr'; h[addDays(e, -2)] = 'Karfreitag'; h[addDays(e, 1)] = 'Ostermontag';
    h[key(y, 5, 1)] = 'Tag der Arbeit'; h[addDays(e, 39)] = 'Christi Himmelfahrt'; h[addDays(e, 50)] = 'Pfingstmontag';
    h[key(y, 10, 3)] = 'Tag der Deutschen Einheit'; h[key(y, 12, 25)] = '1. Weihnachtstag'; h[key(y, 12, 26)] = '2. Weihnachtstag';
    if (is('BW', 'BY', 'ST')) h[key(y, 1, 6)] = 'Heilige Drei Könige';
    if ((is('BE') && y >= 2019) || (is('MV') && y >= 2023)) h[key(y, 3, 8)] = 'Internationaler Frauentag';
    if (is('BE') && y === 2020) h[key(y, 5, 8)] = 'Tag der Befreiung';
    if (is('BW', 'BY', 'HE', 'NW', 'RP', 'SL')) h[addDays(e, 60)] = 'Fronleichnam';
    if (is('BY', 'SL')) h[key(y, 8, 15)] = 'Mariä Himmelfahrt';
    if (is('TH') && y >= 2019) h[key(y, 9, 20)] = 'Weltkindertag';
    if (is('BB', 'MV', 'SN', 'ST', 'TH') || (is('HB', 'HH', 'NI', 'SH') && y >= 2018)) h[key(y, 10, 31)] = 'Reformationstag';
    if (is('BW', 'BY', 'NW', 'RP', 'SL')) h[key(y, 11, 1)] = 'Allerheiligen';
    if (is('SN')) { let d = key(y, 11, 22); while (weekday(d) !== 3) d = addDays(d, -1); h[d] = 'Buß- und Bettag'; }
    return (holCache[ck] = h);
  }
  const holidayName = k => holidays(+k.slice(0, 4))[k] || null;

  // Pausenregel (ArbZG-nah, wie in der Excel): d = Anwesenheit in Stunden
  function autoPause(d, rc) {
    const m = rc && rc.pauseModus;
    if (m === 'keine') return 0;
    if (m === 'fest') return d >= (rc.pauseAb != null ? rc.pauseAb : 6) ? Math.min(d, rc.pauseFest != null ? rc.pauseFest : 1) : 0;
    if (d >= 9.75) return 0.75;
    if (d > 9) return Math.max(0.5, d - 9);
    if (d >= 6.5) return 0.5;
    if (d > 6) return d - 6;
    return 0;
  }

  // Standardtyp eines Tages ohne Eintrag
  function defaultType(k, cfg) {
    if (weekday(k) >= 6) return 'WE';
    if (holidayName(k)) return 'Feiertag';
    if ((cfg ? cfgAt(cfg, k).halbeTage : DEFAULTS.halbeTage) && (k.slice(5) === '12-24' || k.slice(5) === '12-31')) return 'Urlaub - halb';
    return 'arbeit';
  }

  // Regeln mit Gueltig-ab-Datum: Basiswerte gelten ab Startdatum, cfg.regeln ersetzen sie ab ihrem Datum.
  const RULE_KEYS = ['urlaubJahr', 'halbeTage', 'urlaubVerfall', 'lzkMax', 'kappungAn', 'kappungTag', 'kappungMax', 'pauseModus', 'pauseAb', 'pauseFest'];
  function migrate(cfgIn) {
    const c = Object.assign({}, DEFAULTS, cfgIn || {});
    c.regeln = Array.isArray(c.regeln) ? c.regeln.filter(x => x && x.ab).sort((x, y) => x.ab.localeCompare(y.ab)) : [];
    const y0 = +String(c.startDatum).slice(0, 4);
    if (c.urlaubVerfallAb) {
      if (c.urlaubVerfall && c.urlaubVerfallAb > y0 && c.urlaubVerfallAb < 9999) {
        const r = { ab: c.urlaubVerfallAb + '-01-01' }; RULE_KEYS.forEach(f => { r[f] = c[f]; });
        c.regeln.push(r); c.regeln.sort((x, y) => x.ab.localeCompare(y.ab)); c.urlaubVerfall = '';
      } else if (c.urlaubVerfall && c.urlaubVerfallAb >= 9999) { c.urlaubVerfall = ''; }
      c.urlaubVerfallAb = 0;
    }
    return c;
  }
  function cfgAt(cfg, k) {
    let r = cfg;
    if (cfg.regeln && cfg.regeln.length) {
      r = Object.assign({}, cfg);
      for (const x of cfg.regeln) { if (x.ab > k) break; RULE_KEYS.forEach(f => { if (x[f] !== undefined) r[f] = x[f]; }); }
    }
    return r;
  }
  // Jobwechsel: Regel mit .wechsel = {rest, konto, lzk}. Alter Job im Wechseljahr: anteilig in Halbmonaten, auf halbe Tage aufgerundet.
  function monthsBefore(ab) { // Monate im alten Job vor dem Wechseltag ab (1.-15. = halber Monat)
    const m = +ab.slice(5, 7), ed = +ab.slice(8, 10) - 1;
    return (m - 1) + (ed <= 0 ? 0 : ed >= 16 ? 1 : 0.5);
  }
  function creditAt(cfg, y, urlaubJahr) { // Gutschrift am 01.01. des Jahres y
    const w = (cfg.regeln || []).find(r => r.wechsel && r.ab.slice(0, 4) === String(y) && r.ab > y + '-01-01');
    return w ? Math.ceil(urlaubJahr * monthsBefore(w.ab) / 12 * 2) / 2 : urlaubJahr;
  }
  // Lauf ueber alle Tage von cfg.startDatum bis endKey.
  // days: { 'YYYY-MM-DD': {s,e,a,t,p} } ; actsByDay: { 'YYYY-MM-DD': netto-summe }
  // todayKey: Tage ab heute ohne Zeiten gelten als Plan (Soll erfuellt).
  function run(days, actsByDay, cfgIn, endKey, todayKey) {
    const cfg = migrate(cfgIn);
    const out = []; let konto = cfg.startSaldo, rest = cfg.startUrlaub, lzk = cfg.startLzk || 0;
    const nettoAb = cfg.nettoAb || '2021-02-18';
    const wz = {}; cfg.regeln.forEach(r => { if (r.wechsel) wz[r.ab] = r.wechsel; });
    for (let k = cfg.startDatum; k <= endKey; k = addDays(k, 1)) {
      const inp = days[k] || {};
      const rc = cfgAt(cfg, k);
      const wj = wz[k]; if (wj) { konto = +wj.konto || 0; rest = +wj.rest || 0; lzk = +wj.lzk || 0; }
      const dt = defaultType(k, rc);
      let t = inp.t || (dt === 'arbeit' ? (cfg.standardThema || 'Arbeit') : dt);
      const isWorkType = !(t in TYPES) || !!TYPES[t].work;
      const s = inp.s || 0, e = inp.e || 0, a = inp.a || 0;
      // Urlaub, Sonderurlaub, Zeitausgleich und Betriebsfrei: an Werktagen wird nicht gearbeitet, eingetragene Zeiten werden ignoriert.
      const frei = weekday(k) < 6 && (t === 'Urlaub' || t === 'Sonderurlaub' || t === 'Zeitausgleich' || t === 'Betriebsfrei');
      const d = !frei && e > s ? e - s : 0;
      const pause = inp.p != null && inp.p !== '' ? inp.p : autoPause(d, rc);
      const raw = d > 0 ? d - pause - a : 0;
      const stunden = Math.min(cfg.tagesMax, raw);
      const over = raw > cfg.tagesMax ? raw - cfg.tagesMax : 0;
      const wd = weekday(k), so = sollAt(cfg, k);
      const planned = !d && isWorkType && wd < 6 && !holidayName(k) && todayKey && k >= todayKey;
      // Saldo-Delta
      let za;
      const relax = t === 'Betriebsfrei' || (typeof t === 'string' && t.indexOf('Relax/Recover/Re-Energize') >= 0);
      if (wd >= 6) za = stunden;
      else if (t === 'Urlaub' || t === 'Sonderurlaub' || t === 'Zeitausgleich' || t === 'Feiertag' || relax) za = stunden;
      else if (t === 'krank') za = 0;
      else if (t === 'Urlaub - halb') za = stunden > 0 ? stunden - so / 2 : 0;
      else za = planned ? 0 : stunden - so;
      const zagen = t === 'Zeitausgleich' ? (stunden > 0 ? 0 : so) : 0;
      const adj = +inp.z || 0;
      const az = +inp.az || 0;
      konto = konto + za - zagen + adj - az;
      let loss = 0;
      if (rc.kappungAn !== false && rc.kappungTag && k.slice(5) === rc.kappungTag && konto > rc.kappungMax) { loss = konto - rc.kappungMax; konto = rc.kappungMax; }
      const ugen = t === 'Urlaub' ? 1 : t === 'Urlaub - halb' ? 0.5 : 0;
      let lzkIn = 0, verfall = 0;
      if (k.slice(5) === '01-01') { if (!wj) rest = rest + creditAt(cfg, +k.slice(0, 4), rc.urlaubJahr); }
      else {
        if (rc.urlaubVerfall && k.slice(5) === rc.urlaubVerfall) {
          const surplus = Math.max(0, rest - rc.urlaubJahr); // Vorjahresurlaub, der nicht genommen wurde
          lzkIn = Math.min(rc.lzkMax, surplus); verfall = surplus - lzkIn; rest -= surplus; lzk += lzkIn;
        }
        rest -= ugen;
      }
      // Arbeitsort: nur Tage mit Stunden. Dienstreise zaehlt eigen, geteilte Tage mit Homeoffice-Stunden ab hoAb.
      let ort = '', hoH = 0;
      if (cfg.ortAn && stunden > 0 && wd < 6 && isWorkType) {
        ort = t === 'Dienstreise' ? 'dr' : (inp.o || ((cfg.hoWochentage || []).indexOf(wd) >= 0 ? 'ho' : (cfg.standardOrt || 'buero')));
        if (ort === 'mix') hoH = inp.hoZ ? Math.max(0, Math.min(stunden, (inp.hoAb || s) - s)) : Math.max(0, Math.min(stunden, e - (inp.hoAb || e)));
        else if (ort === 'ho') hoH = stunden;
      }
      const krank = t === 'krank' ? (so - stunden) / so : 0;
      const arbeitstag = !(t === 'Feiertag' || t === 'WE' || relax) ? 1 : 0;
      const sumAct = actsByDay && actsByDay[k] || 0;
      const netto = k < nettoAb ? stunden : (sumAct === 0 ? stunden : sumAct);
      out.push({ k, kw: isoWeek(k), t, s, e, a, pause, pauseAuto: !(inp.p != null && inp.p !== ''), stunden, over, za, zagen,
        konto, rest, ugen, krank, soll: so, arbeitstag, netto, acts: sumAct, planned: !!planned, wd,
        hol: holidayName(k), note: inp.n || '', adj, az, ort, hoH, kd: inp.kd || '', ot: inp.ot || '', loss, lzk, lzkIn, verfall });
    }
    return out;
  }

  // Monats-/Jahresauswertung aus Tagesliste
  function summarize(rows, cfgIn) {
    const cfg = Object.assign({}, DEFAULTS, cfgIn || {});
    const years = {};
    for (const r of rows) {
      const y = +r.k.slice(0, 4), m = +r.k.slice(5, 7);
      const Y = years[y] || (years[y] = { y, months: Array.from({ length: 12 }, (_, i) => ({ m: i + 1, stunden: 0, urlaub: 0, krank: 0, arbeitstage: 0, netto: 0, ueber10: 0, zaTage: 0, sollH: 0, extraH: 0, konto: null, rest: null, plan: 0, ausz: 0, tB: 0, tH: 0, tM: 0, tD: 0, hH: 0, hB: 0 })) });
      const M = Y.months[m - 1];
      M.stunden += r.stunden; M.urlaub += r.ugen; M.krank += r.krank; M.arbeitstage += r.arbeitstag;
      M.sollH += r.arbeitstag * r.soll; M.extraH += (r.ugen + r.krank) * r.soll;
      M.netto += r.netto; M.ueber10 += r.over; M.zaTage += r.zagen > 0 ? 1 : 0;
      if (r.planned) M.plan++;
      M.ausz += r.az || 0;
      if (r.ort) { if (r.ort === 'buero') M.tB++; else if (r.ort === 'ho') M.tH++; else if (r.ort === 'mix') M.tM++; else M.tD++; M.hH += r.hoH; if (r.ort !== 'dr') M.hB += r.stunden - r.hoH; }
      M.konto = r.konto; M.rest = r.rest; M.lzk = r.lzk; // letzter Tag des Monats
    }
    for (const Y of Object.values(years)) {
      for (const M of Y.months) {
        M.soll = M.sollH;
        M.gebucht = M.stunden + M.extraH; // "gebuchte Stunden"
        M.rate = M.stunden > 0 ? M.netto / M.stunden : null;              // Erfassungsrate
      }
      const sum = f => Y.months.reduce((a, m) => a + m[f], 0);
      Y.tot = { stunden: sum('stunden'), urlaub: sum('urlaub'), krank: sum('krank'), arbeitstage: sum('arbeitstage'),
        netto: sum('netto'), soll: sum('soll'), gebucht: sum('gebucht'), ueber10: sum('ueber10'), ausz: sum('ausz'), tB: sum('tB'), tH: sum('tH'), tM: sum('tM'), tD: sum('tD'), hH: sum('hH'), hB: sum('hB'),
        konto: Y.months[11].konto, rest: Y.months[11].rest, lzk: Y.months[11].lzk };
      Y.tot.rate = Y.tot.stunden > 0 ? Y.tot.netto / Y.tot.stunden : null;
    }
    return years;
  }

  // Zahltag: vier Werktage vor Monatsende = 4. letzter Werktag (Mo-Fr). withHol: Feiertage sowie 24.12./31.12. (halbe Tage) zaehlen nicht als Werktag.
  function payday(y, m, withHol) {
    let k = key(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()), n = 0;
    for (;;) {
      if (weekday(k) < 6 && !(withHol && (holidayName(k) || k.slice(5) === '12-24' || k.slice(5) === '12-31'))) { n++; if (n === 4) return k; }
      k = addDays(k, -1);
    }
  }
  // Zahltag nach Modus: letzte4 (4. letzter Werktag ohne Feiertage), letzte4raw (Mo bis Fr), tag15, erster, letzter
  const isWerktag = k => weekday(k) < 6 && !holidayName(k) && k.slice(5) !== '12-24' && k.slice(5) !== '12-31';
  function paydayMode(y, m, mode) {
    if (mode === 'letzte4raw') return payday(y, m, false);
    if (mode === 'tag15' || mode === 'erster' || mode === 'letzter') {
      let k = mode === 'tag15' ? key(y, m, 15) : mode === 'erster' ? key(y, m, 1) : key(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
      const step = mode === 'erster' ? 1 : -1;
      while (!isWerktag(k)) k = addDays(k, step);
      return k;
    }
    return payday(y, m, true);
  }
  const api = { RULE_KEYS, monthsBefore, creditAt, migrate, cfgAt, paydayMode, isWerktag, sollAt, payday, DEFAULTS, TYPES, key, parse, addDays, weekday, isoWeek, easter, holidays, holidayName, setRegion, getRegion, REGIONS, autoPause, defaultType, run, summarize, fromUTC, toUTC };
  if (typeof module !== 'undefined') module.exports = api; else root.StundenEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
