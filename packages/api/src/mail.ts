// Mailversand über einen beliebigen SMTP-Anbieter (Brevo, Scaleway, Proton, ...).
// Ohne SMTP_URL gibt es keinen Versand; Aufrufer zeigen den Link dann anders an.
import nodemailer from 'nodemailer';
import type { Config } from './config.ts';

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(m: Mail): Promise<void> }

export function createMailer(cfg: Pick<Config, 'smtpUrl' | 'smtp' | 'mailFrom' | 'mailReplyTo'>): Mailer | null {
  let transport;
  if (cfg.smtp) {
    const { host, port, user, pass } = cfg.smtp;
    // 465: TLS von Anfang an; sonst (587) Pflicht-Upgrade per STARTTLS, nie unverschlüsselt.
    transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: user ? { user, pass } : undefined });
  } else if (cfg.smtpUrl) {
    transport = nodemailer.createTransport(cfg.smtpUrl);
  } else return null;
  return {
    async send(m) {
      await transport.sendMail({ from: cfg.mailFrom, replyTo: cfg.mailReplyTo ?? undefined, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function layout(title: string, paragraphs: string[], button: { label: string; url: string }, footer: string): string {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d1d1b">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #dddbd3;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map(p => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${esc(p)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#2f6f5e;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">${esc(button.label)}</a></p>
<p style="font-size:13px;line-height:1.5;color:#6b6a64;margin:0">${esc(footer)}</p>
</div></body></html>`;
}

export function inviteMail(to: string, link: string, days: number): Mail {
  const p = [
    'Du wurdest zu Taktbuch eingeladen, der Stundenerfassung mit Zeitkonto, Urlaub und Gehalt.',
    `Über den Knopf legst du dein Konto an. Danach richtest du einen zweiten Faktor mit einer Authenticator-App ein (z. B. Microsoft Authenticator oder Aegis). Der Link ist ${days} Tage gültig und funktioniert genau einmal.`,
  ];
  const footer = 'Falls du keine Einladung erwartet hast, kannst du diese Mail einfach ignorieren.';
  return {
    to, subject: 'Deine Einladung zu Taktbuch',
    text: `Hallo,\n\n${p.join('\n\n')}\n\nKonto anlegen:\n${link}\n\n${footer}\n`,
    html: layout('Deine Einladung zu Taktbuch', p, { label: 'Konto anlegen', url: link }, footer),
  };
}

export function resetMail(to: string, link: string, minutes: number): Mail {
  const p = [
    'Für dein Taktbuch-Konto wurde ein neues Passwort angefordert.',
    `Über den Knopf vergibst du ein neues Passwort. Zur Bestätigung brauchst du zusätzlich den Code aus deiner Authenticator-App oder einen Recovery-Code. Der Link ist ${minutes} Minuten gültig.`,
  ];
  const footer = 'Falls du das nicht warst, ignoriere diese Mail. Dein Passwort bleibt unverändert, und ohne deinen zweiten Faktor kann niemand den Link nutzen.';
  return {
    to, subject: 'Neues Passwort für Taktbuch',
    text: `Hallo,\n\n${p.join('\n\n')}\n\nNeues Passwort vergeben:\n${link}\n\n${footer}\n`,
    html: layout('Neues Passwort für Taktbuch', p, { label: 'Neues Passwort vergeben', url: link }, footer),
  };
}

/** Hinweis an den Nutzer, damit ein Missbrauch des Admin-Kontos auffällt. */
export function mfaResetMail(to: string, loginUrl: string): Mail {
  const p = [
    'Der zweite Faktor deines Taktbuch-Kontos wurde von der Verwaltung zurückgesetzt, und alle Geräte wurden abgemeldet.',
    'Bei der nächsten Anmeldung mit deinem Passwort richtest du die Authenticator-App neu ein und bekommst neue Recovery-Codes. Die alten Codes gelten nicht mehr.',
  ];
  const footer = 'Falls du das nicht veranlasst hast, melde dich bitte umgehend beim Betreiber.';
  return {
    to, subject: 'Zweiter Faktor für Taktbuch zurückgesetzt',
    text: `Hallo,\n\n${p.join('\n\n')}\n\nAnmelden:\n${loginUrl}\n\n${footer}\n`,
    html: layout('Zweiter Faktor zurückgesetzt', p, { label: 'Anmelden', url: loginUrl }, footer),
  };
}

export function accountDeletedMail(to: string): Mail {
  const text = 'Dein Taktbuch-Konto und alle zugehörigen Daten wurden auf deinen Wunsch gelöscht. Falls du das nicht warst, melde dich bitte beim Betreiber.';
  return {
    to, subject: 'Dein Taktbuch-Konto wurde gelöscht',
    text: `Hallo,\n\n${text}\n`,
    html: `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;color:#1d1d1b"><p>Hallo,</p><p>${esc(text)}</p></body></html>`,
  };
}

export function emailConfirmMail(to: string, link: string, minutes: number): Mail {
  const p = [
    'Für dein Taktbuch-Konto soll künftig diese E-Mail-Adresse gelten.',
    `Bitte bestätige die Änderung über den Knopf. Der Link ist ${minutes} Minuten gültig und funktioniert genau einmal. Bis dahin bleibt die bisherige Adresse aktiv.`,
  ];
  const footer = 'Falls du das nicht veranlasst hast, ignoriere diese Mail. Ohne Bestätigung ändert sich nichts.';
  return {
    to, subject: 'Neue E-Mail-Adresse für Taktbuch bestätigen',
    text: `Hallo,\n\n${p.join('\n\n')}\n\nAdresse bestätigen:\n${link}\n\n${footer}\n`,
    html: layout('Neue E-Mail-Adresse bestätigen', p, { label: 'Adresse bestätigen', url: link }, footer),
  };
}

/** Hinweis an die bisherige Adresse, damit eine unerwünschte Änderung auffällt. */
export function emailChangedMail(to: string, newEmail: string): Mail {
  const text = `Die E-Mail-Adresse deines Taktbuch-Kontos wurde auf ${newEmail} geändert. Anmeldung und Mails laufen ab jetzt über die neue Adresse. Falls du das nicht warst, melde dich bitte umgehend beim Betreiber.`;
  return {
    to, subject: 'E-Mail-Adresse für Taktbuch geändert',
    text: `Hallo,\n\n${text}\n`,
    html: `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;color:#1d1d1b"><p>Hallo,</p><p>${esc(text)}</p></body></html>`,
  };
}
