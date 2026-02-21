CREATE TABLE email_subscribers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_slug TEXT NOT NULL,
  card_id      TEXT NOT NULL,
  email        TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_slug, card_id, email)
);

CREATE INDEX idx_email_subscribers_profile ON email_subscribers(profile_slug);
