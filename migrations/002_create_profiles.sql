CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL
                  CHECK (slug ~ '^[a-z0-9-]{3,50}$'),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  tagline       TEXT,
  bio           TEXT,
  initials      VARCHAR(3),
  emoji         VARCHAR(10),
  avatar_style  TEXT DEFAULT 'initials',
  logo_url      TEXT,
  theme         TEXT DEFAULT 'midnight',
  socials       JSONB NOT NULL DEFAULT '[]',
  cards         JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_slug ON profiles(slug);
CREATE INDEX idx_profiles_owner ON profiles(owner_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
