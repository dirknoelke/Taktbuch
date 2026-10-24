-- E-Mail-Adresse ändern: Bestätigungslink an die neue Adresse (nur der Hash wird gespeichert).
CREATE TABLE email_changes (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email  text NOT NULL CHECK (new_email = lower(new_email)),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX email_changes_user ON email_changes (user_id);
