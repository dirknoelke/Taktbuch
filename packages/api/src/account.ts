// Selbstverwaltung für Nutzer: Passwort, Recovery-Codes, Geräte, Export, Konto löschen.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { tx, withOrg, type Db } from './db.ts';
import { audit } from './audit.ts';
import { destroySession, readSession, type SessionUser } from './session.ts';
import { argonHash, argonVerify, ARGON, fail } from './auth.ts';
import { checkSecondFactor } from './factor.ts';
import { normalizeRecovery, recoveryCode, sha256 } from './secrets.ts';
import { accountDeletedMail, type Mailer } from './mail.ts';

const UUID = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export function accountRoutes(app: FastifyInstance, db: Db, cfg: Config, mailer: Mailer | null) {
  const user = async (req: FastifyRequest, reply: FastifyReply): Promise<(SessionUser & { orgId: string }) | null> => {
    const s = await readSession(db, cfg, req);
    if (!s) { reply.code(401).send({ message: 'Nicht angemeldet' }); return null; }
    if (s.kind !== 'user' || !s.orgId) { reply.code(403).send({ message: 'Nur für Nutzerkonten.' }); return null; }
    return s as SessionUser & { orgId: string };
  };

  app.get('/api/account', async (req, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    const [u, sessions, codes] = await Promise.all([
      db.query<{ created_at: Date }>('SELECT created_at FROM users WHERE id = $1', [s.userId]),
      db.query(`SELECT id, created_at, last_seen_at, user_agent, host(ip) AS ip, id = $2 AS current
                  FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [s.userId, s.sessionId]),
      db.query<{ n: number }>('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [s.userId]),
    ]);
    return { email: s.email, createdAt: u.rows[0].created_at, sessions: sessions.rows, recoveryCodesLeft: codes.rows[0].n };
  });

  // Passwort ändern: aktuelles Passwort als Nachweis; danach alle anderen Geräte abgemeldet.
  app.post('/api/account/password', limited, async (req: FastifyRequest<{ Body: { current?: string; password?: string } }>, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    const pw = String(req.body?.password ?? '');
    if (pw.length < 12 || pw.length > 256) fail(400, 'Das neue Passwort muss mindestens 12 Zeichen haben.');
    const r = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [s.userId]);
    const ok = await argonVerify(r.rows[0].password_hash, String(req.body?.current ?? '').slice(0, 256)).catch(() => false);
    await audit(db, req, { event: 'account_password', ok, userId: s.userId, email: s.email });
    if (!ok) fail(401, 'Das aktuelle Passwort stimmt nicht.');
    const h = await argonHash(pw, ARGON);
    await tx(db, async c => {
      await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [s.userId, h]);
      await c.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [s.userId, s.sessionId]);
    });
    return { ok: true };
  });

  // Neue Recovery-Codes: zweiter Faktor als Nachweis; die alten werden ungültig.
  app.post('/api/account/recovery-codes', limited, async (req: FastifyRequest<{ Body: { code?: string } }>, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    const codes = await tx(db, async c => {
      const f = await checkSecondFactor(c, cfg, s.userId, req.body?.code);
      await audit(c, req, { event: 'account_recovery_codes', ok: !!f, userId: s.userId, email: s.email });
      if (!f) return null;
      await c.query('DELETE FROM recovery_codes WHERE user_id = $1', [s.userId]);
      const list = Array.from({ length: 10 }, recoveryCode);
      for (const code of list) await c.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [s.userId, sha256(normalizeRecovery(code))]);
      return list;
    });
    return codes ? { recoveryCodes: codes } : fail(401, 'Der Code stimmt nicht.');
  });

  app.post('/api/account/sessions/:id/revoke', { schema: { params: UUID } }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    if (req.params.id === s.sessionId) fail(400, 'Für dieses Gerät bitte „Abmelden“ benutzen.');
    const r = await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [req.params.id, s.userId]);
    if (!r.rowCount) fail(404, 'Gerät nicht gefunden.');
    await audit(db, req, { event: 'account_session_revoked', ok: true, userId: s.userId, email: s.email });
    return { ok: true };
  });

  // Export: alle gespeicherten Daten als JSON-Datei (DSGVO Art. 20). "state" ist die Sicherung der App.
  app.get('/api/account/export', async (req, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    const rows = await withOrg(db, s.orgId, c => c.query<{ key: string; value: unknown; updated_at: Date }>(
      'SELECT key, value, updated_at FROM kv WHERE org_id = $1 ORDER BY key', [s.orgId]));
    const data = { exportiert: new Date().toISOString(), konto: s.email, daten: Object.fromEntries(rows.rows.map(r => [r.key, r.value])) };
    return reply
      .header('Content-Disposition', `attachment; filename="taktbuch-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .header('Cache-Control', 'no-store')
      .type('application/json; charset=utf-8').send(JSON.stringify(data, null, 2));
  });

  // Konto löschen: Passwort + zweiter Faktor + ausdrückliche Bestätigung. Löscht Konto, Organisation und alle Daten.
  app.post('/api/account/delete', limited, async (req: FastifyRequest<{ Body: { password?: string; code?: string; confirm?: string } }>, reply) => {
    const s = await user(req, reply); if (!s) return reply;
    if (req.body?.confirm !== 'LÖSCHEN') fail(400, 'Bitte zur Bestätigung LÖSCHEN eintippen.');
    const r = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [s.userId]);
    const pwOk = await argonVerify(r.rows[0].password_hash, String(req.body?.password ?? '').slice(0, 256)).catch(() => false);
    const done = await tx(db, async c => {
      const f = pwOk ? await checkSecondFactor(c, cfg, s.userId, req.body?.code) : null;
      if (!pwOk || !f) {
        await audit(c, req, { event: 'account_deleted', ok: false, userId: s.userId, email: s.email });
        return false;
      }
      // Organisationen, in denen der Nutzer allein ist, mitsamt Daten (kv per CASCADE); dann den Nutzer.
      await c.query(`DELETE FROM organizations o WHERE o.id IN (SELECT org_id FROM memberships WHERE user_id = $1)
                       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id <> $1)`, [s.userId]);
      await c.query('DELETE FROM users WHERE id = $1', [s.userId]);
      await audit(c, req, { event: 'account_deleted', ok: true, userId: null, email: s.email });
      return true;
    });
    if (!done) fail(401, 'Passwort oder Code stimmt nicht.');
    await destroySession(db, cfg, req, reply);
    if (mailer) await mailer.send(accountDeletedMail(s.email)).catch(e => app.log.error(e, 'Löschbestätigung nicht verschickt'));
    return { ok: true };
  });
}
