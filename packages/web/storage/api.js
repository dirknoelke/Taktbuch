/* ---------- Speicher-Adapter: Synchronisation mit dem Server (Online-Build) ----------
   Gleicher Vertrag wie indexeddb.js (async get(k), async set(k, v)), intern aber "lokal zuerst":
   - Der Stand wird in Datensätze zerlegt (je Einstellung, Tag, Tätigkeit, Gehaltsmonat). Beim Speichern
     gehen nur geänderte Datensätze raus; zwei Geräte, die verschiedene Tage ändern, stören sich nicht.
   - Jede Änderung landet sofort in einer Warteschlange im Browser (IndexedDB) und wird im Hintergrund
     übertragen. Ist der Server weg, versucht es die App selbst wieder; nichts geht beim Neuladen verloren.
   - Ein Live-Kanal (Server-Sent Events) meldet Änderungen anderer Geräte; die App aktualisiert sich selbst.
   - Gleicher Datensatz auf zwei Geräten geändert: die zuletzt übertragene Änderung gilt.
   Zugriff auf den App-Zustand (S, recompute, render, saveTimer, newId, DEFAULT_CFG) erst zur Laufzeit. */
const DB = (() => {
  const COLLS = { cfg: 'cfg', day: 'days', pay: 'pay' };   // act liegt als Liste in S.acts
  let org = null, idb = null, rev = 0, booted = null, busy = false, pulling = false, repull = false;
  let retryT = null, retryN = 0, es = null, state = 'ok', demo = false;
  const rec = new Map();       // vom Server bestätigter Stand: Schlüssel "coll:id" -> JSON-Text
  const pending = new Map();   // noch nicht übertragen: Schlüssel -> JSON-Text oder null (gelöscht)
  let snap = new Map();        // was die App zuletzt hatte (Vergleichsbasis für Änderungen)
  const incoming = new Set();  // vom Server geänderte Schlüssel, die noch in S übernommen werden müssen

  /* ---------- IndexedDB (lokale Kopie und Warteschlange) ---------- */
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const openIdb = name => new Promise((res, rej) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => { for (const s of ['rec', 'pending', 'meta']) q.result.createObjectStore(s); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const idbName = o => 'taktbuch-sync-' + o;
  async function idbAll(store) {
    const t = idb.transaction(store).objectStore(store);
    const [keys, vals] = await Promise.all([req(t.getAllKeys()), req(t.getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  }
  function idbWrite(ops) {   // ops: [store, key, value | undefined(=löschen)]
    if (!idb || !ops.length) return Promise.resolve();
    return new Promise(res => {
      try {
        const t = idb.transaction(['rec', 'pending', 'meta'], 'readwrite');
        for (const [s, k, v] of ops) v === undefined ? t.objectStore(s).delete(k) : t.objectStore(s).put(v, k);
        t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res();
      } catch (e) { res(); }
    });
  }

  /* ---------- Zustand <-> Datensätze ---------- */
  function toMap(s) {
    const m = new Map(), put = (k, v) => { const j = JSON.stringify(v); if (j !== undefined) m.set(k, j); };
    for (const k in s.cfg || {}) put('cfg:' + k, s.cfg[k]);
    for (const k in s.days || {}) put('day:' + k, s.days[k]);
    for (const a of s.acts || []) { if (!a.id) a.id = newId(); put('act:' + a.id, a); }
    for (const k in s.pay || {}) put('pay:' + k, s.pay[k]);
    return m;
  }
  function fromMap(m) {
    const s = { v: 1, cfg: {}, days: {}, acts: [], pay: {}, demo: false };
    for (const [k, j] of m) { if (j === null) continue; const i = k.indexOf(':'), c = k.slice(0, i), id = k.slice(i + 1), v = JSON.parse(j); c === 'act' ? s.acts.push(v) : s[COLLS[c]][id] = v; }
    return s;
  }
  const merged = () => { const m = new Map(rec); for (const [k, v] of pending) v === null ? m.delete(k) : m.set(k, v); return m; };

  /** Einen Datensatz in den laufenden App-Zustand S übernehmen. */
  function applyToS(k, j) {
    const i = k.indexOf(':'), c = k.slice(0, i), id = k.slice(i + 1), v = j === null || j === undefined ? undefined : JSON.parse(j);
    if (c === 'act') {
      const n = S.acts.findIndex(a => a.id === id);
      if (v === undefined) { if (n >= 0) S.acts.splice(n, 1); } else if (n >= 0) S.acts[n] = v; else S.acts.push(v);
    } else if (c === 'cfg') {
      if (v === undefined) { if (id in DEFAULT_CFG) S.cfg[id] = JSON.parse(JSON.stringify(DEFAULT_CFG[id])); else delete S.cfg[id]; } else S.cfg[id] = v;
    } else { const o = S[COLLS[c]]; if (v === undefined) delete o[id]; else o[id] = v; }
  }

  /* ---------- Statusanzeige ---------- */
  const TEXT = { ok: 'Synchronisiert', busy: 'Speichert …', offline: 'Offline · lokal gesichert', auth: 'Abgemeldet · lokal gesichert', error: 'Übertragung gestört', demo: 'Beispieldaten' };
  const TIP = {
    ok: 'Alle Änderungen sind auf dem Server.', busy: 'Änderungen werden übertragen.',
    offline: 'Keine Verbindung zum Server. Änderungen sind in diesem Browser gesichert und werden automatisch übertragen.',
    auth: 'Die Anmeldung ist abgelaufen. Änderungen sind in diesem Browser gesichert und werden nach der Anmeldung übertragen.',
    error: 'Der Server hat Änderungen abgelehnt. Sie bleiben in diesem Browser gesichert, die App versucht es weiter.',
    demo: 'Beispieldaten werden nicht gespeichert. Importiere deine Daten unter Einstellungen.'
  };
  function status(st) {
    state = st;
    let el = document.querySelector('#tbSync');
    if (!el) {
      const at = document.querySelector('#saveState'); if (!at) return;
      at.style.display = 'none';
      at.insertAdjacentHTML('afterend', '<div class="sync" id="tbSync" role="status"><i></i><span></span></div>');
      el = document.querySelector('#tbSync');
    }
    el.dataset.state = st; el.title = TIP[st]; el.querySelector('span').textContent = TEXT[st];
    const b = document.querySelector('#tbSave');
    if (st === 'auth') {
      if (!b) { const a = document.querySelector('#banner'); if (a) a.insertAdjacentHTML('beforebegin', '<div id="tbSave"><div class="banner"><span><b>Anmeldung abgelaufen.</b> Deine Änderungen sind in diesem Browser gesichert und werden nach der Anmeldung übertragen.</span><a class="btn sm primary" href="/login">Anmelden</a></div></div>'); }
    } else if (b) b.remove();
  }
  const settle = () => status(demo ? 'demo' : pending.size ? (navigator.onLine === false ? 'offline' : 'busy') : 'ok');

  /* ---------- Netz ---------- */
  const toLogin = () => { location.href = '/login'; return new Promise(() => { }); };
  const halt = msg => {
    const v = document.querySelector('#view');
    if (v) v.innerHTML = '<section class="card" style="max-width:640px;margin:40px auto"><h3>Daten konnten nicht geladen werden</h3><p class="hint">' + msg + '</p><p><button class="btn primary" id="tbRetry">Erneut versuchen</button></p></section>';
    const b = document.querySelector('#tbRetry'); if (b) b.addEventListener('click', () => location.reload());
    return new Promise(() => { });   // Start bewusst nicht fortsetzen
  };
  class HttpError extends Error { constructor(s) { super('HTTP ' + s); this.status = s; } }
  async function call(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new HttpError(r.status);
    return r.json();
  }
  function retryLater(e) {
    clearTimeout(retryT);
    if (e && e.status === 401) { status('auth'); return; }   // erst nach erneuter Anmeldung (neuer Seitenaufruf)
    status(e && e.status && e.status !== 502 && e.status !== 503 && e.status !== 504 ? 'error' : 'offline');
    const wait = [2, 5, 10, 30, 60][Math.min(retryN++, 4)] * 1000;
    retryT = setTimeout(() => { retryT = null; flush(); pull(); }, wait);
  }

  /** Warteschlange übertragen. */
  async function flush() {
    if (busy || !pending.size || demo || state === 'auth') return;
    busy = true;
    const batch = [...pending].slice(0, 5000);
    try {
      status('busy');
      await call('POST', '/api/sync', { changes: batch.map(([k, j]) => { const i = k.indexOf(':'); return { c: k.slice(0, i), id: k.slice(i + 1), v: j === null ? null : JSON.parse(j) }; }) });
      const ops = [];
      for (const [k, j] of batch) {
        if (pending.get(k) !== j) continue;   // inzwischen erneut geändert: bleibt in der Warteschlange
        pending.delete(k); ops.push(['pending', k, undefined]);
        if (j === null) { rec.delete(k); ops.push(['rec', k, undefined]); } else { rec.set(k, j); ops.push(['rec', k, j]); }
      }
      await idbWrite(ops);
      retryN = 0; busy = false;
      if (pending.size) return flush();
      settle(); pull();
    } catch (e) { busy = false; retryLater(e); }
  }

  /** Änderungen anderer Geräte holen. */
  async function pull() {
    if (pulling) { repull = true; return; }
    pulling = true;
    try {
      const d = await call('GET', '/api/sync?since=' + rev);
      const ops = [];
      if (d.full) {
        const keep = new Set(d.changes.map(x => x.c + ':' + x.id));
        for (const k of rec.keys()) if (!keep.has(k)) { rec.delete(k); ops.push(['rec', k, undefined]); incoming.add(k); }
      }
      for (const x of d.changes) {
        const k = x.c + ':' + x.id, j = x.v === null ? null : JSON.stringify(x.v);
        if (j === null) { rec.delete(k); ops.push(['rec', k, undefined]); } else { rec.set(k, j); ops.push(['rec', k, j]); }
        incoming.add(k);
      }
      rev = d.rev; ops.push(['meta', 'rev', rev]);
      await idbWrite(ops);
      if (state === 'offline' || state === 'error') settle();
      applyIncoming();
    } catch (e) { if (!pending.size) retryLater(e); }
    pulling = false;
    if (repull) { repull = false; pull(); }
  }

  /** Server-Änderungen in die laufende App übernehmen, ohne laufende Eingaben zu stören. */
  let applyT = null;
  function applyIncoming() {
    if (!incoming.size) return;
    clearTimeout(applyT);
    if (typeof saveTimer !== 'undefined' && saveTimer) { applyT = setTimeout(applyIncoming, 400); return; }   // eigene Eingabe noch nicht gesichert
    if (demo) {   // Beispieldaten: sobald echte Daten da sind, diese anzeigen
      if (!rec.size) { incoming.clear(); return; }
      const s = fromMap(merged()); S = s; S.cfg = Object.assign({}, DEFAULT_CFG, s.cfg); demo = false; incoming.clear();
      snap = toMap(S); refresh(); settle(); return;
    }
    let changed = false;
    for (const k of incoming) {
      if (pending.has(k)) continue;   // eigene, noch nicht übertragene Änderung gilt
      const j = rec.has(k) ? rec.get(k) : null;
      if ((snap.has(k) ? snap.get(k) : null) === j) continue;   // Echo der eigenen Änderung
      applyToS(k, j); changed = true;
      const now = toMapOne(k); if (now === null) snap.delete(k); else snap.set(k, now);
    }
    incoming.clear();
    if (changed) refresh();
  }
  function toMapOne(k) {
    const i = k.indexOf(':'), c = k.slice(0, i), id = k.slice(i + 1);
    const v = c === 'act' ? S.acts.find(a => a.id === id) : c === 'cfg' ? S.cfg[id] : S[COLLS[c]][id];
    const j = JSON.stringify(v); return j === undefined ? null : j;
  }
  let refreshT = null;
  function refresh() {
    clearTimeout(refreshT);
    const a = document.activeElement;
    if (a && a.closest && a.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {   // nicht mitten in einer Eingabe neu zeichnen
      a.addEventListener('blur', () => { refreshT = setTimeout(refresh, 50); }, { once: true });
      return;
    }
    recompute(); render();
  }

  /** Live-Kanal: Hinweis auf neuen Stand, dann holen. Bricht er ab, verbindet der Browser selbst neu. */
  function live() {
    if (!window.EventSource || es) return;
    es = new EventSource('/api/sync/events');
    es.onopen = () => pull();
    es.onmessage = ev => { try { if (JSON.parse(ev.data).rev > rev) pull(); } catch (e) { } };
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED) return;   // Browser verbindet selbst neu
      es = null;
      fetch('/api/me', { credentials: 'same-origin' }).then(r => { if (r.status === 401) status('auth'); else setTimeout(live, 10000); }).catch(() => setTimeout(live, 10000));
    };
  }

  async function boot() {
    let me = null;
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) return toLogin();
      if (r.ok) me = await r.json();
    } catch (e) { }
    try { org = me ? me.org : localStorage.getItem('tb-org'); if (me) localStorage.setItem('tb-org', me.org); } catch (e) { org = me && me.org; }
    if (!org) return halt('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
    try {
      idb = await openIdb(idbName(org));
      for (const [k, v] of await idbAll('rec')) rec.set(k, v);
      for (const [k, v] of await idbAll('pending')) pending.set(k, v);
      rev = (await req(idb.transaction('meta').objectStore('meta').get('rev'))) || 0;
    } catch (e) { idb = null; rec.clear(); pending.clear(); rev = 0; }   // ohne IndexedDB: nur im Speicher
    try {
      const d = await call('GET', '/api/sync?since=' + rev);
      const ops = [];
      if (d.full) { for (const k of rec.keys()) ops.push(['rec', k, undefined]); rec.clear(); }
      for (const x of d.changes) { const k = x.c + ':' + x.id; if (x.v === null) { rec.delete(k); ops.push(['rec', k, undefined]); } else { const j = JSON.stringify(x.v); rec.set(k, j); ops.push(['rec', k, j]); } }
      rev = d.rev; ops.push(['meta', 'rev', rev]);
      await idbWrite(ops);
    } catch (e) {
      if (e.status === 401) return toLogin();
      if (!rec.size && !pending.size) return halt(e.status ? 'Der Server hat mit Fehler ' + e.status + ' geantwortet.' : 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
      setTimeout(() => retryLater(e), 0);   // mit der lokalen Kopie weiterarbeiten
    }
    const m = merged();
    setTimeout(() => { live(); flush(); if (state !== 'offline' && state !== 'error') settle(); }, 0);
    if (!m.size) { demo = true; return undefined; }
    snap = m;
    return JSON.stringify(fromMap(m));
  }

  window.addEventListener('online', () => { retryN = 0; flush(); pull(); });
  window.addEventListener('offline', () => { if (pending.size) status('offline'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); pull(); } });
  // Nur im kurzen Moment zwischen Eingabe und Sicherung (oder ganz ohne IndexedDB) beim Schließen nachfragen
  window.addEventListener('beforeunload', ev => { if ((typeof saveTimer !== 'undefined' && saveTimer) || (!idb && pending.size)) { ev.preventDefault(); ev.returnValue = ''; } });

  return {
    async get(k) {
      if (k !== 'state') return undefined;   // Auto-Sicherung u. Ä. gibt es online nicht
      if (!booted) booted = boot();
      return booted;
    },
    async set(k, v) {
      if (k !== 'state') return true;
      if (S.demo) { demo = true; status('demo'); return true; }
      demo = false;
      const now = toMap(S), ops = [];
      for (const [key, j] of now) if (snap.get(key) !== j) { pending.set(key, j); ops.push(['pending', key, j]); }
      for (const key of snap.keys()) if (!now.has(key)) { pending.set(key, null); ops.push(['pending', key, null]); }
      snap = now;
      if (!ops.length) { settle(); return true; }
      await idbWrite(ops);
      status('busy'); flush();
      return true;
    },
    saved() { },
    /** Abmelden: lokale Kopie löschen. Gibt false zurück, wenn noch nicht Übertragenes verloren ginge und abgebrochen wurde. */
    async forget() {
      if (pending.size && !confirm('Einige Änderungen sind noch nicht auf dem Server und gehen beim Abmelden verloren. Trotzdem abmelden?')) return false;
      try { if (idb) idb.close(); indexedDB.deleteDatabase(idbName(org)); localStorage.removeItem('tb-org'); } catch (e) { }
      return true;
    },
    _debug: () => ({ rev, pending: pending.size, rec: rec.size, state })
  };
})();

/* Online-Kennzeichnung, Konto, Abmelden, Statusanzeige */
(() => {
  const ver = document.querySelector('#ver'); if (ver) ver.textContent = 'online';
  document.head.insertAdjacentHTML('beforeend', `<style>
.sync{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);white-space:nowrap}
.sync i{width:8px;height:8px;border-radius:50%;background:var(--pos);flex:none}
.sync[data-state=busy] i{background:var(--muted)}
.sync[data-state=offline] i,.sync[data-state=error] i{background:var(--warn)}
.sync[data-state=auth] i{background:var(--neg)}
.sync[data-state=demo] i{background:transparent;border:1.5px solid var(--muted)}
@media(prefers-reduced-motion:no-preference){.sync[data-state=busy] i{animation:tbpulse 1s ease-in-out infinite}}
@keyframes tbpulse{50%{opacity:.3}}
</style>`);
  const help = document.querySelector('#helpBtn');
  if (help && !document.querySelector('#tbLogout')) {
    help.insertAdjacentHTML('afterend', '<a class="btn sm" id="tbKonto" href="/konto">Konto</a><button class="btn sm" id="tbLogout">Abmelden</button>');
    document.querySelector('#tbLogout').addEventListener('click', async () => {
      if (!(await DB.forget())) return;
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
      location.href = '/login';
    });
  }
})();
