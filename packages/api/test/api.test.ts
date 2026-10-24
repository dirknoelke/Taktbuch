// Integrationstests gegen eine echte PostgreSQL-Datenbank.
// Aufruf: TEST_DATABASE_URL=postgres://user:pw@host:port/db node --test test/api.test.ts
// Die Datenbank wird dabei geleert (Schema public neu angelegt).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createPool, migrate, type Db } from '../src/db.ts';
import { buildApp } from '../src/server.ts';
import { createInvite } from '../src/auth.ts';
import { base32Decode, hotp, stepAt } from '../src/totp.ts';
import type { Config } from '../src/config.ts';
import type { Mail } from '../src/mail.ts';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'https://test.taktbuch.example';
let db: Db, app: FastifyInstance, cfg: Config;
const outbox: Mail[] = [];

before(async () => {
  if (!url) return;
  db = createPool(url);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const web = mkdtempSync(path.join(tmpdir(), 'tbweb-'));
  writeFileSync(path.join(web, 'taktbuch.html'), '<!doctype html><p>App</p><script>window.x=1</script>');
  writeFileSync(path.join(web, 'login.html'), '<!doctype html><p>Login</p><script>window.y=2</script>');
  cfg = { port: 0, host: '127.0.0.1', databaseUrl: url, publicOrigin: ORIGIN, totpKey: randomBytes(32), secureCookies: true, webDir: web, sessionDays: 30, trustProxy: true, smtpUrl: null, smtp: null, mailFrom: 'Taktbuch <noreply@taktbuch.de>', mailReplyTo: null };
  app = await buildApp(cfg, db, { logger: false, mailer: { send: async m => { outbox.push(m); } } });
});
after(async () => { if (url) { await app.close(); await db.end(); } });

const skip = !url && 'TEST_DATABASE_URL nicht gesetzt';
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: p, payload: body as object, headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.' + (1 + Math.floor(Math.random() * 200)), ...headers } });
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const sc = res.headers['set-cookie'];
  const line = (Array.isArray(sc) ? sc : [sc]).find(s => String(s).startsWith('__Host-session='));
  assert.ok(line, 'Session-Cookie gesetzt');
  assert.match(String(line), /HttpOnly/i); assert.match(String(line), /Secure/i); assert.match(String(line), /SameSite=Strict/i);
  return String(line).split(';')[0];
};
/** Code für den nächsten Zeitschritt: der aktuelle ist nach Benutzung gesperrt (Replay-Schutz). */
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);

