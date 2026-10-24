// Verwaltung: nur für Admin-Konten, und nur mit frischem Nachweis des zweiten Faktors (15 Minuten).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { tx, type Db } from './db.ts';
import { audit } from './audit.ts';
import { readSession, type SessionUser } from './session.ts';
import { createInvite, EMAIL_RE, fail, normEmail } from './auth.ts';
import { mfaResetMail, type Mailer } from './mail.ts';

export const STEPUP_MINUTES = 15;
const UUID = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;

export function adminRoutes(app: FastifyInstance, db: Db, cfg: Config, mailer: Mailer | null) {
  /** Admin-Session mit frischem zweiten Faktor, sonst 401/403. stepup:true sagt der Oberfläche, dass sie den Code abfragen soll. */
  const admin = async (req: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> => {
    const s = await readSession(db, cfg, req);
    if (!s) { reply.code(401).send({ message: 'Nicht angemeldet' }); return null; }
    if (s.kind !== 'admin') { reply.code(403).send({ message: 'Nur für die Verwaltung.' }); return null; }
    if (Date.now() - s.mfaAt.getTime() > STEPUP_MINUTES * 60_000) {
      reply.code(403).send({ message: 'Bitte den Code aus der Authenticator-App eingeben.', stepup: true }); return null;
    }
    return s;
  };

  app.get('/api/admin/overview', async (req, reply) => {
    const s = await admin(req, reply); if (!s) return reply;
    const [invites, users] = await Promise.all([
      db.query(`SELECT id, email, kind, created_at, expires_at, used_at, revoked_at,
                       CASE WHEN revoked_at IS NOT NULL THEN 'zurückgezogen' WHEN used_at IS NOT NULL THEN 'angenommen'
                            WHEN expires_at < now() THEN 'abgelaufen' ELSE 'offen' END AS status
                  FROM invites ORDER BY created_at DESC LIMIT 50`),
      db.query(`SELECT u.id, u.email, u.kind, u.created_at, u.last_login_at, u.mfa_enabled, u.locked_at,
                       (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
                  FROM users u ORDER BY u.kind DESC, u.email`),
    ]);
    return { me: s.userId, stepupUntil: new Date(s.mfaAt.getTime() + STEPUP_MINUTES * 60_000), invites: invites.rows, users: users.rows };
  });

  app.get('/api/admin/audit', async (req: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
    const s = await admin(req, reply); if (!s) return reply;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    const r = await db.query(`SELECT at, email, event, ok, host(ip) AS ip, user_agent, target FROM audit_log ORDER BY at DESC LIMIT $1`, [limit]);
    return { entries: r.rows };
  });

  app.post('/api/admin/invites', async (req: FastifyRequest<{ Body: { email?: string; days?: number; kind?: string } }>, reply) => {
    const s = await admin(req, reply); if (!s) return reply;
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    const days = Math.min(Math.max(Number(req.body?.days ?? 7) || 7, 1), 30);
    const kind = req.body?.kind === 'admin' ? 'admin' : 'user';
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) fail(409, 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
    return createInvite(db, cfg, email, days, mailer, { kind, createdBy: s.userId });
  });

  app.post('/api/admin/invites/:id/revoke', { schema: { params: UUID } }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const s = await admin(req, reply); if (!s) return reply;
    const r = await db.query<{ email: string | null }>(
      'UPDATE invites SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING email', [req.params.id]);
    if (!r.rowCount) fail(404, 'Keine offene Einladung gefunden.');
    await audit(db, req, { event: 'invite_revoked', ok: true, userId: s.userId, email: s.email, target: r.rows[0].email });
    return { ok: true };
  });

  /** Aktion auf einen Nutzer; nie auf das eigene Konto (sonst sperrt man sich selbst aus). */
  const onUser = (path: string, event: Parameters<typeof audit>[2]['event'], fn: (c: Parameters<Parameters<typeof tx>[1]>[0], userId: string) => Promise<void>, after?: (email: string) => Promise<void>) =>
    app.post(`/api/admin/users/:id/${path}`, { schema: { params: UUID } }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const s = await admin(req, reply); if (!s) return reply;
      if (req.params.id === s.userId) fail(400, 'Das eigene Konto lässt sich hier nicht ändern.');
      const email = await tx(db, async c => {
        const u = await c.query<{ email: string }>('SELECT email FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!u.rows[0]) fail(404, 'Nutzer nicht gefunden.');
        await fn(c, req.params.id);
        await audit(c, req, { event, ok: true, userId: s.userId, email: s.email, target: u.rows[0].email });
        return u.rows[0].email;
      });
      if (after) await after(email);
      return { ok: true };
    });

  onUser('lock', 'user_locked', async (c, id) => {
    await c.query('UPDATE users SET locked_at = now() WHERE id = $1', [id]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  });
  onUser('unlock', 'user_unlocked', async (c, id) => { await c.query('UPDATE users SET locked_at = NULL WHERE id = $1', [id]); });
  onUser('logout', 'user_sessions_revoked', async (c, id) => { await c.query('DELETE FROM sessions WHERE user_id = $1', [id]); });
  onUser('reset-mfa', 'user_mfa_reset', async (c, id) => {
    // Nutzer richtet beim nächsten Login (mit Passwort) einen neuen Authenticator ein und bekommt neue Recovery-Codes.
    await c.query('UPDATE users SET mfa_enabled = false WHERE id = $1', [id]);
    await c.query('DELETE FROM totp_secrets WHERE user_id = $1', [id]);
    await c.query('DELETE FROM recovery_codes WHERE user_id = $1', [id]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await c.query('DELETE FROM login_tickets WHERE user_id = $1', [id]);
    await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [id]);
  }, async email => {
    if (mailer) await mailer.send(mfaResetMail(email, `${cfg.publicOrigin}/login`)).catch(e => app.log.error(e, 'Mail zum Zurücksetzen nicht verschickt'));
  });
}
