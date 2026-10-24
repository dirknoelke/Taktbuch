-- Taktbuch Online: Grundschema.
-- Konten, Mandanten (für Taktbuch Pro vorbereitet), MFA, Sessions, Einladungen,
-- Audit-Log und die Ablage des App-Zustands (kv, mit Row-Level-Security).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  PRIMARY KEY (user_id, org_id)
);

-- TOTP-Secret AES-256-GCM-verschlüsselt; last_step verhindert Wiederverwendung eines Codes.
CREATE TABLE totp_secrets (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc   bytea NOT NULL,
  confirmed_at timestamptz,
  last_step    bigint NOT NULL DEFAULT 0
);

CREATE TABLE recovery_codes (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at   timestamptz
);
CREATE INDEX recovery_codes_user ON recovery_codes (user_id) WHERE used_at IS NULL;

-- Sessions: im Cookie steht nur ein Zufallstoken, hier nur dessen SHA-256.
CREATE TABLE sessions (
  id_hash      bytea PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  mfa_at       timestamptz NOT NULL,
  user_agent   text,
  ip           inet
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Kurzlebige Zwischenschritte im Login: nach Passwort (mfa) oder bei der TOTP-Einrichtung (setup).
CREATE TABLE login_tickets (
  id_hash    bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('mfa', 'setup')),
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0
);

CREATE TABLE invites (
  token_hash bytea PRIMARY KEY,
  email      text CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text,
  event      text NOT NULL,
  ok         boolean NOT NULL,
  ip         inet,
  user_agent text
);
CREATE INDEX audit_log_email_at ON audit_log (email, at DESC);
CREATE INDEX audit_log_ip_at ON audit_log (ip, at DESC);

-- App-Zustand je Mandant: Schlüssel wie im Offline-Speicher ("state", "backup").
-- version für optimistische Sperre (zwei Geräte gleichzeitig).
CREATE TABLE kv (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key ~ '^[a-z0-9_-]{1,64}$'),
  value      jsonb NOT NULL,
  version    int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, key)
);

-- Row-Level-Security: Zugriff nur auf den Mandanten der laufenden Transaktion
-- (SET LOCAL app.org_id). FORCE, damit die Regel auch für den Tabellen-Owner gilt.
ALTER TABLE kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE kv FORCE ROW LEVEL SECURITY;
CREATE POLICY kv_org ON kv
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
