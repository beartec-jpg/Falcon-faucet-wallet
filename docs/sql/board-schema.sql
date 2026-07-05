-- Falcon Ledger message board schema (Neon Postgres)
-- Run once in the Neon SQL editor or: psql $DATABASE_URL -f docs/sql/board-schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Top-level posts and threaded replies (parent_id NULL = top-level)
CREATE TABLE IF NOT EXISTS board_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES board_posts(id) ON DELETE CASCADE,
  author_address VARCHAR(34) NOT NULL,
  body          TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_board_posts_top_level
  ON board_posts (created_at DESC)
  WHERE parent_id IS NULL AND NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_board_posts_replies
  ON board_posts (parent_id, created_at ASC)
  WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_board_posts_author
  ON board_posts (author_address, created_at DESC);

-- Short-lived signing challenges (body locked at challenge time)
CREATE TABLE IF NOT EXISTS board_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_address  VARCHAR(34) NOT NULL,
  nonce           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES board_posts(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_challenges_expires
  ON board_challenges (expires_at)
  WHERE consumed_at IS NULL;