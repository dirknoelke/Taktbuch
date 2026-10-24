// Prüfung des zweiten Faktors für Aktionen innerhalb einer bestehenden Session
// (erneute Abfrage für die Verwaltung, Recovery-Codes erneuern, Konto löschen).
import type { Config } from './config.ts';
import type { Tx } from './db.ts';
import { decrypt, normalizeRecovery, sha256 } from './secrets.ts';
import { verify as verifyTotp } from './totp.ts';

/** TOTP-Code (6 Ziffern) oder Recovery-Code. Verbraucht den Code bei Erfolg (Replay-Schutz bzw. einmalig). */
export async function checkSecondFactor(c: Tx, cfg: Config, userId: string, rawCode: unknown): Promise<'totp' | 'recovery' | null> {
  const code = String(rawCode ?? '').trim();
  if (!code) return null;
  if (/^\d[\d ]{5,6}$/.test(code)) {
    const r = await c.query<{ secret_enc: Buffer; last_step: string }>(
      'SELECT secret_enc, last_step FROM totp_secrets WHERE user_id = $1 AND confirmed_at IS NOT NULL FOR UPDATE', [userId]);
    if (!r.rows[0]) return null;
    const step = verifyTotp(decrypt(cfg.totpKey, r.rows[0].secret_enc), code, Number(r.rows[0].last_step));
    if (step === null) return null;
    await c.query('UPDATE totp_secrets SET last_step = $2 WHERE user_id = $1', [userId, step]);
    return 'totp';
  }
  const used = await c.query(
    `UPDATE recovery_codes SET used_at = now() WHERE id = (
       SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1) RETURNING id`,
    [userId, sha256(normalizeRecovery(code))]);
  return used.rowCount ? 'recovery' : null;
}
