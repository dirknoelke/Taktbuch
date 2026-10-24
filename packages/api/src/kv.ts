// Ablage des App-Zustands je Mandant, gleiche Schlüssel wie der Offline-Speicher.
// Optimistische Sperre über "version": Hat ein anderes Gerät inzwischen gespeichert, gibt es 409.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { withOrg, type Db } from './db.ts';
import { readSession } from './session.ts';

const KEY = { type: 'object', required: ['key'], properties: { key: { type: 'string', pattern: '^[a-z0-9_-]{1,64}$' } } } as const;

export function kvRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await readSession(db, cfg, req);
    if (!s) { reply.code(401).send({ message: 'Nicht angemeldet' }); return null; }
    return s;
  };

  app.get('/api/kv/:key', { schema: { params: KEY } }, async (req: FastifyRequest<{ Params: { key: string } }>, reply) => {
    const s = await auth(req, reply); if (!s) return reply;
    const r = await withOrg(db, s.orgId, c => c.query<{ value: unknown; version: number }>('SELECT value, version FROM kv WHERE org_id = $1 AND key = $2', [s.orgId, req.params.key]));
    if (!r.rows[0]) return reply.code(404).send({ message: 'Nicht vorhanden' });
    reply.header('Cache-Control', 'no-store');
    return r.rows[0];
  });

  app.put('/api/kv/:key', {
    bodyLimit: 5 * 1024 * 1024,
    schema: {
      params: KEY,
      body: { type: 'object', required: ['value'], properties: { value: {}, version: { type: ['integer', 'null'] } } },
    },
  }, async (req: FastifyRequest<{ Params: { key: string }; Body: { value: unknown; version?: number | null } }>, reply) => {
    const s = await auth(req, reply); if (!s) return reply;
    const { key } = req.params, value = JSON.stringify(req.body.value), version = req.body.version ?? null;
    const r = await withOrg(db, s.orgId, async c => {
      if (version === null) {
        return c.query<{ version: number }>(
          `INSERT INTO kv (org_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (org_id, key) DO NOTHING RETURNING version`, [s.orgId, key, value, s.userId]);
      }
      return c.query<{ version: number }>(
        `UPDATE kv SET value = $3::jsonb, version = version + 1, updated_at = now(), updated_by = $4
          WHERE org_id = $1 AND key = $2 AND version = $5 RETURNING version`, [s.orgId, key, value, s.userId, version]);
    });
    if (!r.rows[0]) return reply.code(409).send({ message: 'Auf einem anderen Gerät wurde inzwischen gespeichert.' });
    return { version: r.rows[0].version };
  });
}
