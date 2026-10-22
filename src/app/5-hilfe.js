/* ---------- Hilfe und "Was ist neu" ---------- */
const HELP = window.ZW_HELP || {}, WHATS = window.ZW_WHATS || {};
const mdLite = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const helpLang = () => (HELP[I18N.lang] ? I18N.lang : 'de');
const whatsList = (vers, l) => vers.map(v => `<h4 class="sh">${esc(l === 'en' ? 'Version ' : 'Version ')}${esc(v)}</h4><ul>${((WHATS[v] || {})[l] || (WHATS[v] || {}).de || []).map(x => `<li>${mdLite(x)}</li>`).join('')}</ul>`).join('');
const whatsVersions = () => Object.keys(WHATS).sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
function viewHilfe() {
  const l = helpLang(), H = HELP[l] || { title: '', intro: '', sections: [] };
  return `<div class="nav"><h2 data-nt>${esc(H.title)}</h2><button class="btn" data-a="helpBack">Zurück</button></div>
  <section class="card" data-nt><p class="hint" style="margin:0 0 12px">${mdLite(H.intro)}</p>
  ${H.sections.map((s, i) => `<details class="help"${i === 0 ? ' open' : ''}><summary>${esc(s.h)}</summary>${(s.p || []).map(x => `<p>${mdLite(x)}</p>`).join('')}${s.li ? `<ul>${s.li.map(x => `<li>${mdLite(x)}</li>`).join('')}</ul>` : ''}</details>`).join('')}
  <details class="help"><summary>${l === 'en' ? "What's new" : 'Was ist neu'}</summary>${whatsList(whatsVersions(), l)}</details></section>`;
}
Object.assign(actions, {
  help: () => { if (UI.tab !== 'hilfe') UI.prevTab = UI.tab; UI.tab = 'hilfe'; render(); window.scrollTo(0, 0); },
  helpBack: () => { UI.tab = UI.prevTab && UI.prevTab !== 'hilfe' ? UI.prevTab : 'heute'; render(); window.scrollTo(0, 0); },
  whatsOk: () => { ls.set('zeitwerk-seen-ver', VERSION); $('#newbanner').innerHTML = ''; },
  whatsAll: () => { ls.set('zeitwerk-seen-ver', VERSION); $('#newbanner').innerHTML = ''; actions.help(); },
});
/* Nach einem Update einmal zeigen, was neu ist. Erster Start (keine Daten): still merken. */
function showWhatsNew(hadData) {
  const el = $('#newbanner'); if (!el) return;
  let seen = ls.get('zeitwerk-seen-ver');
  if (!seen) { if (!hadData) { ls.set('zeitwerk-seen-ver', VERSION); return; } seen = '1.10.0'; }
  if (!isNewer(VERSION, seen)) { if (seen !== VERSION) ls.set('zeitwerk-seen-ver', VERSION); return; }
  const vers = whatsVersions().filter(v => isNewer(v, seen) && !isNewer(v, VERSION)); if (!vers.length) { ls.set('zeitwerk-seen-ver', VERSION); return; }
  const l = helpLang();
  el.innerHTML = `<div class="banner col"><b>${l === 'en' ? 'New in Taktbuch ' : 'Neu in Taktbuch '}${esc(VERSION)}</b>${whatsList(vers.slice(0, 6), l).replace(/<h4 class="sh">Version [^<]*<\/h4>/g, m => (vers.length > 1 ? m : ''))}
    <div class="nav"><button class="btn primary sm" data-a="whatsOk">Verstanden</button><button class="btn sm" data-a="whatsAll">Alles in der Hilfe ansehen</button></div></div>`;
}
