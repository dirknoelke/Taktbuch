/* ---------- Geld ---------- */
function fmtEur(x, dp = 2) {
  if (x == null || isNaN(x)) return '–';
  const neg = x < 0, parts = Math.abs(x).toFixed(dp).split('.');
  if (I18N.lang === 'en') return (neg ? '−' : '') + '€' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
  return (neg ? '−' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (parts[1] ? ',' + parts[1] : '') + ' €';
}
const normType = (k, v) => (v === '' && E.defaultType(k, S.cfg) !== 'arbeit' ? 'arbeit' : v);
const paydayOf = (y, m) => E.paydayMode(y, m, S.cfg.zahltagModus || (S.cfg.zahltagFeiertage === false ? 'letzte4raw' : 'letzte4'));
const ZT_TEXT = { letzte4: 'der 4. letzte Werktag des Monats, Feiertage sowie 24.12. und 31.12. zählen nicht mit', letzte4raw: 'der 4. letzte Werktag (Mo bis Fr) des Monats', tag15: 'der 15. des Monats (an einem freien Tag der Werktag davor)', erster: 'der erste Werktag des Monats', letzter: 'der letzte Werktag des Monats' };

/* Gehaltsmodell: echte Monate aus den Eingaben, spätere Monate als Prognose */
function payModel() {
  const MIR = S.cfg.mirAn !== false;
  const P = S.pay || {}, keys = Object.keys(P).sort();
  if (!keys.length) return null;
  const t = todayKey(), curYM = t.slice(0, 7), endY = +t.slice(0, 4) + 6;
  const act = keys.filter(k => P[k].u > 0 && k <= curYM).slice(-12);
  let sb = 0, sn = 0; for (const k of act) { const e = P[k]; sb += (e.b || 0) + (e.s || 0); sn += e.u + (MIR ? e.m || 0 : 0); }
  const quote = sb ? 1 - sn / sb : 0.34;
  const rows = [], byYM = {}; let prevB = null;
  for (let y = +keys[0].slice(0, 4), m = +keys[0].slice(5, 7); y <= endY;) {
    const ym = y + '-' + pad2(m), e = P[ym] || {};
    const b = e.b != null ? e.b : (prevB == null ? 0 : (m === (S.cfg.payRiseMonat == null ? 4 : S.cfg.payRiseMonat) ? (S.cfg.payRiseArt === 'eur' ? prevB + (S.cfg.payRiseEur || 0) : prevB * (1 + (S.cfg.payRise || 0))) : prevB));
    let s;
    if (e.s != null) s = e.s; else { const py = byYM[(y - 1) + '-' + pad2(m)]; s = py && py.b ? py.s * (b / py.b) : 0; }
    const hasU = e.u != null && e.u > 0;
    const netto = hasU ? e.u + (MIR ? e.m || 0 : 0) : (b + s) * (1 - quote);
    const row = { ym, y, m, b, s, bs: b + s, u: e.u, mir: MIR ? e.m || 0 : 0, netto, hasU, plan: !(e.b != null && hasU && ym <= curYM), pay: paydayOf(y, m), e };
    rows.push(row); byYM[ym] = row; prevB = b;
    if (++m > 12) { m = 1; y++; }
  }
  return { rows, byYM, quote };
}
function setPay(ym, f, v) {
  S.pay = S.pay || {}; const e = Object.assign({}, S.pay[ym] || {});
  if (v === '' || v == null || isNaN(v)) delete e[f]; else e[f] = v;
  if (!Object.keys(e).length) delete S.pay[ym]; else S.pay[ym] = e;
  save(); render();
}

/* ---------- Diagramme (reines SVG) ---------- */
function niceTicks(lo, hi) {
  const span = hi - lo || 1, raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = []; for (let v = a; v <= b + 1e-9; v += step) t.push(+v.toFixed(6)); return t;
}
const SVGW = 560, SVGH = 250, ML = 46, MR = 10, MT = 10, MB = 24;
const lineStore = {};
function svgLine(id, pts, o) {
  const vals = pts.map(p => p.v), lo = o.zero === false ? Math.min(...vals) : Math.min(0, ...vals), hi = Math.max(lo + 1, ...vals), tk = niceTicks(lo, hi), y0 = tk[0], y1 = tk[tk.length - 1];
  const X = i => ML + (i / Math.max(1, pts.length - 1)) * (SVGW - ML - MR), Y = v => MT + (1 - (v - y0) / (y1 - y0)) * (SVGH - MT - MB);
  const P = pts.map((p, i) => X(i).toFixed(1) + ',' + Y(p.v).toFixed(1)), base = Y(Math.max(y0, 0)).toFixed(1);
  let g = tk.map(v => `<line x1="${ML}" x2="${SVGW - MR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.5 : 1}"/><text x="${ML - 6}" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="var(--font-num)">${o.axis ? o.axis(v) : fmtDec(v, 0)}</text>`).join('');
  pts.forEach((p, i) => { const l = o.xl(p, i); if (l) g += `<text x="${X(i)}" y="${SVGH - 7}" text-anchor="middle" fill="var(--muted)" font-size="11">${l}</text>`; });
  lineStore[id] = { pts, X, Y, o };
  return `<svg viewBox="0 0 ${SVGW} ${SVGH}" width="100%" role="img" aria-label="${esc(o.aria)}" style="display:block;touch-action:pan-y" id="svg_${id}">${g}
    <path d="M${X(0).toFixed(1)},${base} L${P.join(' L')} L${X(pts.length - 1).toFixed(1)},${base}Z" fill="var(--c1)" fill-opacity=".16"/>
    <polyline points="${P.join(' ')}" fill="none" stroke="var(--c1)" stroke-width="2" stroke-linejoin="round"/>
    <line id="ln_${id}" y1="${MT}" y2="${SVGH - MB}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><circle id="dt_${id}" r="4" fill="var(--c1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <text id="tx_${id}" font-size="12" font-family="var(--font-num)" fill="var(--ink)" visibility="hidden"></text></svg>`;
}
function hoverLine(id) {
  const sv = $('#svg_' + id), L = lineStore[id]; if (!sv || !L) return;
  const move = ev => {
    const b = sv.getBoundingClientRect(), x = ((ev.clientX - b.left) / b.width) * SVGW;
    const i = Math.max(0, Math.min(L.pts.length - 1, Math.round(((x - ML) / (SVGW - ML - MR)) * (L.pts.length - 1)))), p = L.pts[i];
    const px = L.X(i), py = L.Y(p.v), ln = $('#ln_' + id), dot = $('#dt_' + id), tx = $('#tx_' + id);
    ln.setAttribute('x1', px); ln.setAttribute('x2', px); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    tx.textContent = L.o.tip(p); tx.setAttribute('x', px > SVGW / 2 ? px - 8 : px + 8); tx.setAttribute('text-anchor', px > SVGW / 2 ? 'end' : 'start'); tx.setAttribute('y', MT + 12);
    [ln, dot, tx].forEach(e => e.setAttribute('visibility', 'visible'));
  };
  sv.addEventListener('mousemove', move); sv.addEventListener('touchmove', e => move(e.touches[0]), { passive: true });
}
function svgBars(vals, line, o) {
  const top = Math.max(...vals, ...(line || [0]), 1), tk = niceTicks(0, top), y1 = tk[tk.length - 1];
  const bw = (SVGW - ML - MR) / vals.length, Yp = v => MT + (1 - v / y1) * (SVGH - MT - MB), cx = i => ML + bw * (i + .5);
  let g = tk.map(v => `<line x1="${ML}" x2="${SVGW - MR}" y1="${Yp(v)}" y2="${Yp(v)}" stroke="var(--line)"/><text x="${ML - 6}" y="${Yp(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="var(--font-num)">${o.axis ? o.axis(v) : fmtDec(v, 0)}</text>`).join('');
  g += vals.map((v, i) => `<rect x="${cx(i) - bw * .3}" y="${Yp(v)}" width="${bw * .6}" height="${Math.max(0, Yp(0) - Yp(v))}" rx="3" fill="var(--c1)"><title>${esc(o.tip(i))}</title></rect><text x="${cx(i)}" y="${SVGH - 7}" text-anchor="middle" fill="var(--muted)" font-size="11">${MON[i]}</text>`).join('');
  if (line) g += `<polyline points="${line.map((v, i) => cx(i) + ',' + Yp(v)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/>` + line.map((v, i) => `<circle cx="${cx(i)}" cy="${Yp(v)}" r="3" fill="var(--accent)"/>`).join('');
  return `<svg viewBox="0 0 ${SVGW} ${SVGH}" width="100%" role="img" aria-label="${esc(o.aria)}" style="display:block">${g}</svg>`;
}
function drawCharts() {
  const put = (id, html) => { const el = $('#' + id); if (el) el.innerHTML = html; };
  if (UI.tab === 'auswertung') {
    const yrs = Object.keys(R.years).map(Number).sort(), y = R.years[UI.year] ? UI.year : yrs[yrs.length - 1], Y = R.years[y];
    const pts = R.rows.filter(r => r.k.slice(0, 4) === String(y)).map(r => ({ k: r.k, v: r.konto }));
    put('chKonto', svgLine('konto', pts, { aria: 'Verlauf des Zeitkontos', xl: p => (p.k.slice(8) === '01' ? MON[+p.k.slice(5, 7) - 1] : ''), tip: p => fmtShort(p.k) + '  ' + fmtDec(p.v) + ' h' })); hoverLine('konto');
    put('chMon', svgBars(Y.months.map(m => +m.stunden.toFixed(2)), Y.months.map(m => +m.soll.toFixed(2)), { aria: 'Stunden pro Monat', tip: i => MONL[i] + ': ' + fmtDec(Y.months[i].stunden) + ' h, Soll ' + fmtDec(Y.months[i].soll) + ' h' }));
  } else if (UI.tab === 'urlaub') {
    const y = UI.uy, pts = R.rows.filter(r => r.k.slice(0, 4) === String(y)).map(r => ({ k: r.k, v: r.rest }));
    put('chRest', svgLine('rest', pts, { aria: 'Resturlaub im Jahresverlauf', xl: p => (p.k.slice(8) === '01' ? MON[+p.k.slice(5, 7) - 1] : ''), tip: p => fmtShort(p.k) + '  ' + fmtDec(p.v, p.v % 1 ? 1 : 0) + ' Tage' })); hoverLine('rest');
  } else if (UI.tab === 'gehalt') {
    const M = payModel(); if (!M) return;
    const pts = M.rows.filter(r => r.y <= +todayKey().slice(0, 4) + 4).map(r => ({ k: r.ym, v: r.b }));
    put('chBrutto', svgLine('brutto', pts, { zero: false, aria: 'Monatsgehalt brutto im Zeitverlauf', axis: v => fmtDec(v / 1000, 1) + 'k', xl: p => (p.k.slice(5) === '01' ? p.k.slice(0, 4) : ''), tip: p => MON[+p.k.slice(5) - 1] + ' ' + p.k.slice(0, 4) + '  ' + fmtEur(p.v, 0) })); hoverLine('brutto');
    const yr = M.rows.filter(r => r.y === UI.payYear);
    put('chNetto', svgBars(yr.map(r => Math.round(r.netto)), yr.map(r => Math.round(r.bs)), { aria: 'Netto und Brutto pro Monat', axis: v => fmtDec(v / 1000, 0) + 'k', tip: i => MONL[i] + ': netto ' + fmtEur(yr[i].netto, 0) + ', brutto ' + fmtEur(yr[i].bs, 0) + (yr[i].plan ? ' (Prognose)' : '') }));
  }
}

/* ---------- Gehalt ---------- */
function viewGehalt() {
  const M = payModel(), t = todayKey(), MIR = S.cfg.mirAn !== false;
  if (!M) return `<div class="nav"><h2>Gehalt</h2></div><section class="card"><div class="empty"><p>Noch keine Gehaltsdaten.</p><p class="hint">Beim Excel-Import wird das Blatt „Gehalt“ mitgelesen. Du kannst auch ab dem aktuellen Monat selbst beginnen.</p>
    <button class="btn primary" data-a="payStart">Aktuellen Monat anlegen</button></div></section>`;
  const years = [...new Set(M.rows.map(r => r.y))].filter(y => y <= +t.slice(0, 4) + 5);
  const y = M.rows.some(r => r.y === UI.payYear) ? UI.payYear : +t.slice(0, 4); UI.payYear = y;
  const yr = M.rows.filter(r => r.y === y);
  const next = M.rows.find(r => r.pay >= t), diff = next ? Math.round((E.toUTC(next.pay) - E.toUTC(t)) / 864e5) : 0;
  const gebucht = r => { const Y = R.years[r.y]; return Y && r.y >= +S.cfg.startDatum.slice(0, 4) && r.ym <= t.slice(0, 7) ? Y.months[r.m - 1].gebucht : 0; };
  const sum = f => yr.reduce((a, r) => a + f(r), 0);
  const brutto = sum(r => r.bs), nettoS = sum(r => r.netto), grund = sum(r => r.b);
  const stdSum = sum(r => (r.plan ? 0 : gebucht(r))), grundAct = sum(r => (r.plan ? 0 : r.b));
  const inp = (r, f, ph) => `<input type="number" step="0.01" value="${r.e[f] != null ? r.e[f] : ''}" placeholder="${ph != null ? fmtDec(ph) : ''}" data-f="pay:${r.ym}:${f}" aria-label="${f} ${r.ym}" style="width:104px;text-align:right">`;
  const yp = years.map(v => { const rr = M.rows.filter(r => r.y === v), bs = rr.reduce((a, r) => a + r.bs, 0), ne = rr.reduce((a, r) => a + r.netto, 0);
    const dec = rr.find(r => r.m === 12), prev = M.byYM[(v - 1) + '-12']; return { v, bs, ne, avg: rr.reduce((a, r) => a + r.b, 0) / rr.length, rise: dec && prev && prev.b ? dec.b / prev.b - 1 : null, plan: rr.some(r => r.plan) }; });
  return `
  <div class="nav"><h2>Gehalt</h2><div class="seg" role="group" aria-label="Jahr">${years.map(v => `<button data-a="payYear" data-v="${v}" aria-pressed="${v === y}">${v}</button>`).join('')}</div></div>
  <div class="stats">
    <div class="stat"><small>Nächster Zahltag</small><b style="font-size:21px">${next ? fmtShort(next.pay) : '–'}</b><span>${next ? (diff === 0 ? 'heute' : 'in ' + diff + ' Tagen') + ' · erwartet ' + fmtEur(next.netto, 0) : ''}</span></div>
    <div class="stat"><small>Brutto ${y}</small><b style="font-size:21px">${fmtEur(brutto, 0)}</b><span>Grundgehalt ${fmtEur(grund, 0)}</span></div>
    <div class="stat"><small>Netto ${y}</small><b style="font-size:21px">${fmtEur(nettoS, 0)}</b><span>Abzüge ${brutto ? fmtDec((1 - nettoS / brutto) * 100, 1) + ' %' : '–'}</span></div>
    <div class="stat"><small>Stundenlohn ${y}</small><b style="font-size:21px">${stdSum ? fmtEur(grundAct / stdSum) : '–'}</b><span>Grundgehalt ÷ gebuchte Stunden</span></div></div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h3>Monatsgehalt brutto</h3><span class="hint">Verlauf über alle Jahre</span></div><div class="chartbox" id="chBrutto"></div></section>
    <section class="card"><div class="card-h"><h3>Netto pro Monat ${y}</h3><span class="hint">Balken: Netto · Linie: Brutto gesamt</span></div><div class="chartbox" id="chNetto"></div></section>
  </div>
  <section class="card"><div class="card-h"><h3>Monate ${y}</h3><span class="hint">Leere Felder zeigen die Prognose. Eintragen überschreibt sie.</span></div><div class="tablewrap"><table>
    <thead><tr><th>Monat</th><th>Zahltag</th><th class="r">Brutto</th><th class="r">Sonderzahlung</th><th class="r">Überwiesen</th>${MIR ? '<th class="r">MIR</th>' : ''}<th class="r">Netto</th><th class="r">Abzüge</th><th class="r">Std. gebucht</th><th class="r">€/Std</th></tr></thead>
    <tbody>${yr.map(r => { const g = gebucht(r); return `<tr class="${r.plan ? 'dim' : ''}"><td>${MON[r.m - 1]}${r.plan ? ' <span class="chip ty-WE">Plan</span>' : ''}</td><td class="num">${fmtShort(r.pay)}</td>
      <td class="r">${inp(r, 'b', r.b)}</td><td class="r">${inp(r, 's', r.s)}</td><td class="r">${inp(r, 'u', null)}</td>${MIR ? `<td class="r">${inp(r, 'm', null)}</td>` : ''}
      <td class="r num"><b>${fmtDec(r.netto)}</b></td><td class="r num">${r.bs ? fmtDec((1 - r.netto / r.bs) * 100, 1) + ' %' : ''}</td>
      <td class="r num">${!r.plan && g ? fmtT(g) : ''}</td><td class="r num">${!r.plan && g ? fmtDec(r.b / g) : ''}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td colspan="2">Jahr</td><td class="r num">${fmtDec(grund)}</td><td class="r num">${fmtDec(sum(r => r.s))}</td><td class="r num">${fmtDec(sum(r => r.u || 0))}</td>${MIR ? `<td class="r num">${fmtDec(sum(r => r.mir))}</td>` : ''}<td class="r num">${fmtDec(nettoS)}</td><td class="r num">${brutto ? fmtDec((1 - nettoS / brutto) * 100, 1) + ' %' : ''}</td><td class="r num">${fmtT(stdSum)}</td><td class="r num">${stdSum ? fmtDec(grundAct / stdSum) : ''}</td></tr></tfoot></table></div>
    <p class="hint" style="margin:10px 0 0">${I18N.tx('Netto = überwiesen')}${MIR ? ' + MIR' : ''}. ${I18N.tx('Prognose: Brutto bleibt gleich')}${S.cfg.payRiseMonat && (S.cfg.payRiseArt === 'eur' ? S.cfg.payRiseEur : S.cfg.payRise) ? ', ' + I18N.tx('steigt im') + ' ' + MONL[S.cfg.payRiseMonat - 1] + ' ' + I18N.tx('um') + ' ' + (S.cfg.payRiseArt === 'eur' ? fmtEur(S.cfg.payRiseEur, 0) : fmtDec(S.cfg.payRise * 100, 1) + ' %') : ''} ${I18N.tx('(unter „Daten“ änderbar).')} ${I18N.tx('Eine tatsächliche Erhöhung trägst du einfach als Brutto im jeweiligen Monat ein, ab da rechnet die Prognose damit weiter.')} ${I18N.tx('Sonderzahlungen wie im Vorjahr, skaliert mit dem Brutto.')} ${I18N.tx('Netto mit der Abzugsquote der letzten # Zahlungen (# %).').replace('#', '12').replace('#', fmtDec(M.quote * 100, 1))}
    ${I18N.tx('Zahltag ist')} ${I18N.tx(ZT_TEXT[S.cfg.zahltagModus] || ZT_TEXT.letzte4)}.</p></section>
  <section class="card"><div class="card-h"><h3>Jahresvergleich</h3></div><div class="tablewrap"><table>
    <thead><tr><th>Jahr</th><th class="r">Brutto gesamt</th><th class="r">Netto</th><th class="r">Abzüge</th><th class="r">Ø Monatsgehalt</th><th class="r">Erhöhung im Jahr</th></tr></thead>
    <tbody>${yp.map(q => `<tr class="click ${q.plan ? 'dim' : ''}" data-a="payYear" data-v="${q.v}"><td>${q.v}${q.plan ? ' <span class="chip ty-WE">Plan</span>' : ''}</td><td class="r num">${fmtDec(q.bs)}</td><td class="r num">${fmtDec(q.ne)}</td><td class="r num">${fmtDec((1 - q.ne / q.bs) * 100, 1)} %</td><td class="r num">${fmtDec(q.avg)}</td><td class="r num">${q.rise == null ? '' : fmtDec(q.rise * 100, 1) + ' %'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

/* ---------- Urlaubsplanung ---------- */
const BRUSHES = [['Urlaub', 'Urlaub'], ['Urlaub - halb', 'Urlaub halb'], ['Zeitausgleich', 'Zeitausgleich'], ['Dienstreise', 'Dienstreise'], ['arbeit', 'Arbeit (löschen)']];
function viewUrlaub() {
  const t = todayKey(), curY = +t.slice(0, 4), startY = +S.cfg.startDatum.slice(0, 4);
  const y = UI.uy, Y = R.years[y], rc = E.cfgAt(S.cfg, y + '-12-31');
  if (!Y) return '<div class="empty">Für dieses Jahr gibt es keine Daten.</div>';
  const rows = R.rows.filter(r => r.k.slice(0, 4) === String(y)), prevEnd = R.map[(y - 1) + '-12-31'];
  const carry = prevEnd ? prevEnd.rest : (y === startY ? S.cfg.startUrlaub : 0), anspruch = carry + rc.urlaubJahr;
  const sumU = f => rows.reduce((a, r) => a + (f(r) ? r.ugen : 0), 0);
  const genommen = sumU(r => r.k <= t), geplant = sumU(r => r.k > t);
  const zaTage = f => rows.filter(r => f(r) && r.zagen > 0).length;
  const zaGen = zaTage(r => r.k <= t), zaPlan = zaTage(r => r.k > t);
  const apr = R.map[y + '-04-30'], may = R.map[y + '-05-01'], cap = rc.urlaubVerfall ? R.map[y + '-' + rc.urlaubVerfall] : null;
  const active = !!cap;
  const surplus = active ? cap.lzkIn + cap.verfall : 0;
  const kc = rc.kappungAn !== false && rc.kappungTag ? R.map[y + '-' + rc.kappungTag] : null;
  const capMD = rc.urlaubVerfall ? rc.urlaubVerfall.split('-') : ['05', '01'];
  const past = cap && cap.k <= t;
  const yearsBtn = []; for (let v = startY; v <= curY + 2; v++) yearsBtn.push(v);
  // Mini-Kalender
  const months = Y.months.map((M, i) => {
    const m = i + 1, n = monthDays(y, m), off = E.weekday(E.key(y, m, 1)) - 1; let c = '';
    for (let j = 0; j < off; j++) c += '<span></span>';
    for (let d = 1; d <= n; d++) {
      const k = E.key(y, m, d), r = R.map[k], paintable = r.wd < 6 && !r.hol;
      const half = r.t === 'Urlaub - halb';
      c += `<button class="pd ${tyClass(r.t)} ${k > t && !isWorkType(r.t) && r.wd < 6 ? 'fut' : ''} ${k === t ? 'today' : ''}" data-k="${k}" ${paintable ? 'data-p="1"' : 'tabindex="-1"'} data-a="paintKey" title="${esc(fmtDate(k) + (r.hol ? ' · ' + r.hol : E.TYPES[r.t] && r.t !== 'arbeit' && r.t !== 'WE' ? ' · ' + tyLabel(r.t) : ''))}" aria-label="${esc(fmtDate(k) + ' ' + tyLabel(r.t))}">${d}${half ? '<sup>½</sup>' : ''}</button>`;
    }
    const uCount = M.urlaub, zCount = rows.filter(r => +r.k.slice(5, 7) === m && r.zagen > 0).length;
    return `<div class="pm"><div class="pmh"><b>${MONL[i]}</b><span class="hint">${uCount ? fmtDec(uCount, uCount % 1 ? 1 : 0) + ' U' : ''}${uCount && zCount ? ' · ' : ''}${zCount ? zCount + ' ZA' : ''}</span></div>
      <div class="pg">${WD.map(w => `<i>${w[0]}</i>`).join('')}${c}</div></div>`;
  }).join('');
  let warn = '';
  if (active && surplus > 0.01) {
    warn = past
      ? `Am ${capMD[1]}.${capMD[0]}. waren ${fmtDec(surplus, surplus % 1 ? 1 : 0)} Tage Vorjahresurlaub übrig: ${fmtDec(cap.lzkIn, cap.lzkIn % 1 ? 1 : 0)} gingen ins Langzeitkonto${cap.verfall > 0.01 ? `, <b>${fmtDec(cap.verfall, cap.verfall % 1 ? 1 : 0)} verfielen</b>` : ''}.`
      : `Nach aktueller Planung bleiben am ${capMD[1]}.${capMD[0]}. ${fmtDec(surplus, surplus % 1 ? 1 : 0)} Tage übrig. ${fmtDec(cap.lzkIn, cap.lzkIn % 1 ? 1 : 0)} gehen ins Langzeitkonto${cap.verfall > 0.01 ? `, <b>${fmtDec(cap.verfall, cap.verfall % 1 ? 1 : 0)} Tage verfallen</b>. Plane bis dahin ${fmtDec(cap.verfall, cap.verfall % 1 ? 1 : 0)} weitere Urlaubstage ein.` : '. Es verfällt nichts.'}`;
  }
  return `
  <div class="nav"><h2>Urlaubsplanung</h2><div class="seg" role="group" aria-label="Jahr">${yearsBtn.map(v => `<button data-a="uyear" data-v="${v}" aria-pressed="${v === y}">${v}</button>`).join('')}</div></div>
  ${warn ? `<div class="banner" style="margin:0"><span>${warn}</span></div>` : ''}
  <div class="stats">
    <div class="stat"><small>Anspruch ${y}</small><b>${fmtDec(anspruch, anspruch % 1 ? 1 : 0)}</b><span>${fmtDec(carry, carry % 1 ? 1 : 0)} Vorjahr + ${fmtDec(rc.urlaubJahr, 0)} neu am 1.1.</span></div>
    <div class="stat"><small>Urlaub genommen / geplant</small><b>${fmtDec(genommen, genommen % 1 ? 1 : 0)} / ${fmtDec(geplant, geplant % 1 ? 1 : 0)}</b><span>Tage, inkl. halbe Tage</span></div>
    <div class="stat"><small>Rest zum Jahresende</small><b>${fmtDec(Y.tot.rest, Y.tot.rest % 1 ? 1 : 0)}</b><span>${active && may ? 'nach ' + capMD[1] + '.' + capMD[0] + '.: ' + fmtDec(may.rest, may.rest % 1 ? 1 : 0) + ' Tage' : 'Tage'}</span></div>
${rc.urlaubVerfall ? `    <div class="stat"><small>Langzeitkonto</small><b>${fmtDec(Y.tot.lzk, Y.tot.lzk % 1 ? 1 : 0)}</b><span>Tage am Jahresende${active && cap.lzkIn ? ' · +' + fmtDec(cap.lzkIn, 0) + ' am ' + capMD[1] + '.' + capMD[0] + '.' : ''}</span></div>` : ''}</div>
  <section class="card">
    <div class="card-h"><h3>Abwesenheiten einplanen</h3>
      <div class="seg" role="group" aria-label="Pinsel">${BRUSHES.map(([v, l]) => `<button data-a="brush" data-v="${esc(v)}" aria-pressed="${UI.brush === v}">${l}</button>`).join('')}</div></div>
    <p class="hint" style="margin:0 0 12px">Tag anklicken oder mit gedrückter Maustaste darüberziehen. Ein zweiter Klick auf einen belegten Tag nimmt ihn zurück. Wochenenden und Feiertage sind gesperrt. 24.12. und 31.12. zählen automatisch als halber Urlaubstag.</p>
    <div class="pms" id="paintArea">${months}</div>
    <div class="legend" style="margin-top:12px"><span><i class="ty-Urlaub"></i>Urlaub</span><span><i class="ty-Zeitausgleich"></i>Zeitausgleich</span><span><i class="ty-Dienstreise"></i>Dienstreise</span><span><i class="ty-Feiertag"></i>Feiertag</span><span><i class="ty-WE"></i>Wochenende</span><span>Gestrichelt: noch geplant · ½ halber Tag</span></div>
  </section>
  <div class="grid2">
    <section class="card"><div class="card-h"><h3>Resturlaub im Jahresverlauf</h3><span class="hint">Tage</span></div><div class="chartbox" id="chRest"></div>
      ${rc.urlaubVerfall ? `<p class="hint" style="margin:8px 0 0">Am ${capMD[1]}.${capMD[0]}. fällt der Vorjahresurlaub über ${fmtDec(rc.urlaubJahr, 0)} Tage weg. Bis zu ${fmtDec(rc.lzkMax, 0)} Tage davon gehen ins Langzeitkonto, der Rest verfällt.</p>` : ''}</section>
    <section class="card"><div class="card-h"><h3>Zeitausgleich ${y}</h3></div>
      <div class="calc" style="margin-top:0;border:0;padding-top:0"><div><small>Genommen</small><b>${zaGen} Tage</b></div><div><small>Geplant</small><b>${zaPlan} Tage</b></div><div><small>Stunden gesamt</small><b>${fmtT((zaGen + zaPlan) * S.cfg.soll)}</b></div></div>
      ${kc ? `<p style="margin:14px 0 0">Zeitkonto am ${kc.k.slice(8)}.${kc.k.slice(5, 7)}.: <b class="num">${fmtT(kc.konto + kc.loss)} h</b> vor der Kappung.</p>
      <p class="${kc.loss > 0.01 ? 'warn' : 'hint'}" style="margin:4px 0 0">${kc.loss > 0.01 ? `Auf ${fmtT(rc.kappungMax)} h gekappt: ${fmtT(kc.loss)} h verfallen. Das sind ${fmtDec(kc.loss / S.cfg.soll, 1)} Tage Zeitausgleich, die du vorher noch einplanen kannst.` : 'Nach aktueller Planung verfällt nichts.'}</p>` : ''}
    </section>
  </div>`;
}
