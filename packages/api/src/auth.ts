// Anmeldung: Einladung -> Konto -> TOTP-Einrichtung -> Recovery-Codes; danach Passwort + TOTP.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import argon2 from '@node-rs/argon2';   // CommonJS-Paket: Default-Import, dann entpacken
import QRCode from 'qrcode';
import type { Config } from './config.ts';
import { tx, type Db, type Tx } from './db.ts';
import { audit, tooManyFailures } from './audit.ts';
import { createSession, destroySession, readSession } from './session.ts';
import { decrypt, encrypt, normalizeRecovery, recoveryCode, sha256, token } from './secrets.ts';
import { base32Encode, newSecret, otpauthUri, verify as verifyTotp } from './totp.ts';
import { inviteMail, resetMail, type Mailer } from './mail.ts';

const { hash: argonHash, verify: argonVerify } = argon2;

// OWASP-Empfehlung für Argon2id: 19 MiB, 2 Durchläufe, Parallelität 1
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKET_MINUTES = { mfa: 5, setup: 15 } as const;
const MAX_TICKET_ATTEMPTS = 5;
const RESET_MINUTES = 30;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();

export function authRoutes(app: FastifyInstance, db: Db, cfg: Config, mailer: Mailer | null) {
  const dummyHash = argonHash('timing-ausgleich-' + token(8), ARGON);   // gleiche Laufzeit, auch wenn es die E-Mail nicht gibt
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.setErrorHandler((e: Error & { status?: number; statusCode?: number }, _req, reply) => {
    if (e instanceof HttpError) return reply.code(e.status).send({ message: e.message });
    if (e.statusCode === 429) return reply.code(429).send({ message: 'Zu viele Versuche. Bitte kurz warten.' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ message: e.message });
    app.log.error(e);
    return reply.code(500).send({ message: 'Interner Fehler' });
  });

  async function newTicket(c: Tx, userId: string, purpose: 'mfa' | 'setup') {
    const t = token();
    await c.query('DELETE FROM login_tickets WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
    await c.query(`INSERT INTO login_tickets (id_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [sha256(t), userId, purpose, TICKET_MINUTES[purpose]]);
    return t;
  }

  /** Ticket prüfen und Versuch zählen. Liefert Nutzer + verschlüsseltes TOTP-Secret. */
  async function takeTicket(c: Tx, t: unknown, purpose: 'mfa' | 'setup') {
    if (typeof t !== 'string' || !t) fail(400, 'Anmeldung abgelaufen. Bitte neu anmelden.');
    const r = await c.query<{ user_id: string; email: string; attempts: number; secret_enc: Buffer; last_step: string }>(
      `UPDATE login_tickets lt SET attempts = attempts + 1
         FROM users u, totp_secrets ts
        WHERE lt.id_hash = $1 AND lt.purpose = $2 AND lt.expires_at > now()
          AND u.id = lt.user_id AND ts.user_id = lt.user_id
        RETURNING lt.user_id, u.email, lt.attempts, ts.secret_enc, ts.last_step`,
      [sha256(t as string), purpose]
    );
    const row = r.rows[0];
    if (!row) fail(401, 'Anmeldung abgelaufen. Bitte neu anmelden.');
    if (row.attempts > MAX_TICKET_ATTEMPTS) fail(429, 'Zu viele Fehlversuche. Bitte neu anmelden.');
    return { ...row, ticketHash: sha256(t as string) };
  }

  async function setupPayload(c: Tx, userId: string, email: string) {
    const secret = newSecret();
    await c.query(
      `INSERT INTO totp_secrets (user_id, secret_enc) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, confirmed_at = NULL, last_step = 0`,
      [userId, encrypt(cfg.totpKey, secret)]
    );
    const uri = otpauthUri(secret, email);
    return { next: 'setup', ticket: await newTicket(c, userId, 'setup'), otpauth: uri, secret: base32Encode(secret), qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  // 1) Registrierung mit Einladungslink
  app.post('/api/auth/register', limited, async (req: FastifyRequest<{ Body: { invite?: string; email?: string; password?: string } }>) => {
    const b = req.body ?? {};
    const email = normEmail(b.email), password = String(b.password ?? '');
    if (!EMAIL_RE.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    if (password.length < 12 || password.length > 256) fail(400, 'Das Passwort muss mindestens 12 Zeichen haben.');
    if (!b.invite) fail(400, 'Einladung fehlt.');
    const pwHash = await argonHash(password, ARGON);
    return tx(db, async c => {
      const inv = await c.query<{ email: string | null }>(
        `SELECT email FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(b.invite!)]);
      if (!inv.rows[0]) fail(400, 'Die Einladung ist ungültig oder abgelaufen.');
      if (inv.rows[0].email && inv.rows[0].email !== email) fail(400, 'Diese Einladung gilt für eine andere E-Mail-Adresse.');
      const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (exists.rowCount) fail(409, 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
      const u = await c.query<{ id: string }>('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, pwHash]);
      const userId = u.rows[0].id;
      const o = await c.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [email]);
      await c.query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')`, [userId, o.rows[0].id]);
      await c.query('UPDATE invites SET used_at = now(), used_by = $2 WHERE token_hash = $1', [sha256(b.invite!), userId]);
      await audit(c, req, { event: 'register', ok: true, userId, email });
      return setupPayload(c, userId, email);
    });
  });

  // 2) Passwort prüfen -> Ticket für den zweiten Faktor (oder Einrichtung, falls noch nicht abgeschlossen)
  app.post('/api/auth/login', limited, async (req: FastifyRequest<{ Body: { email?: string; password?: string } }>) => {
    const email = normEmail(req.body?.email), password = String(req.body?.password ?? '');
    if (await tooManyFailures(db, email)) fail(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    const r = await db.query<{ id: string; password_hash: string; mfa_enabled: boolean }>('SELECT id, password_hash, mfa_enabled FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    const ok = await argonVerify(user?.password_hash ?? await dummyHash, password.slice(0, 256)).catch(() => false);
    if (!user || !ok) {
      await audit(db, req, { event: 'login_password', ok: false, userId: user?.id, email });
      fail(401, 'E-Mail oder Passwort falsch.');
    }
    await audit(db, req, { event: 'login_password', ok: true, userId: user!.id, email });
    return tx(db, async c => user!.mfa_enabled
      ? { next: 'mfa', ticket: await newTicket(c, user!.id, 'mfa') }
      : setupPayload(c, user!.id, email));
  });

  // 3) TOTP-Einrichtung bestätigen -> Recovery-Codes + Session
  // Fehlversuche werden festgeschrieben (Zähler, Audit), erst danach wird der Fehler gemeldet.
  app.post('/api/auth/totp/confirm', limited, async (req: FastifyRequest<{ Body: { ticket?: string; code?: string } }>, reply: FastifyReply) => {
    const res = await tx(db, async c => {
      const t = await takeTicket(c, req.body?.ticket, 'setup');
      const step = verifyTotp(decrypt(cfg.totpKey, t.secret_enc), String(req.body?.code ?? ''), Number(t.last_step));
      if (step === null) {
        await audit(c, req, { event: 'totp_setup', ok: false, userId: t.user_id, email: t.email });
        return null;
      }
      await c.query('UPDATE totp_secrets SET confirmed_at = now(), last_step = $2 WHERE user_id = $1', [t.user_id, step]);
      await c.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [t.user_id]);
      await c.query('DELETE FROM recovery_codes WHERE user_id = $1', [t.user_id]);
      const codes = Array.from({ length: 10 }, recoveryCode);
      for (const code of codes) await c.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [t.user_id, sha256(normalizeRecovery(code))]);
      await c.query('DELETE FROM login_tickets WHERE id_hash = $1', [t.ticketHash]);
      await audit(c, req, { event: 'totp_setup', ok: true, userId: t.user_id, email: t.email });
      await createSession(c, cfg, req, reply, t.user_id);
      return { recoveryCodes: codes };
    });
    return res ?? fail(401, 'Der Code stimmt nicht. Uhrzeit am Handy prüfen und den aktuellen Code eingeben.');
  });

  // 4) Zweiter Faktor beim Login: TOTP-Code oder Recovery-Code
  app.post('/api/auth/mfa', limited, async (req: FastifyRequest<{ Body: { ticket?: string; code?: string } }>, reply: FastifyReply) => {
    const res = await tx(db, async c => {
      const t = await takeTicket(c, req.body?.ticket, 'mfa');
      const code = String(req.body?.code ?? '').trim();
      if (/^\d[\d ]{5,6}$/.test(code)) {
        const step = verifyTotp(decrypt(cfg.totpKey, t.secret_enc), code, Number(t.last_step));
        await audit(c, req, { event: 'login_mfa', ok: step !== null, userId: t.user_id, email: t.email });
        if (step === null) return null;
        await c.query('UPDATE totp_secrets SET last_step = $2 WHERE user_id = $1', [t.user_id, step]);
      } else {
        const used = await c.query(
          `UPDATE recovery_codes SET used_at = now() WHERE id = (
             SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1) RETURNING id`,
          [t.user_id, sha256(normalizeRecovery(code))]);
        await audit(c, req, { event: 'login_recovery', ok: !!used.rowCount, userId: t.user_id, email: t.email });
        if (!used.rowCount) return null;
      }
      await c.query('DELETE FROM login_tickets WHERE id_hash = $1', [t.ticketHash]);
      await createSession(c, cfg, req, reply, t.user_id);
      const left = await c.query<{ n: string }>('SELECT count(*) AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [t.user_id]);
      return { ok: true, recoveryCodesLeft: Number(left.rows[0].n) };
    });
    return res ?? fail(401, 'Der Code stimmt nicht.');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    await destroySession(db, cfg, req, reply);
    if (s) await audit(db, req, { event: 'logout', ok: true, userId: s.userId, email: s.email });
    return { ok: true };
  });

  // 5) Passwort vergessen: Link per Mail. Antwort immer gleich, egal ob es das Konto gibt.
  app.post('/api/auth/forgot', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: FastifyRequest<{ Body: { email?: string } }>) => {
    if (!mailer) fail(503, 'Mailversand ist auf diesem Server nicht eingerichtet. Bitte an den Betreiber wenden.');
    const email = normEmail(req.body?.email);
    const u = await db.query<{ id: string; recent: string }>(
      `SELECT u.id, (SELECT count(*) FROM password_resets r WHERE r.user_id = u.id AND r.created_at > now() - interval '1 hour') AS recent
         FROM users u WHERE u.email = $1 AND u.mfa_enabled`, [email]);
    const user = u.rows[0];
    if (user && Number(user.recent) < 3) {   // höchstens 3 Mails pro Stunde und Konto
      const t = token();
      await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`, [sha256(t), user.id, RESET_MINUTES]);
      try { await mailer!.send(resetMail(email, `${cfg.publicOrigin}/login#reset=${t}`, RESET_MINUTES)); }
      catch (e) { app.log.error(e, 'Mailversand fehlgeschlagen'); fail(502, 'Die Mail konnte gerade nicht verschickt werden. Bitte später erneut versuchen.'); }
    }
    await audit(db, req, { event: 'password_reset_request', ok: !!user, userId: user?.id, email });
    return { ok: true, message: 'Wenn es ein Konto mit dieser Adresse gibt, ist jetzt eine Mail mit einem Link unterwegs.' };
  });

  // 6) Neues Passwort setzen: Link aus der Mail + zweiter Faktor (TOTP oder Recovery-Code).
  // Danach sind alle bisherigen Sessions ungültig. Fehlversuche werden festgeschrieben.
  app.post('/api/auth/reset', limited, async (req: FastifyRequest<{ Body: { token?: string; password?: string; code?: string } }>, reply: FastifyReply) => {
    const b = req.body ?? {}, password = String(b.password ?? ''), code = String(b.code ?? '').trim();
    if (typeof b.token !== 'string' || !b.token) fail(400, 'Der Link ist unvollständig.');
    if (password.length < 12 || password.length > 256) fail(400, 'Das Passwort muss mindestens 12 Zeichen haben.');
    const pwHash = await argonHash(password, ARGON);
    const res = await tx(db, async c => {
      const r = await c.query<{ user_id: string; email: string; attempts: number; secret_enc: Buffer; last_step: string }>(
        `UPDATE password_resets pr SET attempts = attempts + 1
           FROM users u, totp_secrets ts
          WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()
            AND u.id = pr.user_id AND ts.user_id = pr.user_id
          RETURNING pr.user_id, u.email, pr.attempts, ts.secret_enc, ts.last_step`, [sha256(b.token!)]);
      const row = r.rows[0];
      if (!row) fail(400, 'Der Link ist ungültig oder abgelaufen. Bitte einen neuen anfordern.');
      if (row.attempts > MAX_TICKET_ATTEMPTS) fail(429, 'Zu viele Fehlversuche. Bitte einen neuen Link anfordern.');
      let ok = false;
      if (/^\d[\d ]{5,6}$/.test(code)) {
        const step = verifyTotp(decrypt(cfg.totpKey, row.secret_enc), code, Number(row.last_step));
        if (step !== null) { ok = true; await c.query('UPDATE totp_secrets SET last_step = $2 WHERE user_id = $1', [row.user_id, step]); }
      } else if (code) {
        const used = await c.query(`UPDATE recovery_codes SET used_at = now() WHERE id = (
            SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1) RETURNING id`,
          [row.user_id, sha256(normalizeRecovery(code))]);
        ok = !!used.rowCount;
      }
      await audit(c, req, { event: 'password_reset', ok, userId: row.user_id, email: row.email });
      if (!ok) return null;
      await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, pwHash]);
      await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
      await c.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
      await c.query('DELETE FROM login_tickets WHERE user_id = $1', [row.user_id]);
      await createSession(c, cfg, req, reply, row.user_id);
      return { ok: true };
    });
    return res ?? fail(401, 'Der Code stimmt nicht.');
  });

  app.get('/api/me', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    if (!s) return reply.code(401).send({ message: 'Nicht angemeldet' });
    return { email: s.email, role: s.role };
  });
}

/** Einladung anlegen (CLI). Verschickt sie per Mail, falls ein Mailer da ist; gibt den Link immer zurück.
 *  Das Token steht nur im Fragment (#), dadurch nie in Server- oder Proxy-Logs. */
export async function createInvite(db: Db, cfg: Pick<Config, 'publicOrigin'>, email: string | null, days = 7, mailer: Mailer | null = null) {
  const t = token();
  await db.query(`INSERT INTO invites (token_hash, email, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(t), email ? normEmail(email) : null, days]);
  await audit(db, null, { event: 'invite_created', ok: true, email });
  const link = `${cfg.publicOrigin}/login#invite=${t}`;
  let mailed = false, mailError: string | null = null;
  if (mailer && email) {
    try { await mailer.send(inviteMail(normEmail(email), link, days)); mailed = true; }
    catch (e) { mailError = (e as Error).message; }   // Einladung bleibt gültig, Link wird angezeigt
  }
  return { link, mailed, mailError };
}
