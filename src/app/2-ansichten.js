/* ---------- Hilfen für Ansichten ---------- */
const ZAHLTAG_OPTS = [['letzte4', '4. letzter Werktag im Monat'], ['letzte4raw', '4. letzter Werktag im Monat (Mo bis Fr, auch Feiertage)'], ['tag15', 'Am 15. jeden Monats'], ['erster', 'Zum Monatsanfang (erster Werktag)'], ['letzter', 'Zum Monatsende (letzter Werktag)']];
const TYPE_OPTS = [['', 'Arbeit'], ['Urlaub', 'Urlaub'], ['Urlaub - halb', 'Urlaub halb'], ['Sonderurlaub', 'Sonderurlaub'], ['Zeitausgleich', 'Zeitausgleich'], ['krank', 'Krank'], ['Feiertag', 'Feiertag'], ['Betriebsfrei', 'Betriebsfrei'], ['WE', 'Wochenende']];
const tyClass = t => (E.TYPES[t] && t !== 'arbeit' ? 'ty-' + t.replace(/[^A-Za-z]+/g, '-') : '');
const tyLabel = t => (E.TYPES[t] ? E.TYPES[t].label : t);
const isWorkType = t => !E.TYPES[t] || t === 'arbeit';
const netto = a => (a.e ? Math.max(0, H(a.e) - H(a.s) - H(a.u)) : 0);
const catColors = {};
function catColor(c) { if (!c) return 'var(--c6)'; if (!(c in catColors)) catColors[c] = 'var(--c' + (1 + (Object.keys(catColors).length % 5)) + ')'; return catColors[c]; }
function lists() {
  const m = { cat: {}, w: {}, sys: {}, pn: {}, th: {} };
  for (const a of S.acts) for (const f in m) if (a[f]) m[f][a[f]] = (m[f][a[f]] || 0) + 1;
  const o = {}; for (const f in m) o[f] = Object.keys(m[f]).sort((x, y) => m[f][y] - m[f][x]);
  const th = {}; for (const k in S.days) if (S.days[k].th) th[S.days[k].th] = 1; o.dayth = Object.keys(th);
  const seen = new Set(), rec = S.acts.slice().sort((x, y) => (y.d + y.s).localeCompare(x.d + x.s)); o.thr = [];
  for (const a of rec) { if (a.th && !seen.has(a.th)) { seen.add(a.th); o.thr.push(a.th); if (o.thr.length >= 400) break; } }
  return o;
}
const dl = (id, arr, n = 80) => `<datalist id="${id}">${arr.slice(0, n).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
const weekStart = k => E.addDays(k, -(E.weekday(k) - 1));
const monthDays = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function updatePill() {
  const el = $('#kontoPill'); if (!el || !R) return;
  const r = R.map[todayKey()];
  el.textContent = r ? fmtT(r.konto, true) + ' h' : '–';
  el.className = r ? cls(r.konto) : '';
}

/* ---------- Heute ---------- */
function liveInfo(k, d) {
  if (k !== todayKey() || !d.s || d.e) return null;
  const dur = Math.max(0, nowH() - H(d.s)); const p = d.p ? H(d.p) : E.autoPause(dur);
  return { dur, net: Math.min(S.cfg.tagesMax, Math.max(0, dur - p - H(d.a))), pause: p };
}
function sollEnde(d) {
  if (!d.s) return null; const s = H(d.s), a = H(d.a);
  for (let e = s + S.cfg.soll; e < s + 14; e += 1 / 12) { const dur = e - s; const p = d.p ? H(d.p) : E.autoPause(dur); if (dur - p - a >= S.cfg.soll - 0.001) return e; }
  return null;
}
function timeline(k, acts, d) {
  const s0 = d.s ? H(d.s) : null, e0 = d.e ? H(d.e) : null;
  const times = acts.flatMap(a => [H(a.s), a.e ? H(a.e) : H(a.s)]);
  let lo = Math.min(7, ...(s0 != null ? [s0] : []), ...times), hi = Math.max(17, ...(e0 != null ? [e0] : []), ...times);
  lo = Math.floor(lo); hi = Math.ceil(hi); const span = hi - lo;
  const pos = h => ((h - lo) / span) * 100;
  let html = '<div class="tl" role="img" aria-label="Tagesverlauf">';
  if (s0 != null) html += `<div class="presence" style="left:${pos(s0)}%;width:${pos(e0 != null ? e0 : Math.max(s0, nowH())) - pos(s0)}%"></div>`;
  for (const a of acts) { const s = H(a.s), e = a.e ? H(a.e) : nowH(); if (e <= s) continue; html += `<div class="blk" style="left:${pos(s)}%;width:${pos(e) - pos(s)}%;background:${catColor(a.cat)}" title="${esc(a.s + '–' + (a.e || 'läuft') + ' · ' + a.cat + ' · ' + a.w + ' · ' + a.sys + ' · ' + a.th)}"></div>`; }
  html += '</div><div class="tl-axis">';
  for (let h = lo; h <= hi; h += span > 12 ? 2 : 1) html += `<span>${h}</span>`;
  return html + '</div>';
}
function viewHeute() {
  const k = UI.date, row = dayRow(k), d = S.days[k] || {}, isToday = k === todayKey(), L = lists();
  const live = liveInfo(k, d);
  const acts = S.acts.filter(a => a.d === k).sort((a, b) => a.s.localeCompare(b.s));
  const wsK = weekStart(k), wk = []; for (let i = 0; i < 7; i++) wk.push(dayRow(E.addDays(wsK, i)));
  const wIst = wk.reduce((a, r) => a + (isWorkType(r.t) && r.wd < 6 ? r.stunden : 0), 0);
  const wSoll = wk.reduce((a, r) => a + (r.wd < 6 && !r.hol && (isWorkType(r.t) || r.t === 'Urlaub - halb') ? r.soll * (r.t === 'Urlaub - halb' ? 0.5 : 1) : 0), 0);
  const stunden = live ? live.net : row.stunden;
  const effType = d.t || (E.defaultType(k, S.cfg) === 'Urlaub - halb' ? 'Urlaub - halb' : '');
  const isPay = paydayOf(+k.slice(0, 4), +k.slice(5, 7)) === k;
  const typeHint = row.t === 'WE' && !d.t ? 'Wochenende' : row.hol && !d.t ? row.hol : '';
  const gap = acts.length ? Math.max(0, row.stunden - row.acts) : 0;
  const warns = [];
  if (row.over > 0.01) warns.push(`Mehr als ${fmtDec(S.cfg.tagesMax, 0)} h: ${fmtDec(row.over)} h werden nicht angerechnet.`);
  if (d.e && d.s && H(d.e) <= H(d.s)) warns.push('Gehen liegt vor Kommen. Über Mitternacht wird nicht gerechnet.');
  if (acts.length && gap > 0.5 && !live) warns.push(`Tätigkeiten decken ${fmtT(row.acts)} h von ${fmtT(row.stunden)} h ab (${fmtT(gap)} h offen).`);
  if (acts.some(a => !a.e)) warns.push('Ein Timer läuft noch.');
  const f = UI.form;
  const sugS = acts.length ? (acts[acts.length - 1].e || '') : (d.s || '');
  return `
  <div class="nav">
    <button class="btn" data-a="day" data-n="-1" aria-label="Vorheriger Tag">‹</button>
    <h2>${fmtDate(k)} <span class="muted num" style="font-size:14px">KW ${row.kw}</span></h2>
    <button class="btn" data-a="day" data-n="1" aria-label="Nächster Tag">›</button>
    <input type="date" style="width:auto" value="${k}" data-f="ui:date" aria-label="Datum wählen">
    ${isToday ? '' : '<button class="btn" data-a="today">Heute</button>'}
    ${row.t !== 'arbeit' && !isWorkType(row.t) ? `<span class="chip ${tyClass(row.t)}">${esc(tyLabel(row.t))}${typeHint && row.t !== typeHint ? ' · ' + esc(typeHint) : ''}</span>` : ''}
    ${row.planned ? '<span class="chip ty-WE">Plan</span>' : ''}${isPay ? ' <span class="chip ty-Feiertag">Zahltag</span>' : ''}
  </div>
  <div class="stats">
    <div class="stat"><small>Zeitkonto nach diesem Tag</small><b class="${cls(row.konto)}">${fmtT(row.konto, true)}</b><span>Veränderung ${row.planned ? 'offen' : fmtT(row.za - row.zagen, true) + ' h'}</span></div>
    <div class="stat"><small>${live ? 'Arbeitszeit bisher' : 'Arbeitszeit'}</small><b id="liveNet">${row.planned && !live ? '–' : fmtT(stunden)}</b><span>Soll ${fmtT(isWorkType(row.t) && row.wd < 6 && !row.hol ? S.cfg.soll : 0)} h${live ? ' · <span class="clock" id="liveClock">läuft seit ' + esc(d.s) + '</span>' : ''}</span>
      <div class="meter"><i style="width:${Math.min(100, (stunden / S.cfg.soll) * 100)}%"></i></div></div>
    <div class="stat"><small>Woche (KW ${row.kw})</small><b>${fmtT(wIst + (live && wk.find(r => r.k === k) ? live.net - row.stunden : 0))}</b><span>von ${fmtT(wSoll)} h Soll</span>
      <div class="meter"><i style="width:${wSoll ? Math.min(100, (wIst / wSoll) * 100) : 0}%"></i></div></div>
    <div class="stat"><small>Resturlaub</small><b>${fmtDec(row.rest, row.rest % 1 ? 1 : 0)}</b><span>Tage nach diesem Tag</span></div>
  </div>
  <div class="grid2">
    <section class="card">
      <div class="card-h"><h3>Arbeitszeit</h3>
        <div class="seg" role="group" aria-label="Tagesart">${TYPE_OPTS.map(([v, l]) => `<button data-a="setType" data-v="${esc(v)}" aria-pressed="${effType === v || (v === '' && effType === 'arbeit')}">${l}</button>`).join('')}</div></div>
      <div class="stamp">
        <div class="field"><label for="d_s">Kommen</label><input id="d_s" type="time"${tstep()} value="${esc(d.s || '')}" data-f="day:s"></div>
        <div class="field"><label for="d_e">Gehen</label><input id="d_e" type="time"${tstep()} value="${esc(d.e || '')}" data-f="day:e"></div>
        ${isToday && !d.s ? '<button class="btn primary" data-a="stampIn">Kommen jetzt</button>' : ''}
        ${isToday && d.s && !d.e ? '<button class="btn primary" data-a="stampOut">Gehen jetzt</button>' : ''}
      </div>
      <div class="fields" style="margin-top:12px">
        <div class="field"><label for="d_p">Pause (leer = automatisch)</label><input id="d_p" type="time" value="${esc(d.p || '')}" data-f="day:p" placeholder="${HM(row.pause)}"></div>
        <div class="field"><label for="d_a">Abwesenheit (z. B. Arzt)</label><input id="d_a" type="time" value="${esc(d.a || '')}" data-f="day:a"></div>
        <div class="field"><label for="d_th">Thema / Ort</label><input id="d_th" type="text" list="dl-dayth" value="${esc(d.th || '')}" placeholder="${esc(S.cfg.standardThema)}" data-f="day:th"></div>
        <div class="field"><label for="d_z">Korrektur Zeitkonto (h)</label><input id="d_z" type="number" step="0.25" value="${d.z || ''}" data-f="day:z"></div>
      </div>
      <div class="field" style="margin-top:12px"><label for="d_n">Notiz</label><input id="d_n" type="text" value="${esc(d.n || '')}" data-f="day:n"></div>
      <div class="calc">
        <div><small>Anwesend</small><b>${d.s && d.e ? fmtT(Math.max(0, H(d.e) - H(d.s))) : live ? fmtT(live.dur) : '–'}</b></div>
        <div><small>Pause</small><b>${(d.s && d.e) || live ? fmtT(live ? live.pause : row.pause) : '–'}${d.p ? '' : ' <span class="hint">auto</span>'}</b></div>
        <div><small>Saldo Tag</small><b class="${cls(row.za - row.zagen)}">${row.planned ? '–' : fmtT(row.za - row.zagen, true)}</b></div>
        ${d.s && !d.e && isWorkType(row.t) ? `<div><small>Soll erreicht um</small><b>${sollEnde(d) ? HM(sollEnde(d)) : '–'}</b></div>` : ''}
      </div>
      ${warns.length ? `<div class="warns">${warns.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    </section>
    <section class="card">
      <div class="card-h"><h3>Tagesverlauf</h3><span class="hint">Schraffur: anwesend · Blöcke: Tätigkeiten</span></div>
      ${timeline(k, acts, d)}
      <div class="legend" style="margin-top:8px">${[...new Set(acts.map(a => a.cat))].map(c => `<span><i style="background:${catColor(c)}"></i>${esc(c || 'ohne Kategorie')}</span>`).join('') || '<span>Noch keine Tätigkeiten erfasst.</span>'}</div>
      ${acts.length ? `<div class="calc"><div><small>Erfasst</small><b>${fmtT(row.acts)}</b></div><div><small>Arbeitszeit</small><b>${fmtT(row.stunden)}</b></div><div><small>Erfassungsrate</small><b>${row.stunden > 0 ? Math.round((row.acts / row.stunden) * 100) + ' %' : '–'}</b></div></div>` : ''}
    </section>
  </div>
  <section class="card">
    <div class="card-h"><h3>Tätigkeiten am ${fmtShort(k)}</h3><span class="hint">${acts.length} Einträge · ${fmtT(acts.reduce((a, x) => a + netto(x), 0))} h</span></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Von</th><th>Bis</th><th>Unterbr.</th><th class="r">Netto</th>${['cat', 'w', 'sys', 'pn'].filter(colOn).map(f => `<th>${esc(colN(f))}</th>`).join('')}<th>${esc(colN('th'))}</th><th></th></tr></thead>
      <tbody>
      ${acts.map(a => `<tr>
        <td><input type="time"${tstep()} value="${esc(a.s)}" data-f="act:${a.id}:s" aria-label="Von"></td>
        <td>${a.e ? `<input type="time"${tstep()} value="${esc(a.e)}" data-f="act:${a.id}:e" aria-label="Bis">` : `<span class="clock">läuft</span>`}</td>
        <td><input type="time" value="${esc(a.u || '')}" data-f="act:${a.id}:u" aria-label="Unterbrechung"></td>
        <td class="r num">${a.e ? fmtT(netto(a)) : '–'}</td>
        ${colOn('cat') ? `<td><input list="dl-cat" value="${esc(a.cat)}" data-f="act:${a.id}:cat" style="min-width:70px" aria-label="${esc(colN('cat'))}"></td>` : ''}
        ${colOn('w') ? `<td><input list="dl-w" value="${esc(a.w)}" data-f="act:${a.id}:w" style="min-width:90px" aria-label="${esc(colN('w'))}"></td>` : ''}
        ${colOn('sys') ? `<td><input list="dl-sys" value="${esc(a.sys)}" data-f="act:${a.id}:sys" style="min-width:90px" aria-label="${esc(colN('sys'))}"></td>` : ''}
        ${colOn('pn') ? `<td><input list="dl-pn" value="${esc(a.pn || '')}" data-f="act:${a.id}:pn" style="min-width:80px" aria-label="${esc(colN('pn'))}"></td>` : ''}
        <td><input list="dl-th" value="${esc(a.th)}" data-f="act:${a.id}:th" style="min-width:110px;width:100%" aria-label="${esc(colN('th'))}"></td>
        <td>${a.e ? '' : `<button class="btn sm primary" data-a="timerStop" data-id="${a.id}">Stopp</button> `}<button class="btn sm ghost" data-a="delAct" data-id="${a.id}" aria-label="Eintrag löschen">✕</button></td></tr>`).join('')}
      <tr id="addRow" style="background:var(--surface2)">
        <td><input type="time"${tstep()} id="f_s" value="${esc(f.s || sugS)}" data-f="form:s" aria-label="Neu: Von"></td>
        <td><input type="time"${tstep()} id="f_e" value="${esc(f.e)}" data-f="form:e" aria-label="Neu: Bis"></td>
        <td><input type="time" id="f_u" value="${esc(f.u)}" data-f="form:u" aria-label="Neu: Unterbrechung"></td>
        <td></td>
        ${colOn('cat') ? `<td><input id="f_cat" list="dl-cat" value="${esc(f.cat)}" data-f="form:cat" placeholder="${esc(colN('cat'))}" aria-label="Neu: ${esc(colN('cat'))}"></td>` : ''}
        ${colOn('w') ? `<td><input id="f_w" list="dl-w" value="${esc(f.w)}" data-f="form:w" placeholder="${esc(colN('w'))}" aria-label="Neu: ${esc(colN('w'))}"></td>` : ''}
        ${colOn('sys') ? `<td><input id="f_sys" list="dl-sys" value="${esc(f.sys)}" data-f="form:sys" placeholder="${esc(colN('sys'))}" aria-label="Neu: ${esc(colN('sys'))}"></td>` : ''}
        ${colOn('pn') ? `<td><input id="f_pn" list="dl-pn" value="${esc(f.pn || '')}" data-f="form:pn" placeholder="${esc(colN('pn'))}" aria-label="Neu: ${esc(colN('pn'))}"></td>` : ''}
        <td><input id="f_th" list="dl-th" value="${esc(f.th)}" data-f="form:th" placeholder="Was wurde gemacht?" aria-label="Neu: ${esc(colN('th'))}"></td>
        <td><button class="btn sm primary" data-a="addAct">Hinzufügen</button> <button class="btn sm" data-a="timerStart" title="Startet einen Timer ab jetzt">Timer</button></td></tr>
      </tbody></table></div>
    ${dl('dl-cat', L.cat)}${dl('dl-w', L.w)}${dl('dl-sys', L.sys, 200)}${dl('dl-pn', L.pn, 300)}${dl('dl-th', L.thr, 400)}${dl('dl-dayth', L.dayth)}
  </section>`;
}

