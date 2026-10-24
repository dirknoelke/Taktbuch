/* ---------- Speicher-Adapter: Server-API (Online-Build) ----------
   Gleicher Vertrag wie indexeddb.js: async get(k) -> Wert | undefined, async set(k, v) -> true | false.
   Unterschiede, die online nötig sind:
   - Nicht angemeldet (401): weiter zur Anmeldeseite.
   - Laden schlägt fehl (Netz, Server): App hält mit Fehlermeldung an, statt leer oder mit
     Beispieldaten zu starten, die beim nächsten Speichern die Serverdaten überschreiben würden.
   - Optimistische Sperre: Jeder Schlüssel hat eine Version. Hat ein anderes Gerät inzwischen
     gespeichert (409), wird nicht überschrieben, sondern zum Neuladen aufgefordert. */
const DB = (() => {
  const versions = {};
  let conflictShown = false;
  const url = k => '/api/kv/' + encodeURIComponent(k);
  const toLogin = () => { location.href = '/login'; return new Promise(() => { }); };
  const halt = msg => {
    const v = document.querySelector('#view');
    if (v) v.innerHTML = '<section class="card" style="max-width:640px;margin:40px auto"><h3>Daten konnten nicht geladen werden</h3><p class="hint">' + msg + '</p><p><button class="btn primary" id="tbRetry">Erneut versuchen</button></p></section>';
    const b = document.querySelector('#tbRetry'); if (b) b.addEventListener('click', () => location.reload());
    return new Promise(() => { });   // Start bewusst nicht fortsetzen
  };
  const conflict = () => {
    if (conflictShown) return; conflictShown = true;
    const b = document.querySelector('#banner');
    if (b) b.innerHTML = '<div class="banner"><b>Auf einem anderen Gerät wurde inzwischen gespeichert.</b> Deine letzte Änderung hier wurde nicht übernommen. <button class="btn sm primary" id="tbReload">Neu laden</button></div>';
    const r = document.querySelector('#tbReload'); if (r) r.addEventListener('click', () => location.reload());
  };
  return {
    async get(k) {
      let r;
      try { r = await fetch(url(k), { credentials: 'same-origin', cache: 'no-store' }); }
      catch (e) { return halt('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.'); }
      if (r.status === 401) return toLogin();
      if (r.status === 404) { versions[k] = null; return undefined; }
      if (!r.ok) return halt('Der Server hat mit Fehler ' + r.status + ' geantwortet.');
      const body = await r.json();
      versions[k] = body.version;
      return body.value;
    },
    async set(k, v) {
      if (conflictShown) return false;
      try {
        const r = await fetch(url(k), {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: v === undefined ? null : v, version: versions[k] ?? null })
        });
        if (r.status === 401) { toLogin(); return false; }
        if (r.status === 409) { conflict(); return false; }
        if (!r.ok) return false;
        versions[k] = (await r.json()).version;
        return true;
      } catch (e) { return false; }
    }
  };
})();

/* Online-Kennzeichnung und Abmelden in der Kopfzeile */
(() => {
  const ver = document.querySelector('#ver'); if (ver) ver.textContent = 'online';
  const help = document.querySelector('#helpBtn');
  if (help && !document.querySelector('#tbLogout')) {
    help.insertAdjacentHTML('afterend', '<a class="btn sm" id="tbKonto" href="/konto">Konto</a><button class="btn sm" id="tbLogout">Abmelden</button>');
    document.querySelector('#tbLogout').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
      location.href = '/login';
    });
  }
})();
