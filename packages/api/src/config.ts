// Konfiguration ausschließlich über Umgebungsvariablen (12-Factor). Fehlt etwas
// Pflichtiges, bricht der Start mit einer klaren Meldung ab.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Öffentliche Origin, z. B. https://staging.taktbuch.de (für Origin-Prüfung und Einladungslinks). */
  publicOrigin: string;
  /** 32 Byte Schlüssel für die Verschlüsselung der TOTP-Secrets. */
  totpKey: Buffer;
  /** Cookies nur über HTTPS (Produktion: true). */
  secureCookies: boolean;
  /** Verzeichnis mit der gebauten Online-Oberfläche (taktbuch.html, login.html). */
  webDir: string;
  sessionDays: number;
  trustProxy: boolean;
  /** SMTP-Zugang: entweder SMTP_URL (smtps://user:pass@host:465) oder SMTP_HOST/PORT/USER/PASS. Leer = kein Mailversand. */
  smtpUrl: string | null;
  smtp: { host: string; port: number; user: string; pass: string } | null;
  mailFrom: string;
  mailReplyTo: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`Umgebungsvariable ${k} fehlt`); return v; };
  const key = Buffer.from(need('TOTP_KEY'), 'base64');
  if (key.length !== 32) throw new Error('TOTP_KEY muss 32 Byte (Base64) sein, erzeugen mit: openssl rand -base64 32');
  const origin = need('PUBLIC_ORIGIN').replace(/\/$/, '');
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: need('DATABASE_URL'),
    publicOrigin: origin,
    totpKey: key,
    secureCookies: (env.SECURE_COOKIES ?? (origin.startsWith('https://') ? 'true' : 'false')) === 'true',
    webDir: env.WEB_DIR ?? path.resolve(here, '../../../dist/online'),
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    trustProxy: (env.TRUST_PROXY ?? 'true') === 'true',
    smtpUrl: env.SMTP_URL || null,
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 465), user: env.SMTP_USER ?? '', pass: env.SMTP_PASS ?? '' } : null,
    mailFrom: env.MAIL_FROM || 'Taktbuch <noreply@taktbuch.de>',
    mailReplyTo: env.MAIL_REPLY_TO || null,
  };
}