/* ---------- Woche ---------- */
function viewWoche() {
  const ws = weekStart(UI.date), rows = []; for (let i = 0; i < 7; i++) rows.push(dayRow(E.addDays(ws, i)));
  const sum = f => rows.reduce((a, r) => a + f(r), 0);
  const ist = sum(r => (isWorkType(r.t) && r.wd < 6 ? r.stunden : 0)), soll = sum(r => (r.wd < 6 && !r.hol && (isWorkType(r.t) || r.t === 'Urlaub - halb') ? r.soll * (r.t === 'Urlaub - halb' ? 0.5 : 1) : 0));
  const kw = rows[0].kw, last = rows[6];
  return `
  <div class="nav"><button class="btn" data-a="day" data-n="-7" aria-label="Vorige Woche">‹</button>
    <h2>KW ${kw} <span class="muted" style="font-size:14px">${fmtShort(rows[0].k)} – ${fmtShort(last.k)}${last.k.slice(0, 4)}</span></h2>
    <button class="btn" data-a="day" data-n="7" aria-label="Nächste Woche">›</button><button class="btn" data-a="today">Diese Woche</button></div>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Tag</th><th>Art</th><th>Kommen</th><th>Gehen</th><th class="r">Pause</th><th class="r">Stunden</th><th class="r">Saldo</th><th class="r">Zeitkonto</th><th class="r">Erfasst</th></tr></thead>
    <tbody>${rows.map(r => {
      const d = S.days[r.k] || {}, we = r.wd >= 6;
      return `<tr class="${r.k === todayKey() ? 'sel' : ''} ${we && !r.stunden ? 'dim' : ''}">
        <td><a href="#" data-a="goto" data-k="${r.k}" style="color:inherit;font-weight:600">${fmtShort(r.k)}</a> ${r.hol ? `<span class="hint">${esc(r.hol)}</span>` : ''}</td>
        <td><select data-f="day:t" data-k="${r.k}" aria-label="Art ${r.k}">${TYPE_OPTS.map(([v, l]) => opt(v, l, d.t === 'arbeit' ? '' : (d.t || (E.defaultType(r.k, S.cfg) !== 'arbeit' ? E.defaultType(r.k, S.cfg) : '')))).join('')}</select>${r.planned ? ' <span class="chip ty-WE">Plan</span>' : ''}</td>
        <td><input type="time"${tstep()} value="${esc(d.s || '')}" data-f="day:s" data-k="${r.k}" aria-label="Kommen ${r.k}"></td>
        <td><input type="time"${tstep()} value="${esc(d.e || '')}" data-f="day:e" data-k="${r.k}" aria-label="Gehen ${r.k}"></td>
        <td class="r num">${d.s && d.e ? fmtT(r.pause) : ''}</td>
        <td class="r num"><b>${r.stunden ? fmtT(r.stunden) : ''}</b></td>
        <td class="r num ${r.planned ? 'muted' : cls(r.za - r.zagen)}">${r.planned || (we && !r.stunden) ? '' : fmtT(r.za - r.zagen, true)}</td>
        <td class="r num">${fmtT(r.konto)}</td>
        <td class="r num ${r.acts ? '' : 'muted'}">${r.acts ? fmtT(r.acts) : ''}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td colspan="5">Woche</td><td class="r num">${fmtT(ist)}</td><td class="r num ${cls(ist - soll)}" title="Stunden minus Soll">${fmtT(ist - soll, true)}</td><td class="r num">${fmtT(last.konto)}</td><td class="r num">${fmtT(sum(r => r.acts))}</td></tr></tfoot>
  </table></div><p class="hint" style="margin:10px 0 0">Soll der Woche: ${fmtT(soll)} h (ohne Urlaub, Feiertage, Zeitausgleich, Krankheit). Zeiten direkt in der Tabelle ändern.</p></section>`;
}

/* ---------- Monat ---------- */
function viewMonat() {
  const y = UI.year, m = UI.month, n = monthDays(y, m), first = E.key(y, m, 1), off = E.weekday(first) - 1;
  const Y = R.years[y], M = Y && Y.months[m - 1], t = todayKey();
  let cells = WD.map(w => `<div class="dh">${w}</div>`).join('');
  for (let i = 0; i < off; i++) cells += '<div class="cell out"></div>';
  for (let d = 1; d <= n; d++) {
    const k = E.key(y, m, d), r = dayRow(k); if (!r) { cells += '<div class="cell out"></div>'; continue; }
    const lbl = r.hol && r.t === 'Feiertag' ? r.hol : r.t === 'WE' ? '' : !isWorkType(r.t) ? tyLabel(r.t) : r.t !== 'arbeit' ? r.t : '';
    cells += `<button class="cell ${tyClass(r.t)} ${k === t ? 'today' : ''} ${r.planned ? 'planned' : ''}" data-a="goto" data-k="${k}" title="${fmtDate(k)}">
      <span class="dn"><span>${d}${paydayOf(y, m) === k ? ' <b title="Zahltag" style="color:var(--accent)">€</b>' : ''}</span>${r.acts ? `<span class="num">${fmtDec(r.acts, 1)}</span>` : ''}</span>
      <span class="hv">${r.stunden ? fmtT(r.stunden) : '&nbsp;'}</span><small>${esc(lbl)}</small></button>`;
  }
  const rg = UI.range;
  return `
  <div class="nav"><button class="btn" data-a="mon" data-n="-1" aria-label="Voriger Monat">‹</button><h2>${MONL[m - 1]} ${y}</h2>
    <button class="btn" data-a="mon" data-n="1" aria-label="Nächster Monat">›</button><button class="btn" data-a="todayMon">Heute</button></div>
  ${M ? `<div class="stats">
    <div class="stat"><small>Stunden</small><b>${fmtT(M.stunden)}</b><span>Soll ${fmtT(M.soll)} h</span></div>
    <div class="stat"><small>Zeitkonto Monatsende</small><b class="${cls(M.konto)}">${fmtT(M.konto, true)}</b><span>${M.zaTage ? M.zaTage + ' Tage Zeitausgleich' : 'kein Zeitausgleich'}</span></div>
    <div class="stat"><small>Urlaub / Krank</small><b>${fmtDec(M.urlaub, M.urlaub % 1 ? 1 : 0)} / ${fmtDec(M.krank, M.krank % 1 ? 1 : 0)}</b><span>Tage · Rest ${fmtDec(M.rest, M.rest % 1 ? 1 : 0)}</span></div>
    <div class="stat"><small>Erfassungsrate</small><b>${M.rate == null ? '–' : Math.round(M.rate * 100) + ' %'}</b><span>${fmtT(M.netto)} h in Tätigkeiten</span></div></div>` : ''}
  <section class="card"><div class="cal">${cells}</div>
    <div class="legend" style="margin-top:12px">${[['Urlaub', 'Urlaub'], ['Zeitausgleich', 'Zeitausgleich'], ['krank', 'Krank'], ['Feiertag', 'Feiertag'], ['WE', 'Wochenende']].map(([c, l]) => `<span><i class="${tyClass(c)}"></i>${l}</span>`).join('')}<span>Kursiv: Plan, noch nicht erfasst</span></div></section>
  <section class="card"><div class="card-h"><h3>Zeitraum eintragen</h3><span class="hint">Wochenenden und Feiertage werden übersprungen.</span></div>
    <div class="fields" style="align-items:end">
      <div class="field"><label for="r_from">Von</label><input id="r_from" type="date" value="${rg.from}" data-f="range:from"></div>
      <div class="field"><label for="r_to">Bis</label><input id="r_to" type="date" value="${rg.to}" data-f="range:to"></div>
      <div class="field"><label for="r_t">Art</label><select id="r_t" data-f="range:t">${TYPE_OPTS.slice(1, 7).map(([v, l]) => opt(v, l, rg.t)).join('')}</select></div>
      <div><button class="btn primary" data-a="applyRange">Eintragen</button> <button class="btn" data-a="clearRange">Zurücksetzen</button></div>
    </div></section>`;
}

/* ---------- Tätigkeiten ---------- */
function viewTaet() {
  const F = UI.filt, L = lists();
  const years = [...new Set(S.acts.map(a => a.d.slice(0, 4)))].sort().reverse();
  let list = S.acts.filter(a => (!F.y || a.d.startsWith(F.y)) && (!F.m || a.d.slice(5, 7) === F.m) && (!F.cat || a.cat === F.cat) && (!F.w || a.w === F.w) && (!F.sys || a.sys === F.sys) && (!F.pn || a.pn === F.pn) &&
    (!F.q || (a.th + ' ' + a.sys + ' ' + (a.pn || '') + ' ' + a.w).toLowerCase().includes(F.q.toLowerCase())));
  list.sort((a, b) => (b.d + b.s).localeCompare(a.d + a.s));
  const total = list.reduce((a, x) => a + netto(x), 0);
  const sel = (id, label, arr, cur, f) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-f="filt:${f}"><option value="">alle</option>${arr.map(v => opt(v, v, cur)).join('')}</select></div>`;
  return `
  <div class="nav"><h2>Tätigkeiten</h2><span class="hint">${list.length} Einträge · ${fmtT(total)} h</span></div>
  <section class="card"><div class="fields" style="margin-bottom:14px">
    ${sel('fl_y', 'Jahr', years, F.y, 'y')}
    <div class="field"><label for="fl_m">Monat</label><select id="fl_m" data-f="filt:m"><option value="">alle</option>${MONL.map((n, i) => opt(pad2(i + 1), n, F.m)).join('')}</select></div>
    ${colOn('cat') ? sel('fl_c', esc(colN('cat')), L.cat, F.cat, 'cat') : ''}${colOn('w') ? sel('fl_w', esc(colN('w')), L.w, F.w, 'w') : ''}${colOn('sys') ? sel('fl_s', esc(colN('sys')), L.sys, F.sys, 'sys') : ''}${colOn('pn') ? sel('fl_p', esc(colN('pn')), L.pn, F.pn, 'pn') : ''}
    <div class="field"><label for="fl_q">Suche</label><input id="fl_q" type="search" value="${esc(F.q)}" data-f="filt:q" placeholder="${esc(colN('th'))}, ${esc(colN('sys'))} …"></div></div>
    ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Datum</th><th>Von</th><th>Bis</th><th class="r">Netto</th>${['cat', 'w', 'sys', 'pn'].filter(colOn).map(f => `<th>${esc(colN(f))}</th>`).join('')}<th>${esc(colN('th'))}</th></tr></thead><tbody>
    ${list.slice(0, F.limit).map(a => `<tr class="click" data-a="goto" data-k="${a.d}"><td class="num">${fmtShort(a.d)}${a.d.slice(2, 4)}</td><td class="num">${esc(a.s)}</td><td class="num">${esc(a.e)}</td><td class="r num">${fmtT(netto(a))}</td>
      ${colOn('cat') ? `<td><span class="legend"><i style="background:${catColor(a.cat)};margin:0 5px 0 0"></i></span>${esc(a.cat)}</td>` : ''}${colOn('w') ? `<td>${esc(a.w)}</td>` : ''}${colOn('sys') ? `<td>${esc(a.sys)}</td>` : ''}${colOn('pn') ? `<td>${esc(a.pn || '')}</td>` : ''}<td class="wrapc">${esc(a.th)}</td></tr>`).join('')}</tbody></table></div>
    ${list.length > F.limit ? `<p style="margin:12px 0 0"><button class="btn" data-a="more">Weitere ${Math.min(300, list.length - F.limit)} anzeigen</button> <span class="hint">${list.length - F.limit} ausgeblendet</span></p>` : ''}`
      : '<div class="empty">Keine Einträge für diese Filter.</div>'}
  </section>`;
}

/* ---------- Auswertung ---------- */
function pivot(dim, year) {
  const m = {}; let tot = 0;
  for (const a of S.acts) { if (year !== 'alle' && !a.d.startsWith(year)) continue; const n = netto(a); if (!n) continue; const key = a[dim] || '(leer)'; m[key] = (m[key] || 0) + n; tot += n; }
  const arr = Object.entries(m).sort((x, y) => y[1] - x[1]);
  return { arr, tot };
}
function viewAuswertung() {
  const yrs = Object.keys(R.years).map(Number).sort();
  const y = R.years[UI.year] ? UI.year : yrs[yrs.length - 1], Y = R.years[y], T = Y.tot, t = todayKey();
  const curYear = +t.slice(0, 4), isCur = y === curYear;
  const refKey = isCur ? t : y + '-12-31', ref = R.map[refKey] || R.rows[R.rows.length - 1];
  const nowM = isCur ? +t.slice(5, 7) : 13;
  const years = yrs.filter(v => v <= curYear + 1);
  if (!colOn(UI.dim)) UI.dim = ['cat', 'w', 'sys', 'pn'].find(colOn) || 'cat';
  const pv = pivot(UI.dim, UI.pivotYear), dimName = colN(UI.dim);
  // Prognose bis Jahresende / Kappung
  let prog = '';
  if (isCur) {
    const rem = R.rows.filter(r => r.k > t && r.k.slice(0, 4) === String(y));
    let we = 0, fe = 0, ur = 0, za = 0;
    for (const r of rem) {
      if (r.wd >= 6) we++; else if (r.hol || r.t === 'Feiertag' || r.t === 'Betriebsfrei') fe++;
      else if (r.t === 'Urlaub' || r.t === 'Sonderurlaub') ur++; else if (r.t === 'Urlaub - halb') ur += 0.5; else if (r.t === 'Zeitausgleich') za++;
    }
    const tage = rem.length - we - fe - ur, fr = v => fmtDec(v, v % 1 ? 1 : 0);
    const [km, kd] = S.cfg.kappungTag ? S.cfg.kappungTag.split('-') : [0, 0];
    let capKey = S.cfg.kappungTag ? y + '-' + S.cfg.kappungTag : ''; if (capKey && capKey < t) capKey = (y + 1) + '-' + S.cfg.kappungTag;
    const cr = capKey && R.map[capKey];
    prog = `<section class="card"><div class="card-h"><h3>Ausblick ${y}</h3></div><div class="grid3">
      <div><div class="lbl">Restliche Arbeitstage</div><div class="num" style="font-size:22px;font-weight:600">${fr(tage)}</div><div class="hint">${rem.length} Tage bis Jahresende − ${we} Wochenendtage − ${fe} Feiertage − ${fr(ur)} geplante Urlaubstage · ${fmtT(tage * S.cfg.soll)} h Soll${za ? ` · davon ${za} Tage Zeitausgleich eingeplant` : ''}</div></div>
      ${cr ? `<div><div class="lbl">Zeitkonto am ${pad2(+kd)}.${pad2(+km)}.${cr.k.slice(0, 4)}</div><div class="num" style="font-size:22px;font-weight:600">${fmtT(cr.konto + cr.loss)}</div><div class="hint">${cr.loss > 0.01 ? `<span class="warn">Kappung auf ${fmtT(S.cfg.kappungMax)} h: ${fmtT(cr.loss)} h würden verfallen. Zeitausgleich früher einplanen.</span>` : 'Kein Verfall nach aktuellem Plan.'}</div></div>` : ''}
      <div><div class="lbl">Resturlaub zum Jahresende</div><div class="num" style="font-size:22px;font-weight:600">${fmtDec(T.rest, T.rest % 1 ? 1 : 0)} Tage</div><div class="hint">inklusive bereits eingetragener Planung</div></div></div></section>`;
  }
  return `
  <div class="nav"><h2>Auswertung</h2>
    <div class="seg" role="group" aria-label="Jahr">${years.map(v => `<button data-a="year" data-v="${v}" aria-pressed="${v === y}">${v}</button>`).join('')}</div></div>
  <div class="stats">
    <div class="stat"><small>Stunden ${y}</small><b>${fmtT(T.stunden)}</b><span>Soll ${fmtT(T.soll)} h · gebucht ${fmtT(T.gebucht)} h</span></div>
    <div class="stat"><small>Zeitkonto ${isCur ? 'heute' : 'Jahresende'}</small><b class="${cls(ref.konto)}">${fmtT(ref.konto, true)}</b><span>Stand ${fmtShort(ref.k)}</span></div>
    <div class="stat"><small>Urlaub / Krank</small><b>${fmtDec(T.urlaub, T.urlaub % 1 ? 1 : 0)} / ${fmtDec(T.krank, 1)}</b><span>Tage · Rest ${fmtDec(ref.rest, ref.rest % 1 ? 1 : 0)} ${isCur ? 'heute' : 'am Jahresende'}</span></div>
    <div class="stat"><small>Erfassungsrate</small><b>${T.rate == null ? '–' : Math.round(T.rate * 100) + ' %'}</b><span>${fmtT(T.netto)} h in Tätigkeiten</span></div></div>
  ${prog}
  <div class="grid2">
    <section class="card"><div class="card-h"><h3>Zeitkonto ${y}</h3><span class="hint">Stunden, tagesgenau</span></div><div class="chartbox" id="chKonto"></div></section>
    <section class="card"><div class="card-h"><h3>Stunden pro Monat</h3><span class="hint">Balken: geleistet · Linie: Soll</span></div><div class="chartbox" id="chMon"></div></section>
  </div>
  <section class="card"><div class="card-h"><h3>Monate ${y}</h3></div><div class="tablewrap"><table>
    <thead><tr><th>Monat</th><th class="r">Stunden</th><th class="r">Soll</th><th class="r">Differenz</th><th class="r">Zeitkonto Ende</th><th class="r">Urlaub</th><th class="r">Krank</th><th class="r">Arbeitstage</th><th class="r">Erfasst</th><th class="r">Rate</th></tr></thead>
    <tbody>${Y.months.map((M, i) => `<tr class="click ${i + 1 > nowM ? 'dim' : ''}" data-a="goMon" data-y="${y}" data-m="${i + 1}"><td>${MON[i]}</td><td class="r num">${fmtT(M.stunden)}</td><td class="r num">${fmtT(M.soll)}</td>
      <td class="r num ${cls(M.gebucht - M.soll)}">${fmtT(M.gebucht - M.soll, true)}</td><td class="r num">${fmtT(M.konto)}</td><td class="r num">${fmtDec(M.urlaub, M.urlaub % 1 ? 1 : 0)}</td><td class="r num">${fmtDec(M.krank, M.krank % 1 ? 1 : 0)}</td><td class="r num">${M.arbeitstage}</td><td class="r num">${fmtT(M.netto)}</td><td class="r num">${M.rate == null ? '' : Math.round(M.rate * 100) + ' %'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Jahr</td><td class="r num">${fmtT(T.stunden)}</td><td class="r num">${fmtT(T.soll)}</td><td class="r num ${cls(T.gebucht - T.soll)}">${fmtT(T.gebucht - T.soll, true)}</td><td class="r num">${fmtT(T.konto)}</td><td class="r num">${fmtDec(T.urlaub, T.urlaub % 1 ? 1 : 0)}</td><td class="r num">${fmtDec(T.krank, 1)}</td><td class="r num">${T.arbeitstage}</td><td class="r num">${fmtT(T.netto)}</td><td class="r num">${T.rate == null ? '' : Math.round(T.rate * 100) + ' %'}</td></tr></tfoot></table></div>
    <p class="hint" style="margin:10px 0 0">Differenz = Stunden + Urlaub + Krank − Soll, wie „+- Rechnung“ in der Excel. Künftige Monate zeigen nur Plan.</p></section>
  <section class="card"><div class="card-h"><h3>${I18N.tx('Tätigkeiten nach')} ${esc(I18N.tx(dimName))}</h3>
    <div class="nav"><div class="seg" role="group" aria-label="Gruppierung">${['cat', 'w', 'sys', 'pn'].filter(colOn).map(f => [f, colN(f)]).map(([v, l]) => `<button data-a="dim" data-v="${v}" aria-pressed="${UI.dim === v}">${l}</button>`).join('')}</div>
    <select data-f="ui:pivotYear" aria-label="Zeitraum" style="width:auto">${opt('alle', 'Alle Jahre', UI.pivotYear)}${[...new Set(S.acts.map(a => a.d.slice(0, 4)))].sort().reverse().map(v => opt(v, v, UI.pivotYear)).join('')}</select></div></div>
    ${pv.arr.length ? `<div class="bars">${pv.arr.slice(0, 14).map(([n, v]) => `<div class="barrow"><span class="nm" title="${esc(n)}">${esc(n)}</span><span class="tr"><i style="width:${(v / pv.arr[0][1]) * 100}%;background:${UI.dim === 'cat' ? catColor(n === '(leer)' ? '' : n) : 'var(--c1)'}"></i></span><span class="num" style="text-align:right">${fmtT(v)} <span class="muted">${Math.round((v / pv.tot) * 100)}%</span></span></div>`).join('')}</div>
    <p class="hint" style="margin:10px 0 0">${pv.arr.length > 14 ? `Weitere ${pv.arr.length - 14} Einträge ausgeblendet. ` : ''}Summe ${fmtT(pv.tot)} h.</p>` : '<div class="empty">Noch keine Tätigkeiten erfasst.</div>'}</section>
  <section class="card"><div class="card-h"><h3>Jahresvergleich</h3></div><div class="tablewrap"><table>
    <thead><tr><th>Jahr</th><th class="r">Stunden</th><th class="r">Soll</th><th class="r">Zeitkonto Ende</th><th class="r">Urlaub</th><th class="r">Krank</th><th class="r">Über 10 h/Tag</th><th class="r">Rate</th></tr></thead>
    <tbody>${years.map(v => { const q = R.years[v].tot; return `<tr class="click" data-a="year" data-v="${v}"><td>${v}</td><td class="r num">${fmtT(q.stunden)}</td><td class="r num">${fmtT(q.soll)}</td><td class="r num">${fmtT(q.konto)}</td><td class="r num">${fmtDec(q.urlaub, q.urlaub % 1 ? 1 : 0)}</td><td class="r num">${fmtDec(q.krank, 1)}</td><td class="r num">${fmtT(q.ueber10)}</td><td class="r num">${q.rate == null ? '' : Math.round(q.rate * 100) + ' %'}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}

/* ---------- Einstellungen (mit Unterpunkt Daten) ---------- */
/* ---------- Einstellungen & Daten ---------- */
function viewEinst() {
  const c = S.cfg, r = UI.report;
  const num = (id, label, f, step = '0.25', hint = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" step="${step}" value="${c[f]}" data-f="cfg:${f}" data-num="1">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  return `
  <div class="nav"><h2>Einstellungen</h2><div class="seg" role="group" aria-label="Bereich">${[['einst', 'Einstellungen'], ['daten', 'Daten']].map(([v, l]) => `<button data-a="sub" data-v="${v}" aria-pressed="${UI.sub === v}">${l}</button>`).join('')}</div></div>
  ${UI.sub === 'daten' ? `<div class="grid2">
  <section class="card"><div class="card-h"><h3>Aus der Excel übernehmen</h3></div>
    <p style="margin:0 0 12px">Wähle deine <b>Stunden.xlsm</b>. Gelesen werden die Blätter „ab 2020“ (bei älteren Dateien „Zeiterfassung“), „Tätigkeiten“ und „Gehalt“. Die Datei verlässt deinen Browser nicht. Vorhandene Daten in dieser App werden ersetzt.</p>
    <input type="file" id="fileX" accept=".xlsx,.xlsm,.xls" data-f="file:xlsx" aria-label="Excel-Datei wählen">
    ${r ? `<div class="report"><b>Import fertig.</b><ul style="margin:6px 0 0;padding-left:18px">
      <li>${r.days} Tage mit Einträgen ab ${esc(r.from)}</li><li>${r.acts} Tätigkeiten${r.cols ? ' (' + I18N.tx('Spalten') + ': ' + esc(r.cols) + ')' : ''}</li><li>${r.pay || 0} Monate Gehalt</li>
      <li>${r.adj} Tage mit Handkorrektur aus der Excel als „Korrektur Zeitkonto“ übernommen, damit das Zeitkonto exakt stimmt</li>
      <li>${r.manual} Tage mit abweichender Pause übernommen</li>${r.tipp && r.tipp.length ? `<li>${I18N.tx('Tipp:')} ${esc(r.tipp.join(', '))} ${I18N.tx('enthält fast nur einen Wert. Unter „Einstellungen“ kannst du die Spalte ausblenden.')}</li>` : ''}</ul></div>` : ''}
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <div class="card-h"><h3>Sicherung</h3></div>
    <p class="hint" style="margin:0 0 10px">Die Daten liegen nur in diesem Browser. Speichere regelmäßig eine Sicherung, auch um auf ein anderes Gerät zu wechseln.</p>
    <div class="nav"><button class="btn primary" data-a="exportJson">Sicherung speichern (.json)</button><button class="btn" data-a="exportCsv">Tätigkeiten als CSV</button></div>
    <div class="field" style="margin-top:12px"><label for="fileJ">Sicherung einlesen</label><input type="file" id="fileJ" accept=".json,application/json" data-f="file:json"></div>
  </section>
  <section class="card">
    <div class="card-h"><h3>Version</h3></div>
    <p class="hint" style="margin:0 0 10px"><b>Version ${esc(VERSION)}</b>. ${REPO ? 'Die App prüft höchstens einmal am Tag, ob es eine neue Version gibt. Dabei wird nur die Versionsnummer abgefragt, keine deiner Daten gesendet.' : ''}</p>
    <div class="nav"><button class="btn" data-a="chkUpd">Nach Updates suchen</button><span class="hint" id="updState"></span></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <div class="nav">${UI.confirm === 'reset' ? `<span>Alle Daten in diesem Browser löschen?</span><button class="btn danger" data-a="resetAll">Ja, löschen</button><button class="btn" data-a="cancelConfirm">Abbrechen</button>` : '<button class="btn danger" data-a="askReset">Alle Daten löschen</button><button class="btn" data-a="loadDemo">Beispieldaten laden</button>'}</div>
  </section>
  </div>` : `  <section class="card"><div class="card-h"><h3>Einstellungen</h3><span class="hint">Jede Änderung rechnet alles sofort neu. Davor am besten eine Sicherung speichern.</span></div>
    <h4 class="sh">Arbeitszeit</h4>
    <div class="sollv"><table><thead><tr><th>Gültig ab</th><th class="r">Soll pro Arbeitstag (h)</th><th class="r">Pro Woche (h)</th><th></th></tr></thead><tbody>
      ${(c.sollVerlauf || []).map((x, i) => `<tr><td>${i === 0 ? `<span class="hint">Startdatum ${esc(fmtDate(x.ab))}</span>` : `<input type="date" value="${esc(x.ab)}" data-f="sv:${i}:ab" aria-label="Gültig ab">`}</td>
        <td class="r"><input type="number" step="0.25" min="0.25" value="${x.soll}" data-f="sv:${i}:soll" aria-label="Soll pro Arbeitstag" style="width:90px"></td>
        <td class="r num">${fmtDec(x.soll * 5, 2)}</td><td>${i === 0 ? '' : `<button class="btn sm ghost" data-a="svDel" data-i="${i}" aria-label="Änderung entfernen">✕</button>`}</td></tr>`).join('')}
    </tbody></table>
    <button class="btn sm" data-a="svAdd">Änderung der Arbeitszeit hinzufügen</button></div>
    <p class="hint" style="margin:6px 0 14px"><b>Wirkung:</b> Ein neues Soll gilt nur ab dem Datum. Zeitkonto, Krankheitsquote, Urlaub halb und alle Auswertungen davor bleiben wie erfasst. Wenn du die Arbeitszeit änderst, lege also eine neue Zeile mit dem Datum an und ändere nicht den alten Wert, sonst wird die Vergangenheit neu gerechnet. Das Soll gilt je Arbeitstag, bei 5 Tagen die Woche siehst du rechts die Wochenstunden.</p>
    <div class="fields wide">
      ${num('c_max', 'Max. Stunden pro Tag', 'tagesMax', '0.25', 'Alles darüber zählt als Überzeit und nicht fürs Konto. Wirkt auf alle Tage, auch vergangene.')}
    </div>
    <h4 class="sh">Urlaub</h4>
    <div class="fields wide">
      ${num('c_uj', 'Urlaubstage pro Jahr', 'urlaubJahr', '0.5', 'Wird am 01.01. gutgeschrieben. Wirkt auf alle Jahre ab Startdatum: der Resturlaub vergangener Jahre ändert sich mit.')}
      <div class="field"><label for="c_ht">24.12. und 31.12.</label><select id="c_ht" data-f="cfg:halbeTage" data-bool="1">${opt('true', 'halber Urlaubstag', String(c.halbeTage))}${opt('false', 'normaler Arbeitstag', String(c.halbeTage))}</select><span class="hint">Gilt für alle Jahre. Tage mit eigenem Eintrag oder gewählter Art bleiben unberührt.</span></div>
      <div class="field"><label for="c_uv">Verfall Vorjahresurlaub (MM-TT)</label><input id="c_uv" value="${esc(c.urlaubVerfall)}" placeholder="05-01" data-f="cfg:urlaubVerfall"><span class="hint">Stichtag, an dem nicht genommener Vorjahresurlaub verfällt. Leer = nie. Gilt ab dem Jahr unten.</span></div>
      ${num('c_uva', 'Verfall gilt ab Jahr', 'urlaubVerfallAb', '1', 'Frühere Jahre bleiben ohne Verfall.')}
      ${num('c_lm', 'Urlaub ins Langzeitkonto (Tage)', 'lzkMax', '0.5', 'So viele Tage des Rests gehen am Verfallstag ins Langzeitkonto, der Rest verfällt. Wirkt ab dem Jahr oben.')}
      ${num('c_sl', 'Langzeitkonto zum Startdatum (Tage)', 'startLzk', '0.5', 'Startwert, vor allem nach einem Import.')}
    </div>
    <h4 class="sh">Zeitkonto</h4>
    <div class="fields wide">
      <div class="field"><label for="c_kt">Stichtag Kappung (MM-TT)</label><input id="c_kt" value="${esc(c.kappungTag)}" placeholder="10-31" data-f="cfg:kappungTag"><span class="hint">An diesem Tag wird das Zeitkonto auf den Wert unten gekappt. Leer = keine Kappung. Wirkt auf alle Jahre, das Zeitkonto vergangener Jahre ändert sich.</span></div>
      ${num('c_km', 'Saldo nach Kappung (h)', 'kappungMax', '0.25', 'Höchstwert nach dem Stichtag.')}
    </div>
    <h4 class="sh">Startwerte</h4>
    <div class="fields wide">
      <div class="field"><label for="c_sd">Startdatum</label><input id="c_sd" type="date" value="${c.startDatum}" data-f="cfg:startDatum"><span class="hint">Erster Tag der Rechnung. Frühere Einträge werden nicht gewertet.</span></div>
      ${num('c_ks', 'Zeitkonto zum Startdatum (h)', 'startSaldo', '0.01', 'Verschiebt das gesamte Zeitkonto um den Betrag.')}
      ${num('c_ku', 'Resturlaub zum Startdatum', 'startUrlaub', '0.5', 'Verschiebt den gesamten Resturlaub um den Betrag.')}
    </div>
    <p class="hint" style="margin:6px 0 14px">Nach einem Excel-Import stehen bei einigen Tagen Korrekturen („Korrektur Zeitkonto“ am Tag). Sie gleichen Handänderungen aus der Excel aus und bleiben bei Regeländerungen als feste Stundenwerte erhalten. Nach einer Regeländerung kannst du sie unter Heute pro Tag prüfen.</p>
    <h4 class="sh">Gehalt</h4>
    <div class="fields wide">
      <div class="field"><label for="c_zf">Zahltag</label><select id="c_zf" data-f="cfg:zahltagModus">${ZAHLTAG_OPTS.map(([v, l]) => opt(v, l, c.zahltagModus)).join('')}</select><span class="hint">Nur das Datum der Auszahlung (Kalender und Gehalt), betrifft keine Stunden. Werktag heißt Mo bis Fr ohne Feiertage, 24.12. und 31.12. (außer bei „Mo bis Fr“). Fällt ein Termin auf einen freien Tag, wird der 15. und der Monatsletzte auf den Werktag davor gezogen, der Monatsanfang auf den nächsten Werktag.</span></div>
      <div class="field"><label for="c_pm">Erhöhung in der Prognose: Monat</label><select id="c_pm" data-f="cfg:payRiseMonat" data-int="1">${opt('0', 'keine Erhöhung annehmen', String(c.payRiseMonat || 0))}${MONL.map((n, i) => opt(String(i + 1), n, String(c.payRiseMonat || 0))).join('')}</select><span class="hint">Nur für künftige Monate. Bei „keine“ bleibt das Brutto in der Prognose gleich.</span></div>
      <div class="field"><label for="c_pa">Erhöhung in der Prognose: Art</label><select id="c_pa" data-f="cfg:payRiseArt">${opt('pct', 'Prozent', c.payRiseArt || 'pct')}${opt('eur', 'Betrag in € (Brutto pro Monat)', c.payRiseArt || 'pct')}</select><span class="hint">Wie die erwartete Erhöhung angegeben wird.</span></div>
      ${c.payRiseArt === 'eur'
        ? `<div class="field"><label for="c_pe">Erwartete Erhöhung (€ brutto pro Monat)</label><input id="c_pe" type="number" step="1" min="0" value="${c.payRiseEur ? String(c.payRiseEur).replace(',', '.') : ''}" data-f="cfg:payRiseEur" data-num="1"><span class="hint">Wird ab dem Erhöhungsmonat zum Grundgehalt addiert.</span></div>`
        : `<div class="field"><label for="c_pr">Erwartete Erhöhung (%)</label><input id="c_pr" type="number" step="0.1" value="${fmtDec(c.payRise * 100, 1).replace(',', '.')}" data-f="cfg:payRise" data-num="1" data-pct="1"><span class="hint">Wird ab dem Erhöhungsmonat auf das Grundgehalt aufgeschlagen.</span></div>`}
      <div class="field"><label for="c_mir">Spalte MIR (z. B. Werkskantine)</label><select id="c_mir" data-f="cfg:mirAn" data-bool="1">${opt('true', 'anzeigen', String(c.mirAn !== false))}${opt('false', 'ausblenden', String(c.mirAn !== false))}</select><span class="hint">MIR ist der Abzug bzw. Betrag aus der Werkskantine, der zum Überwiesenen addiert das Netto ergibt. Ausgeblendet wird die Spalte nicht angezeigt und nicht mitgerechnet. Bereits eingetragene MIR-Werte bleiben gespeichert.</span></div>
      <p class="hint" style="grid-column:1/-1;margin:0">Echte Erhöhungen trägst du direkt in „Gehalt“ ein (Brutto des Monats). Ab diesem Monat rechnet die Prognose mit dem neuen Wert weiter. Erfasste Gehaltsmonate ändern sich durch diese Einstellungen nicht.</p>
    </div>
    <h4 class="sh">Feiertage</h4>
    <div class="fields wide">
      <div class="field"><label for="c_rg">Bundesland</label><select id="c_rg" data-f="cfg:region">${Object.keys(REGION_NAMES).map(v => opt(v, REGION_NAMES[v], c.region || 'NW')).join('')}</select><span class="hint">Bestimmt die gesetzlichen Feiertage für Kalender, Soll, Zahltag und Urlaubsplanung, für alle Jahre. Örtliche Sonderfälle (z. B. Augsburger Friedensfest) sind nicht enthalten. Tage mit eigenem Eintrag bleiben unberührt.</span></div>
    </div>
    <h4 class="sh">Zeiterfassung</h4>
    <div class="fields wide">
      <div class="field"><label for="c_ra">Uhrzeiten erfassen</label><select id="c_ra" data-f="cfg:raster">${opt('min', 'minutengenau', c.raster || 'min')}${opt('15', 'viertelstündlich', c.raster || 'min')}</select><span class="hint">Bei „viertelstündlich“ bieten die Zeitfelder (Kommen, Gehen, Von, Bis) eine Auswahlliste in 15-Minuten-Schritten an und springen in 15-Minuten-Schritten, eingetippte Uhrzeiten und der Timer (Kommen/Gehen jetzt, Tätigkeiten) werden auf die nächste Viertelstunde auf- oder abgerundet. Bereits erfasste Zeiten bleiben unverändert.</span></div>
    </div>
    <h4 class="sh">Spaltennamen der Tätigkeiten</h4>
    <div class="fields wide">
      ${['cat', 'w', 'sys', 'pn', 'th'].map(x => `<div class="field"><label for="c_col_${x}">${esc(COLD[x])}</label><input id="c_col_${x}" value="${esc((c.spalten && c.spalten[x]) || '')}" placeholder="${esc(COLD[x])}" data-f="col:${x}">${x === 'th' ? '' : `<select aria-label="${esc(COLD[x])}" data-f="colv:${x}" style="margin-top:6px">${opt('true', 'anzeigen', String(colOn(x)))}${opt('false', 'ausblenden', String(colOn(x)))}</select>`}</div>`).join('')}
      <span class="hint" style="grid-column:1/-1">Eigene Namen und Sichtbarkeit der Spalten bei Tätigkeiten, in Filtern, Auswertung und CSV-Export. Leer lassen für den Standardnamen. Die Projektnummer ist standardmäßig ausgeblendet und wird beim Excel-Import eingeschaltet, wenn die Datei eine solche Spalte hat. Ausgeblendete Spalten behalten ihre erfassten Werte.</span>
    </div>
    <h4 class="sh">Anzeige</h4>
    <div class="fields wide">
      <div class="field"><label for="c_th">Standard-Thema</label><input id="c_th" value="${esc(c.standardThema)}" data-f="cfg:standardThema"><span class="hint">Thema, das bei normalen Arbeitstagen als Vorgabe gilt. Nur Anzeige.</span></div>
      <div class="field"><label for="c_an">Zahlenanzeige</label><select id="c_an" data-f="cfg:anzeige">${opt('dez', 'Dezimal (7,50)', c.anzeige)}${opt('hm', 'Stunden:Minuten (7:30)', c.anzeige)}</select><span class="hint">Nur die Darstellung, nichts wird umgerechnet.</span></div>
    </div>
  </section>
  <section class="card" style="margin-top:16px"><div class="card-h"><h3>So wird gerechnet</h3></div>
    <ul class="hint" style="margin:0;padding-left:18px;line-height:1.6">
      <li>Pause automatisch: ab 6 h Anwesenheit bis 6,5 h die Überschreitung, bis 9 h 30 min, darüber mindestens 30 min bis 45 min ab 9,75 h. Manuell überschreibbar.</li>
      <li>Angerechnet werden höchstens ${fmtDec(c.tagesMax, 0)} h pro Tag. Der Rest erscheint als „Über ${fmtDec(c.tagesMax, 0)} h“ in der Jahresübersicht.</li>
      <li>Saldo je Arbeitstag = Stunden − Soll. Wochenende zählt voll als Mehrarbeit. Urlaub, Feiertag und Krankheit ändern das Konto nicht. Zeitausgleich zieht ein Soll ab.</li>
      <li>Feiertage werden für das gewählte Bundesland automatisch gesetzt. Tage ohne Eintrag in der Zukunft gelten als Plan und belasten das Konto nicht.</li>
      <li>Die Erfassungsrate vergleicht die Summe der Tätigkeiten mit der Arbeitszeit.</li></ul>
  </section>
`}`;
}

/* ---------- Rahmen ---------- */
const TABS = [['heute', 'Heute'], ['woche', 'Woche'], ['monat', 'Monat'], ['urlaub', 'Urlaub'], ['taet', 'Tätigkeiten'], ['auswertung', 'Auswertung'], ['gehalt', 'Gehalt'], ['einst', 'Einstellungen']];
function render() {
  if (!R) recompute();
  $('#tabs').innerHTML = TABS.map(([id, l]) => `<button class="tab" data-a="tab" data-v="${id}"${UI.tab === id ? ' aria-current="page"' : ''}>${l}</button>`).join('');
  $('#banner').innerHTML = S.demo ? `<div class="banner"><span><b>Beispieldaten.</b> Diese Einträge sind erfunden. Lade deine Excel unter „Einstellungen“ → „Daten“, um mit deinen Zahlen zu arbeiten.</span><button class="btn sm primary" data-a="tab" data-v="daten">Excel importieren</button></div>` : '';
  const v = { heute: viewHeute, woche: viewWoche, monat: viewMonat, urlaub: viewUrlaub, taet: viewTaet, auswertung: viewAuswertung, gehalt: viewGehalt, einst: viewEinst }[UI.tab];
  const sy = window.scrollY;
  $('#view').innerHTML = v() + (S.cfg.raster === '15' ? `<datalist id="dl-t15">${Array.from({ length: 96 }, (_, i) => `<option value="${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}">`).join('')}</datalist>` : '');
  window.scrollTo(0, sy);
  $('#langSw').innerHTML = ['de', 'en'].map(l => `<button data-a="lang" data-v="${l}" aria-pressed="${I18N.lang === l}" title="${l === 'de' ? 'Deutsch' : 'English'}">${l.toUpperCase()}</button>`).join('');
  updatePill(); drawCharts();
}
function timerTick() {
  const k = UI.date; if (UI.tab !== 'heute' || k !== todayKey()) return;
  const d = S.days[k] || {}, li = liveInfo(k, d); if (!li) return;
  const a = $('#liveNet'); if (a) a.textContent = fmtT(li.net);
}
