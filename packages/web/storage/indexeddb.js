/* ---------- Speicher-Adapter: IndexedDB (Offline-Build) ----------
   Unverändert aus 1-kern.js übernommen. Datenbanknamen je Profil (PROFILES[..].db) und
   Object-Store "kv" bleiben gleich, damit bestehende Daten weiter gefunden werden.
   Fallback bei Fehlern: get -> undefined, set -> false (App zeigt dann "nur Sitzung"). */
const DB = {
  open() { return new Promise((res, rej) => { try { const q = indexedDB.open(PROFILES[PROFILE].db, 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); } catch (e) { rej(e); } }); },
  async get(k) { try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } catch (e) { return undefined; } },
  async set(k, v) { try { const db = await this.open(); return await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => rej(t.error); }); } catch (e) { return false; } }
};
