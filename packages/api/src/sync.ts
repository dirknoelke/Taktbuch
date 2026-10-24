// Synchronisation der Online-App: Datensätze je Einstellung, Tag, Tätigkeit und Gehaltsmonat.
//   GET  /api/sync?since=REV   alles, was sich seit REV geändert hat (since=0: kompletter Stand)
//   POST /api/sync             Änderungen eines Geräts übernehmen (letzte Änderung je Datensatz gewinnt)
//   GET  /api/sync/events      Server-Sent Events: "es gibt Neues" für andere offene Geräte
// Schreibvorgänge eines Mandanten laufen nacheinander (Advisory-Lock), damit rev in Commit-Reihenfolge
// vergeben wird und ein Gerät mit "seit REV" nie etwas überspringt.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { Config } from './config.ts';
import { withOrg, type Db, type Tx } from './db.ts';
import { readSession, type SessionUser } from './session.ts';

export const COLLS = ['cfg', 'day', 'act', 'pay'] as const;
export type Coll = typeof COLLS[number];
export interface Change { c: Coll; id: string; v: unknown }
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_CHANGES = 20_000;
const CHANNEL = 'taktbuch_sync';

const orgLock = (c: Tx, orgId: string) => c.query('SELECT pg_advisory_xact_lock(724182, hashtext($1))', [orgId]);

/** App-Zustand (Format der Offline-Version) in Datensätze zerlegen. */
export function splitState(o: { cfg?: Record<string, unknown>; days?: Record<string, unknown>; acts?: Array<Record<string, unknown>>; pay?: Record<string, unknown> }): Change[] {
  const out: Change[] = [];
  for (const [k, v] of Object.entries(o.cfg ?? {})) out.push({ c: 'cfg', id: k, v });
  for (const [k, v] of Object.entries(o.days ?? {})) out.push({ c: 'day', id: k, v });
  let n = 0;
  for (const a of o.acts ?? []) out.push({ c: 'act', id: typeof a.id === 'string' && ID_RE.test(a.id) ? a.id : (a.id = 'm' + Date.now().toString(36) + (n++).toString(36)) as string, v: a });
  for (const [k, v] of Object.entries(o.pay ?? {})) out.push({ c: 'pay', id: k, v });
  return out.filter(x => ID_RE.test(x.id));
}

/** Datensätze wieder zum App-Zustand zusammensetzen (Export, ältere Clients). */
export function joinState(rows: { coll: string; id: string; value: unknown }[]) {
  const s = { v: 1, cfg: {} as Record<string, unknown>, days: {} as Record<string, unknown>, acts: [] as unknown[], pay: {} as Record<string, unknown>, demo: false };
  for (const r of rows) {
    if (r.value === null) continue;
    if (r.coll === 'cfg') s.cfg[r.id] = r.value; else if (r.coll === 'day') s.days[r.id] = r.value;
    else if (r.coll === 'act') s.acts.push(r.value); else if (r.coll === 'pay') s.pay[r.id] = r.value;
  }
  return s;
}

async function write(c: Tx, orgId: string, userId: string, changes: Change[]): Promise<number> {
  let rev = 0;
  // In Blöcken, damit große Importe nicht an Parametergrenzen scheitern
  for (let i = 0; i < changes.length; i += 1000) {
    const part = changes.slice(i, i + 1000);
    const r = await c.query<{ rev: string }>(
      `INSERT INTO records (org_id, coll, id, value, rev, updated_by)
         SELECT $1, x.c, x.id, x.v, nextval('records_rev'), $2 FROM jsonb_to_recordset($3::jsonb) AS x(c text, id text, v jsonb)
       ON CONFLICT (org_id, coll, id) DO UPDATE SET value = EXCLUDED.value, rev = EXCLUDED.rev, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING rev`, [orgId, userId, JSON.stringify(part.map(x => ({ c: x.c, id: x.id, v: x.v === undefined ? null : x.v })))]);
    for (const row of r.rows) rev = Math.max(rev, Number(row.rev));
  }
  if (rev) await c.query('SELECT pg_notify($1, $2)', [CHANNEL, `${orgId}:${rev}`]);
  return rev;
}

/** Bisheriger Gesamtstand ("state" in kv) wird beim ersten Zugriff in Datensätze übernommen. */
export async function ensureRecords(c: Tx, orgId: string, userId: string | null) {
  const has = await c.query('SELECT 1 FROM records WHERE org_id = $1 LIMIT 1', [orgId]);
  if (has.rowCount) return;
  await orgLock(c, orgId);
  const again = await c.query('SELECT 1 FROM records WHERE org_id = $1 LIMIT 1', [orgId]);
  if (again.rowCount) return;
  const kv = await c.query<{ value: unknown }>("SELECT value FROM kv WHERE org_id = $1 AND key = 'state'", [orgId]);
  if (!kv.rows[0]) return;
  let o: Parameters<typeof splitState>[0] & { demo?: boolean };
  try { o = typeof kv.rows[0].value === 'string' ? JSON.parse(kv.rows[0].value) : kv.rows[0].value as typeof o; } catch { return; }
  if (!o || o.demo) return;   // Beispieldaten nicht übernehmen
  await write(c, orgId, userId as string, splitState(o));
}

