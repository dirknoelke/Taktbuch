"""Gemeinsame Helfer für die Browser-Tests von Taktbuch Online: API-Server, SMTP-Fänger, TOTP, Prüfausgabe."""
import base64, email, hashlib, hmac, os, re, secrets, socketserver, struct, subprocess, threading, time, urllib.request

PORT = 18080
ORIGIN = f'http://localhost:{PORT}'
DB = os.environ['TEST_DATABASE_URL']
ENV = dict(os.environ, DATABASE_URL=DB, PUBLIC_ORIGIN=ORIGIN, PORT=str(PORT), HOST='127.0.0.1',
           TOTP_KEY=base64.b64encode(secrets.token_bytes(32)).decode(), SECURE_COOKIES='false', TRUST_PROXY='false')
API = ['node', 'packages/api/src/']

# Minimaler SMTP-Empfänger: hebt eingehende Mails auf
MAILS = []
class Smtp(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: self.wfile.write((s + '\r\n').encode())
        w('220 sink'); data = None
        for raw in self.rfile:
            line = raw.decode('utf-8', 'replace').rstrip('\r\n')
            if data is not None:
                if line == '.': MAILS.append(email.message_from_string('\n'.join(data))); data = None; w('250 OK')
                else: data.append(line[1:] if line.startswith('..') else line)
                continue
            c = line[:4].upper()
            if c == 'EHLO': self.wfile.write(b'250-sink\r\n250 8BITMIME\r\n')
            elif c == 'DATA': data = []; w('354 go')
            elif c == 'QUIT': w('221 bye'); return
            else: w('250 OK')
sink = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Smtp); sink.daemon_threads = True
threading.Thread(target=sink.serve_forever, daemon=True).start()
ENV['SMTP_URL'] = f'smtp://127.0.0.1:{sink.server_address[1]}'

def mail_link(to, key):
    for _ in range(50):
        for m in reversed(MAILS):
            if to in m['To']:
                body = next(p.get_payload(decode=True).decode() for p in m.walk() if p.get_content_type() == 'text/plain')
                hit = re.search(re.escape(ORIGIN) + r'/login#' + key + r'=[A-Za-z0-9_-]+', body)
                if hit: return hit.group(0)
        time.sleep(0.1)
    return None

def totp(secret_b32, offset=0):
    key = base64.b32decode(secret_b32.replace(' ', '') + '=' * (-len(secret_b32.replace(' ', '')) % 8))
    step = int(time.time() // 30) + offset
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1_000_000).zfill(6)

RESULT = {'ok': True}
def check(name, cond):
    print(('OK   ' if cond else 'FAIL ') + name)
    if not cond: RESULT['ok'] = False

def start_server():
    """Startet die API und wartet, bis sie bereit ist."""
    server = subprocess.Popen(API[:1] + [API[1] + 'main.ts'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(60):
        try:
            urllib.request.urlopen(ORIGIN + '/readyz', timeout=1); return server
        except Exception: time.sleep(0.5)
    print(server.stderr.read().decode()[-3000:]); raise SystemExit('API startet nicht')

def cli(*args):
    return subprocess.run(API[:1] + [API[1] + 'cli.ts', *args], env=ENV, capture_output=True, text=True, check=True).stdout

def page_errors(page, errs):
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

def real_errors(errs):
    """Erwartete Statusmeldungen (404 neuer Nutzer, 409 Konflikt, 401/403 Ablehnungen) herausfiltern."""
    return [e for e in errs if not ('Failed to load resource' in e and any(c in e for c in ('401', '403', '404', '409')))]