async function register(email: string) {
  const { link } = await createInvite(db, cfg, email);
  const invite = new URL(link).hash.split('invite=')[1];
  const r = await post('/api/auth/register', { invite, email, password: 'ein-langes-passwort' });
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json();
  assert.equal(d.next, 'setup'); assert.match(d.qr, /^data:image\/png;base64,/); assert.match(d.otpauth, /^otpauth:\/\/totp\//);
  const c = await post('/api/auth/totp/confirm', { ticket: d.ticket, code: code(d.secret) });
  assert.equal(c.statusCode, 200, c.body);
  return { invite, secret: d.secret as string, recovery: c.json().recoveryCodes as string[], cookie: cookieOf(c) };
}

test('Registrierung, TOTP, Recovery-Codes, Session', { skip }, async () => {
  const u = await register('dirk@example.org');
  assert.equal(u.recovery.length, 10);
  const me = await app.inject({ url: '/api/me', headers: { cookie: u.cookie } });
  assert.equal(me.statusCode, 200); assert.equal(me.json().email, 'dirk@example.org');
  const again = await post('/api/auth/register', { invite: u.invite, email: 'x@example.org', password: 'ein-langes-passwort' });
  assert.equal(again.statusCode, 400, 'Einladung nur einmal verwendbar');
});

test('Login: Passwort + TOTP, Replay, falsches Passwort, Recovery-Code', { skip }, async () => {
  const u = await register('mella@example.org');
  const bad = await post('/api/auth/login', { email: 'mella@example.org', password: 'falsch-falsch-falsch' });
  assert.equal(bad.statusCode, 401);
  const unknown = await post('/api/auth/login', { email: 'niemand@example.org', password: 'egal-egal-egal' });
  assert.equal(unknown.statusCode, 401); assert.equal(unknown.json().message, bad.json().message, 'keine Auskunft, ob es das Konto gibt');

  const l1 = await post('/api/auth/login', { email: 'MELLA@example.org', password: 'ein-langes-passwort' });
  assert.equal(l1.statusCode, 200); assert.equal(l1.json().next, 'mfa');
  const wrong = await post('/api/auth/mfa', { ticket: l1.json().ticket, code: '000000' });
  assert.equal(wrong.statusCode, 401);
  const ok = await post('/api/auth/mfa', { ticket: l1.json().ticket, code: code(u.secret, 1) });
  assert.equal(ok.statusCode, 200, ok.body); cookieOf(ok);

  const l2 = await post('/api/auth/login', { email: 'mella@example.org', password: 'ein-langes-passwort' });
  const replay = await post('/api/auth/mfa', { ticket: l2.json().ticket, code: code(u.secret, 1) });
  assert.equal(replay.statusCode, 401, 'derselbe Code wird nicht zweimal akzeptiert');
  const rec = await post('/api/auth/mfa', { ticket: l2.json().ticket, code: u.recovery[0].toUpperCase() });
  assert.equal(rec.statusCode, 200, rec.body); assert.equal(rec.json().recoveryCodesLeft, 9);

  const l3 = await post('/api/auth/login', { email: 'mella@example.org', password: 'ein-langes-passwort' });
  const reuse = await post('/api/auth/mfa', { ticket: l3.json().ticket, code: u.recovery[0] });
  assert.equal(reuse.statusCode, 401, 'Recovery-Code nur einmal');
});

test('Ticket: höchstens 5 Versuche', { skip }, async () => {
  await register('ticket@example.org');
  const l = await post('/api/auth/login', { email: 'ticket@example.org', password: 'ein-langes-passwort' });
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/mfa', { ticket: l.json().ticket, code: '111111' })).statusCode, 401);
  assert.equal((await post('/api/auth/mfa', { ticket: l.json().ticket, code: '111111' })).statusCode, 429);
});

test('Sperre nach 10 Fehlversuchen pro Konto', { skip }, async () => {
  await register('sperre@example.org');
  for (let i = 0; i < 10; i++) await post('/api/auth/login', { email: 'sperre@example.org', password: 'falsch-falsch-' + i });
  const r = await post('/api/auth/login', { email: 'sperre@example.org', password: 'ein-langes-passwort' });
  assert.equal(r.statusCode, 429);
});

test('Datenablage: Version, Konflikt, Trennung der Mandanten', { skip }, async () => {
  const a = await register('a@example.org'), b = await register('b@example.org');
  const get = (cookie: string) => app.inject({ url: '/api/kv/state', headers: { cookie } });
  const put = (cookie: string, value: unknown, version: number | null) =>
    app.inject({ method: 'PUT', url: '/api/kv/state', payload: { value, version }, headers: { cookie, origin: ORIGIN } });

  assert.equal((await get(a.cookie)).statusCode, 404);
  const p1 = await put(a.cookie, '{"v":1,"days":{}}', null);
  assert.equal(p1.statusCode, 200, p1.body); assert.equal(p1.json().version, 1);
  assert.deepEqual((await get(a.cookie)).json(), { value: '{"v":1,"days":{}}', version: 1 });
  assert.equal((await put(a.cookie, 'zweites Gerät', null)).statusCode, 409, 'Neuanlage trotz vorhandener Daten');
  assert.equal((await put(a.cookie, 'neu', 1)).json().version, 2);
  assert.equal((await put(a.cookie, 'veraltet', 1)).statusCode, 409, 'veraltete Version wird abgewiesen');
  assert.equal((await get(b.cookie)).statusCode, 404, 'B sieht die Daten von A nicht');
  assert.equal((await put(b.cookie, 'B', null)).statusCode, 200);
  assert.equal((await get(a.cookie)).json().value, 'neu');
  assert.equal((await app.inject({ url: '/api/kv/state' })).statusCode, 401, 'ohne Session');
  assert.equal((await app.inject({ url: '/api/kv/..%2Fx', headers: { cookie: a.cookie } })).statusCode, 400, 'Schlüssel geprüft');
});

test('Schutz: Origin-Prüfung, Logout, Web-Seiten mit CSP', { skip }, async () => {
  const u = await register('web@example.org');
  const evil = await app.inject({ method: 'PUT', url: '/api/kv/state', payload: { value: 1, version: null }, headers: { cookie: u.cookie, origin: 'https://boese.example' } });
  assert.equal(evil.statusCode, 403);
  const noOrigin = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: u.cookie } });
  assert.equal(noOrigin.statusCode, 403);

  const anon = await app.inject({ url: '/' });
  assert.equal(anon.statusCode, 302); assert.equal(anon.headers.location, '/login');
  const login = await app.inject({ url: '/login' });
  assert.equal(login.statusCode, 200); assert.match(String(login.headers['content-security-policy']), /script-src 'sha256-/);
  assert.equal(login.headers['x-frame-options'], 'DENY');
  const page = await app.inject({ url: '/', headers: { cookie: u.cookie } });
  assert.equal(page.statusCode, 200); assert.match(page.body, /App/);
  assert.equal((await app.inject({ url: '/login', headers: { cookie: u.cookie } })).statusCode, 302, 'angemeldet: weiter zur App');

  const out = await post('/api/auth/logout', {}, { cookie: u.cookie });
  assert.equal(out.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: u.cookie } })).statusCode, 401, 'Session nach Logout ungültig');
});

