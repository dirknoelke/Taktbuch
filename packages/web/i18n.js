/* ---------- Sprache (Deutsch / Englisch) ----------
   Die App ist auf Deutsch geschrieben. Für Englisch übersetzt ein kleiner Layer die fertig gerenderten
   Texte anhand des Wörterbuchs in packages/web/i18n-en.js. Zahlen, Wochentage und Monate werden direkt im
   Code formatiert. Neue deutsche Texte brauchen einen Eintrag im Wörterbuch, sonst bleiben sie deutsch. */
const WD = [], MON = [], MONL = [];  // gemeinsame Namenslisten, werden beim Sprachwechsel in place getauscht
const I18N = (() => {
  const NAMES = {
    de: { WD: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], MON: ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
      MONL: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] },
    en: { WD: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], MON: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      MONL: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
  };
  const NUM = /[−+-]?\d+(?:[.,:]\d+)*/g;
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  const orig = new WeakMap();           // Textknoten -> deutscher Originaltext
  let lang = 'de', cache = new Map(), observer = null, busy = false;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  const wdRe = () => new RegExp('\\b(' + NAMES.en.WD.join('|') + ') (?=\\d)', 'g');
  const monRe = () => new RegExp('^(' + NAMES.en.MONL.concat(NAMES.en.MON).join('|') + ')(?=[: ])');

  const decFix = t => (/^\d+,\d{1,2}$/.test(t) ? t.replace(',', '.') : t);   // 6,5 -> 6.5 (aber 1,490 bleibt)
  function lookup(s) {
    const EN = window.ZW_EN || {};
    if (EN[s] != null) return EN[s];
    const nums = [], wds = [], mons = [];
    let n = s.replace(/(−?)€(\d)/g, '€$1$2').replace(wdRe(), (m, w) => { wds.push(w); return '<WD> '; });
    n = n.replace(monRe(), m => { mons.push(m); return '<MON>'; });
    n = n.replace(NUM, m => { nums.push(m); return '#'; }).replace(/€#/g, '# €');
    if (EN[n] == null) return null;
    let i = 0, j = 0, k = 0;
    return EN[n].replace(/<WD>|<MON>|#/g, m => (m === '#' ? (decFix(nums[i++] ?? '#')) : m === '<WD>' ? (wds[j++] ?? '') : (mons[k++] ?? ''))).replace(/€([−+-])/g, '$1€');
  }
  function tx(s) {
    if (lang === 'de' || !s) return s;
    const lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0], core = s.trim();
    if (!core || !/[A-Za-zÄÖÜäöüß]{2}/.test(core)) return s;
    if (cache.has(core)) return lead + cache.get(core) + trail;
    let r = lookup(core);
    if (r == null && /[,;]$/.test(core)) { const t = lookup(core.slice(0, -1)); if (t != null) r = t + core.slice(-1); }
    if (r == null) { // in Teile zerlegen: "Do 01.01. · Neujahr", "Datei bereit: x.json"
      const parts = core.split(/( · |: |, | – | \/ )/);
      if (parts.length > 1) {
        let hit = false;
        const out = parts.map((p, i) => { if (i % 2) return p; const t = lookup(p.trim()); if (t != null) { hit = true; return t; } return p; });
        if (hit) r = out.join('');
      }
    }
    if (r == null) r = core;
    if (cache.size < 5000) cache.set(core, r);
    return lead + r + trail;
  }
  function trNode(root) {
    if (lang === 'de' || !root) return;
    const walk = (el) => {
      if (el.nodeType === 3) { const p = el.parentNode; if (p && !SKIP.has(p.nodeName) && !(p.closest && p.closest('[data-nt]'))) { const v = el.nodeValue, t = tx(v); if (t !== v) { if (!orig.has(el)) orig.set(el, v); el.nodeValue = t; } } return; }
      if (el.nodeType !== 1 || SKIP.has(el.nodeName) || el.hasAttribute('data-nt')) return;
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tx(v); if (t !== v) { if (!el.hasAttribute('data-de-' + a)) el.setAttribute('data-de-' + a, v); el.setAttribute(a, t); } } }
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(root);
  }
  function restore() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); } }
    document.querySelectorAll('*').forEach(el => { for (const a of ATTRS) { const k = 'data-de-' + a; if (el.hasAttribute(k)) { el.setAttribute(a, el.getAttribute(k)); el.removeAttribute(k); } } });
  }
  function guard(fn) { busy = true; try { fn(); } finally { busy = false; } }
  function start() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(muts => {
      if (busy || lang === 'de') return;
      guard(() => { for (const m of muts) { if (m.type === 'characterData') trNode(m.target); else if (m.type === 'attributes') trNode(m.target); else m.addedNodes.forEach(trNode); } });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function apply() { guard(() => { if (lang === 'de') restore(); else trNode(document.body); }); document.documentElement.lang = lang; }
  function set(l, persist) {
    lang = l === 'en' ? 'en' : 'de'; cache = new Map();
    if (persist) store.set('zeitwerk-lang', lang);
    WD.splice(0, WD.length, ...NAMES[lang].WD); MON.splice(0, MON.length, ...NAMES[lang].MON); MONL.splice(0, MONL.length, ...NAMES[lang].MONL);
  }
  const stored = () => { const l = store.get('zeitwerk-lang'); return l === 'en' || l === 'de' ? l : null; };
  const browserDefault = () => (/^de/i.test((navigator.language || 'de')) ? 'de' : 'en');
  set(stored() || 'de', false);
  return { get lang() { return lang; }, set, tx, apply, start, stored, browserDefault, names: () => NAMES[lang], trNode };
})();
