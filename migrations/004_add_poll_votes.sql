CREATE TABLE poll_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_slug TEXT NOT NULL,
  card_id      TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  voter_ip     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_poll_votes_card ON poll_votes(profile_slug, card_id);
