// Minimaler SMTP-Empfänger für Tests: nimmt Mails an und hebt sie auf (kein TLS, keine Auth-Prüfung).
import net from 'node:net';

export interface Received { from: string; to: string[]; data: string }

export async function startSmtpSink(): Promise<{ port: number; mails: Received[]; close: () => Promise<void> }> {
  const mails: Received[] = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, cur: Received = { from: '', to: [], data: '' };
    const say = (s: string) => sock.write(s + '\r\n');
    say('220 sink ESMTP');
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mails.push(cur); cur = { from: '', to: [], data: '' }; say('250 OK'); }
          else cur.data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { sock.write('250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
        else if (cmd === 'HELO') say('250 sink');
        else if (cmd === 'AUTH') say('235 OK');
        else if (cmd === 'MAIL') { cur.from = line.slice(10).trim(); say('250 OK'); }
        else if (cmd === 'RCPT') { cur.to.push(line.slice(8).trim()); say('250 OK'); }
        else if (cmd === 'DATA') { inData = true; say('354 go'); }
        else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
        else say('250 OK');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return { port, mails, close: () => new Promise(r => server.close(() => r())) };
}
