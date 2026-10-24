// TOTP nach RFC 6238 (HMAC-SHA1, 6 Stellen, 30 s), kompatibel mit allen gängigen
// Authenticator-Apps (Microsoft, Google, Aegis, Proton Pass, 1Password).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('ungültiges Base32-Zeichen');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Neues Secret: 20 Byte (160 Bit), wie von RFC 4226 empfohlen. */
export function newSecret(): Buffer { return randomBytes(20); }

export function hotp(secret: Buffer, counter: number, digits = DIGITS, algo = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (unixMs: number) => Math.floor(unixMs / 1000 / STEP_SECONDS);

/**
 * Prüft einen Code mit ±1 Zeitschritt Toleranz (Uhrabweichung).
 * Gibt den getroffenen Zeitschritt zurück, oder null. lastStep verhindert die
 * Wiederverwendung eines bereits benutzten Codes (Replay-Schutz).
 */
export function verify(secret: Buffer, code: string, lastStep: number, nowMs = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'Taktbuch'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const p = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${p}`;
}
