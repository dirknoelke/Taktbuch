-- Feingranulare Ablage für die Synchronisation: ein Datensatz je Einstellung, Tag, Tätigkeit, Gehaltsmonat.
-- rev wächst je Schreibvorgang (globale Sequenz; je Mandant serialisiert per Advisory-Lock),
-- Clients holen "alles seit rev X". value NULL = gelöscht (Grabstein, damit andere Geräte es mitbekommen).
CREATE SEQUENCE records_rev;
CREATE TABLE records (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  coll       text NOT NULL CHECK (coll IN ('cfg', 'day', 'act', 'pay')),
  id         text NOT NULL CHECK (id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  value      jsonb,
  rev        bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, coll, id)
);
CREATE INDEX records_org_rev ON records (org_id, rev);

ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
CREATE POLICY records_org ON records
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
