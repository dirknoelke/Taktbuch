// Sessions: Zufallstoken im Cookie, in der DB nur dessen SHA-256.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Db, Tx } from './db.ts';
import { sha256, token } from './secrets.ts';

export interface SessionUser {
  userId: string; email: string; kind: 'user' | 'admin';
  /** Organisation mit den Stundendaten; bei Admin-Konten null. */
  orgId: string | null; role: string | null;
  sessionId: string;
  /** Letzter Nachweis des zweiten Faktors in dieser Session (Login oder erneute Abfrage). */
  mfaAt: Date;
}

export const cookieName = (cfg: Config) => (cfg.secureCookies ? '__Host-session' : 'tb_session');

export async function createSession(c: Tx | Db, cfg: Config, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const t = token();
  await c.query(
    `INSERT INTO sessions (id_hash, user_id, expires_at, mfa_at, user_agent, ip)
     VALUES ($1, $2, now() + make_interval(days => $3), now(), $4, $5)`,
    [sha256(t), userId, cfg.sessionDays, String(req.headers['user-agent'] ?? '').slice(0, 300), req.ip]
  );
  await c.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  reply.setCookie(cookieName(cfg), t, {
    path: '/', httpOnly: true, secure: cfg.secureCookies, sameSite: 'strict', maxAge: cfg.sessionDays * 86400,
  });
}

/** Liest die Session aus dem Cookie; verlängert sie rollierend (höchstens einmal pro Stunde ein Schreibzugriff). */
export async function readSession(db: Db, cfg: Config, req: FastifyRequest): Promise<SessionUser | null> {
  const t = req.cookies[cookieName(cfg)];
  if (!t) return null;
  const r = await db.query<{ user_id: string; email: string; kind: 'user' | 'admin'; org_id: string | null; role: string | null; sid: string; mfa_at: Date; stale: boolean }>(
    `SELECT s.user_id, u.email, u.kind, m.org_id, m.role, s.id AS sid, s.mfa_at, s.last_seen_at < now() - interval '1 hour' AS stale
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id
      WHERE s.id_hash = $1 AND s.expires_at > now() AND u.mfa_enabled AND u.locked_at IS NULL
      ORDER BY m.role = 'owner' DESC NULLS LAST
      LIMIT 1`,
    [sha256(t)]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.kind === 'user' && !row.org_id) return null;   // Nutzer ohne Organisation: inkonsistent, nicht zulassen
  if (row.stale) {
    await db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id_hash = $1`, [sha256(t), cfg.sessionDays]);
  }
  return { userId: row.user_id, email: row.email, kind: row.kind, orgId: row.org_id, role: row.role, sessionId: row.sid, mfaAt: row.mfa_at };
}

export async function destroySession(db: Db, cfg: Config, req: FastifyRequest, reply: FastifyReply) {
  const t = req.cookies[cookieName(cfg)];
  if (t) await db.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(t)]);
  reply.clearCookie(cookieName(cfg), { path: '/', httpOnly: true, secure: cfg.secureCookies, sameSite: 'strict' });
}
