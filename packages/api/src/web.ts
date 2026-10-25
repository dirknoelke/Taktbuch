// Auslieferung der Oberfläche (App und Anmeldeseite) mit strikten Sicherheits-Headern.
// Die Seiten bestehen aus einer Datei mit Inline-Skripten; die CSP erlaubt genau diese
// Skripte per SHA-256-Hash, sonst nichts (kein eval, keine fremden Quellen).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  const pages = { app: load(cfg.webDir, 'taktbuch.html'), login: load(cfg.webDir, 'login.html'), admin: load(cfg.webDir, 'admin.html'), konto: load(cfg.webDir, 'konto.html') };

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

  // Schriften (IBM Plex, SIL OFL): nur bekannte Dateinamen, lange Cache-Dauer
  app.get('/fonts/:file', async (req: FastifyRequest<{ Params: { file: string } }>, reply) => {
    const f = req.params.file;
    if (!/^[A-Za-z-]+\.woff2$/.test(f)) return reply.code(404).send();
    const p = path.join(cfg.webDir, 'fonts', f);
    if (!existsSync(p)) return reply.code(404).send();
    return reply.type('font/woff2').header('Cache-Control', 'public, max-age=31536000, immutable').send(readFileSync(p));
  });

  // App-Icons (Favicon, Homescreen): feste Liste, kein Pfad aus der Anfrage
  const BRAND: Record<string, string> = { '/favicon.ico': 'image/x-icon', '/apple-touch-icon.png': 'image/png', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png' };
  for (const [url, type] of Object.entries(BRAND)) {
    app.get(url, async (_req, reply) => {
      const p = path.join(cfg.webDir, 'brand', url.slice(1));
      if (!existsSync(p)) return reply.code(404).send();
      return reply.type(type).header('Cache-Control', 'public, max-age=86400').send(readFileSync(p));
    });
  }

  // Jede Kontoart landet auf ihrer Seite: Nutzer in der App, Admin-Konten in der Verwaltung.
  const home = (kind: 'user' | 'admin') => (kind === 'admin' ? '/admin' : '/');
  app.get('/', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    if (!s) return reply.redirect('/login');
    return s.kind === 'user' ? send(reply, pages.app) : reply.redirect(home(s.kind));
  });
  app.get('/konto', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    if (!s) return reply.redirect('/login');
    return s.kind === 'user' ? send(reply, pages.konto) : reply.redirect(home(s.kind));
  });
  app.get('/admin', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    if (!s) return reply.redirect('/login');
    return s.kind === 'admin' ? send(reply, pages.admin) : reply.redirect(home(s.kind));
  });
  // Bestätigung einer neuen E-Mail-Adresse: immer die Anmeldeseite, auch wenn schon jemand angemeldet ist.
  app.get('/email-bestaetigen', async (_req, reply) => send(reply, pages.login));
  app.get('/login', async (req, reply) => {
    const s = await readSession(db, cfg, req);
    return s ? reply.redirect(home(s.kind)) : send(reply, pages.login);
  });
}
