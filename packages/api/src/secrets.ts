// Kleine Krypto-Helfer: Zufallstoken, Hashes für Tokens, AES-256-GCM für TOTP-Secrets.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** URL-sicheres Zufallstoken (Standard 32 Byte = 256 Bit). */
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Tokens (Session, Einladung, Ticket) werden nur gehasht gespeichert. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Recovery-Code im Format xxxx-xxxx-xxxx (ohne verwechselbare Zeichen). */
export function recoveryCode(): string {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) { s += A[b[i] % A.length]; if (i === 3 || i === 7) s += '-'; }
  return s;
}
export const normalizeRecovery = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Verschlüsselt mit AES-256-GCM. Ergebnis: iv(12) | tag(16) | ciphertext. */
export function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decrypt(key: Buffer, blob: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
