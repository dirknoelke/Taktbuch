// Auslieferung der Oberfläche (App und Anmeldeseite) mit strikten Sicherheits-Headern.
// Die Seiten bestehen aus einer Datei mit Inline-Skripten; die CSP erlaubt genau diese
// Skripte per SHA-256-Hash, sonst nichts (kein eval, keine fremden Quellen).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { readSession } from './session.ts';

interface Page { html: string; csp: string }

export function cspFor(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return [
    "default-src 'none'",
    `script-src ${hashes.join(' ') || "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function load(dir: string, file: string): Page | null {
  const p = path.join(dir, file);
  if (!existsSync(p)) return null;
  const html = readFileSync(p, 'utf8');
  return { html, csp: cspFor(html) };
}

export function webRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const pages = { app: load(cfg.webDir, 'taktbuch.html'), login: load(cfg.webDir, 'login.html') };

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    if (cfg.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  const send = (reply: FastifyReply, page: Page | null) => {
    if (!page) return reply.code(503).type('text/plain; charset=utf-8').send('Oberfläche nicht gebaut (TARGET=online python3 build.py).');
    return reply.type('text/html; charset=utf-8').header('Content-Security-Policy', page.csp).header('Cache-Control', 'no-store').send(page.html);
  };

  app.get('/', async (req, reply) => ((await readSession(db, cfg, req)) ? send(reply, pages.app) : reply.redirect('/login')));
  app.get('/login', async (req, reply) => ((await readSession(db, cfg, req)) ? reply.redirect('/') : send(reply, pages.login)));
}
