-- Migration 003: roles, suspension, card limits, audit log
-- Run after 001_create_users.sql and 002_create_profiles.sql

-- ── users: role ──────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- ── users: suspension ────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN is_suspended     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN suspended_at     TIMESTAMPTZ,
  ADD COLUMN suspended_reason TEXT;

-- ── profiles: per-profile card limit ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN card_limit INTEGER NOT NULL DEFAULT 5;

-- ── audit_log ────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES users(id),
  action     TEXT        NOT NULL,   -- 'impersonate' | 'suspend' | 'delete_user' | 'delete_profile' | 'override_limit'
  target_id  UUID,                   -- user or profile id depending on action
  metadata   JSONB,                  -- any extra context
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_admin   ON audit_log(admin_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