test('Health-Endpunkte', { skip }, async () => {
  assert.equal((await app.inject({ url: '/healthz' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/readyz' })).statusCode, 200);
});

const linkFrom = (m: Mail, key: string) => {
  const u = m.text.match(new RegExp(`${ORIGIN}/login#${key}=([A-Za-z0-9_-]+)`));
  assert.ok(u, 'Link in der Mail'); return u![1];
};

test('Einladung per Mail', { skip }, async () => {
  const n = outbox.length;
  const r = await createInvite(db, cfg, 'Neu@Example.org', 7, { send: async m => { outbox.push(m); } });
  assert.equal(r.mailed, true); assert.equal(outbox.length, n + 1);
  assert.equal(outbox.at(-1)!.to, 'neu@example.org');
  assert.equal(linkFrom(outbox.at(-1)!, 'invite'), new URL(r.link).hash.split('invite=')[1]);
  const broken = await createInvite(db, cfg, 'x@example.org', 7, { send: async () => { throw new Error('SMTP weg'); } });
  assert.equal(broken.mailed, false); assert.equal(broken.mailError, 'SMTP weg'); assert.ok(broken.link, 'Link trotzdem da');
});

test('Passwort vergessen: Mail, zweiter Faktor Pflicht, alte Sessions ungültig', { skip }, async () => {
  const u = await register('vergessen@example.org');
  const unknown = await post('/api/auth/forgot', { email: 'gibtsnicht@example.org' });
  const n = outbox.length;
  const known = await post('/api/auth/forgot', { email: 'Vergessen@example.org' });
  assert.equal(known.statusCode, 200); assert.equal(known.json().message, unknown.json().message, 'keine Auskunft, ob es das Konto gibt');
  assert.equal(outbox.length, n + 1); assert.equal(outbox.at(-1)!.subject, 'Neues Passwort für Taktbuch');
  const tok = linkFrom(outbox.at(-1)!, 'reset');

  const noCode = await post('/api/auth/reset', { token: tok, password: 'ganz-neues-passwort' });
  assert.equal(noCode.statusCode, 401, 'ohne zweiten Faktor kein neues Passwort');
  const short = await post('/api/auth/reset', { token: tok, password: 'kurz', code: code(u.secret, 1) });
  assert.equal(short.statusCode, 400);
  const ok = await post('/api/auth/reset', { token: tok, password: 'ganz-neues-passwort', code: code(u.secret, 1) });
  assert.equal(ok.statusCode, 200, ok.body); cookieOf(ok);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: u.cookie } })).statusCode, 401, 'alte Session abgemeldet');
  assert.equal((await post('/api/auth/reset', { token: tok, password: 'noch-ein-passwort', code: u.recovery[1] })).statusCode, 400, 'Link nur einmal');
  assert.equal((await post('/api/auth/login', { email: 'vergessen@example.org', password: 'ein-langes-passwort' })).statusCode, 401, 'altes Passwort ungültig');
  assert.equal((await post('/api/auth/login', { email: 'vergessen@example.org', password: 'ganz-neues-passwort' })).json().next, 'mfa');
});

test('Passwort vergessen: Recovery-Code, Versuchsgrenze, Mail-Limit', { skip }, async () => {
  const u = await register('limit@example.org');
  const n = outbox.length;
  for (let i = 0; i < 4; i++) await post('/api/auth/forgot', { email: 'limit@example.org' });
  assert.equal(outbox.length, n + 3, 'höchstens 3 Mails pro Stunde');
  const tok = linkFrom(outbox.at(-1)!, 'reset');
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/reset', { token: tok, password: 'ganz-neues-passwort', code: '123456' })).statusCode, 401);
  assert.equal((await post('/api/auth/reset', { token: tok, password: 'ganz-neues-passwort', code: u.recovery[0] })).statusCode, 429, 'Link nach 5 Fehlversuchen gesperrt');
  const tok2 = linkFrom(outbox.at(-2)!, 'reset');
  assert.equal((await post('/api/auth/reset', { token: tok2, password: 'ganz-neues-passwort', code: u.recovery[0] })).statusCode, 200, 'Recovery-Code als zweiter Faktor');
});

test('Ohne Mailversand: Passwort vergessen meldet 503, Konfiguration sagt mail=false', { skip }, async () => {
  const bare = await buildApp(cfg, db, { logger: false, mailer: null });
  try {
    assert.deepEqual((await bare.inject({ url: '/api/config' })).json(), { mail: false });
    const r = await bare.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: 'a@example.org' }, headers: { origin: ORIGIN } });
    assert.equal(r.statusCode, 503);
  } finally { await bare.close(); }
  assert.deepEqual((await app.inject({ url: '/api/config' })).json(), { mail: true });
});
