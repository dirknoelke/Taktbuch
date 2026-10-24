import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, verify, stepAt, otpauthUri } from '../src/totp.ts';
import { decrypt, encrypt, normalizeRecovery, recoveryCode } from '../src/secrets.ts';
import { randomBytes } from 'node:crypto';

// Testvektoren aus RFC 6238, Anhang B (SHA1, Secret "12345678901234567890", 8 Stellen)
const SECRET = Buffer.from('12345678901234567890');
const RFC = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const;

test('RFC 6238 Testvektoren (SHA1, 8 Stellen)', () => {
  for (const [t, code] of RFC) assert.equal(hotp(SECRET, Math.floor(t / 30), 8), code, `T=${t}`);
});

test('RFC 4226 Testvektoren HOTP (6 Stellen)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((c, i) => assert.equal(hotp(SECRET, i), c));
});

test('Base32 hin und zurück', () => {
  for (let i = 0; i < 50; i++) { const b = randomBytes(1 + i % 25); assert.deepEqual(base32Decode(base32Encode(b)), b); }
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
});

test('verify: Toleranz ±1 Schritt, Replay-Schutz, Format', () => {
  const now = 1_700_000_000_000, s = stepAt(now);
  const code = hotp(SECRET, s);
  assert.equal(verify(SECRET, code, 0, now), s);
  assert.equal(verify(SECRET, hotp(SECRET, s - 1), 0, now), s - 1);
  assert.equal(verify(SECRET, hotp(SECRET, s + 1), 0, now), s + 1);
  assert.equal(verify(SECRET, hotp(SECRET, s - 2), 0, now), null);
  assert.equal(verify(SECRET, code, s, now), null, 'bereits benutzter Schritt wird abgelehnt');
  assert.equal(verify(SECRET, code.slice(0, 3) + ' ' + code.slice(3), 0, now), s, 'Leerzeichen erlaubt');
  assert.equal(verify(SECRET, 'abcdef', 0, now), null);
});

test('otpauth-URI', () => {
  const u = new URL(otpauthUri(SECRET, 'dirk@example.org'));
  assert.equal(u.protocol, 'otpauth:');
  assert.equal(u.searchParams.get('issuer'), 'Taktbuch');
  assert.deepEqual(base32Decode(u.searchParams.get('secret')!), SECRET);
});

test('AES-GCM: hin und zurück, Manipulation fällt auf', () => {
  const key = randomBytes(32), plain = randomBytes(20);
  const blob = encrypt(key, plain);
  assert.deepEqual(decrypt(key, blob), plain);
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decrypt(key, blob));
});

test('Recovery-Codes: Format und Normalisierung', () => {
  const c = recoveryCode();
  assert.match(c, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  assert.equal(normalizeRecovery(c.toUpperCase().replace(/-/g, ' ')), c.replace(/-/g, ''));
});
