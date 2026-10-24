-- Kontoarten: "user" (Stundendaten in eigener Organisation) und "admin" (nur Verwaltung, keine Daten).
ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN locked_at timestamptz;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

-- Einladungen bekommen eine öffentliche ID (zum Zurückziehen in der Verwaltung) und die Kontoart.
ALTER TABLE invites ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE invites ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'admin'));
ALTER TABLE invites ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN revoked_at timestamptz;

-- Sessions: öffentliche Kennung für die Geräteliste (ohne das Token preiszugeben).
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

-- Audit: Ziel einer Verwaltungsaktion (z. B. gesperrter Nutzer)
ALTER TABLE audit_log ADD COLUMN target text;
