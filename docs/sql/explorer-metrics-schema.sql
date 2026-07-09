-- Shared 24h explorer metric samples (Neon / Postgres).
-- Also auto-created on first write by the app if this file was not run manually.

CREATE TABLE IF NOT EXISTS explorer_metric_samples (
  metric_key  TEXT             NOT NULL,
  sampled_at  BIGINT           NOT NULL,  -- Unix ms
  value       DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (metric_key, sampled_at)
);

CREATE INDEX IF NOT EXISTS explorer_metric_samples_key_time
  ON explorer_metric_samples (metric_key, sampled_at DESC);