// Mailversand über echtes SMTP (lokaler Fänger) und Inhalt der Mails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, inviteMail, resetMail } from '../src/mail.ts';
import { startSmtpSink } from './smtp-sink.ts';

test('ohne SMTP_URL kein Mailer', () => {
  assert.equal(createMailer({ smtpUrl: null, smtp: null, mailFrom: 'x <a@b.de>', mailReplyTo: null }), null);
});

test('Versand über SMTP mit Absender und Antwortadresse', async () => {
  const sink = await startSmtpSink();
  try {
    const m = createMailer({ smtpUrl: `smtp://user:pass@127.0.0.1:${sink.port}`, smtp: null, mailFrom: 'Taktbuch <noreply@taktbuch.de>', mailReplyTo: 'taktbuch@pm.me' })!;
    await m.send(inviteMail('mella@example.org', 'https://staging.taktbuch.de/login#invite=abc', 7));
    assert.equal(sink.mails.length, 1);
    const mail = sink.mails[0];
    assert.match(mail.from, /noreply@taktbuch\.de/);
    assert.match(mail.to[0], /mella@example\.org/);
    assert.match(mail.data, /^Reply-To: taktbuch@pm\.me/m);
    assert.match(mail.data, /^Subject: Deine Einladung zu Taktbuch/m);
    assert.match(mail.data, /multipart\/alternative/, 'Text- und HTML-Teil');
  } finally { await sink.close(); }
});

test('Mailtexte: Link enthalten, HTML maskiert, keine Gedankenstriche', () => {
  const link = 'https://x.example/login#invite=a"b<c>';
  for (const m of [inviteMail('a@b.de', link, 7), resetMail('a@b.de', link, 30)]) {
    assert.ok(m.text.includes(link), 'Link im Textteil');
    assert.ok(m.html.includes('a&quot;b&lt;c&gt;'), 'Link im HTML maskiert');
    assert.ok(!/[–—]/.test(m.text + m.html + m.subject), 'kein Halbgeviert- oder Geviertstrich');
  }
});
