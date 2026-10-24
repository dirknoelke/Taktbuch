-- Passwort vergessen: einmal verwendbare, kurzlebige Links (nur der Hash wird gespeichert).
CREATE TABLE password_resets (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  attempts   int NOT NULL DEFAULT 0
);
CREATE INDEX password_resets_user ON password_resets (user_id);