export async function loadState(c: Tx, orgId: string) {
  const r = await c.query<{ coll: string; id: string; value: unknown }>('SELECT coll, id, value FROM records WHERE org_id = $1 AND value IS NOT NULL', [orgId]);
  return joinState(r.rows);
}

/** Ein LISTEN-Anschluss je Prozess verteilt Änderungen an die offenen Event-Streams (auch über mehrere Pods). */
class Hub extends EventEmitter {
  private client: pg.Client | null = null;
  private closed = false;
  private url: string;
  private log: FastifyInstance['log'];
  constructor(url: string, log: FastifyInstance['log']) { super(); this.url = url; this.log = log; this.setMaxListeners(0); }
  async start() {
    if (this.client || this.closed) return;
    const c = new pg.Client({ connectionString: this.url });
    this.client = c;
    c.on('notification', n => { const [org, rev] = String(n.payload).split(':'); this.emit(org, Number(rev)); });
    c.on('error', e => { this.log.warn(e, 'LISTEN-Verbindung verloren'); this.restart(); });
    c.on('end', () => this.restart());
    try { await c.connect(); await c.query(`LISTEN ${CHANNEL}`); }
    catch (e) { this.log.warn(e, 'LISTEN nicht möglich'); this.restart(); }
  }
  private restart() {
    if (this.closed || !this.client) return;
    const old = this.client; this.client = null; old.removeAllListeners(); old.end().catch(() => {});
    setTimeout(() => this.start(), 2000).unref();
  }
  async stop() { this.closed = true; const c = this.client; this.client = null; if (c) { c.removeAllListeners(); await c.end().catch(() => {}); } }
}

export function syncRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const hub = new Hub(cfg.databaseUrl, app.log);
  const streams = new Set<() => void>();
  app.addHook('onClose', async () => { for (const end of [...streams]) end(); await hub.stop(); });

  const auth = async (req: FastifyRequest, reply: FastifyReply): Promise<(SessionUser & { orgId: string }) | null> => {
    const s = await readSession(db, cfg, req);
    if (!s) { reply.code(401).send({ message: 'Nicht angemeldet' }); return null; }
    if (s.kind !== 'user' || !s.orgId) { reply.code(403).send({ message: 'Dieses Konto hat keine Stundendaten.' }); return null; }
    return s as SessionUser & { orgId: string };
  };

  app.get('/api/sync', {
    schema: { querystring: { type: 'object', properties: { since: { type: 'integer', minimum: 0 } } } },
  }, async (req: FastifyRequest<{ Querystring: { since?: number } }>, reply) => {
    const s = await auth(req, reply); if (!s) return reply;
    let since = req.query.since ?? 0;
    const out = await withOrg(db, s.orgId, async c => {
      await ensureRecords(c, s.orgId, s.userId);
      const max = Number((await c.query<{ m: string }>('SELECT coalesce(max(rev), 0) AS m FROM records WHERE org_id = $1', [s.orgId])).rows[0].m);
      const full = since === 0 || since > max;   // since > max: Server-Stand wurde zurückgesetzt, alles neu holen
      if (full) since = 0;
      const r = await c.query<{ coll: Coll; id: string; value: unknown; rev: string }>(
        `SELECT coll, id, value, rev FROM records WHERE org_id = $1 AND rev > $2 ${full ? 'AND value IS NOT NULL' : ''} ORDER BY rev`, [s.orgId, since]);
      return { rev: max, full, changes: r.rows.map(x => ({ c: x.coll, id: x.id, v: x.value, rev: Number(x.rev) })) };
    });
    reply.header('Cache-Control', 'no-store');
    return out;
  });

  app.post('/api/sync', {
    bodyLimit: 10 * 1024 * 1024,
    schema: {
      body: {
        type: 'object', required: ['changes'],
        properties: {
          changes: {
            type: 'array', maxItems: MAX_CHANGES,
            items: { type: 'object', required: ['c', 'id'], properties: { c: { type: 'string', enum: [...COLLS] }, id: { type: 'string', pattern: ID_RE.source }, v: {} } },
          },
        },
      },
    },
  }, async (req: FastifyRequest<{ Body: { changes: Change[] } }>, reply) => {
    const s = await auth(req, reply); if (!s) return reply;
    const rev = await withOrg(db, s.orgId, async c => {
      await ensureRecords(c, s.orgId, s.userId);
      await orgLock(c, s.orgId);
      return write(c, s.orgId, s.userId, req.body.changes);
    });
    return { ok: true, rev };
  });

  // Live-Kanal: meldet nur "neuer Stand rev", die Daten holt das Gerät selbst über GET /api/sync.
  app.get('/api/sync/events', async (req, reply) => {
    const s = await auth(req, reply); if (!s) return reply;
    await hub.start();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    const send = (rev: number) => { res.write(`data: ${JSON.stringify({ rev })}\n\n`); };
    hub.on(s.orgId, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = () => { if (!streams.delete(end)) return; clearInterval(ping); hub.off(s.orgId, send); res.end(); };
    streams.add(end);
    req.raw.on('close', end);
  });
}
