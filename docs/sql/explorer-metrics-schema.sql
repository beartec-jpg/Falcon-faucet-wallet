-- Explorer 24h metric samples (Neon / Postgres)
-- Retention: rolling 24 hours only. Older rows are deleted by the app on every
-- write/read and by the optional prune function below.
--
-- Steady-state size: ~6 metrics × ~300 samples/day ≈ 1,800 rows (~200 KB).
-- Run once in Neon SQL editor (optional — the app auto-creates on first write).

CREATE TABLE IF NOT EXISTS explorer_metric_samples (
  metric_key  TEXT             NOT NULL,
  sampled_at  BIGINT           NOT NULL,  -- Unix epoch milliseconds (UTC)
  value       DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (metric_key, sampled_at)
);

CREATE INDEX IF NOT EXISTS explorer_metric_samples_key_time
  ON explorer_metric_samples (metric_key, sampled_at DESC);

COMMENT ON TABLE explorer_metric_samples IS
  'Rolling 24h explorer chart data. Rows older than 24h are purged automatically.';

-- One-shot manual purge (same logic the app uses):
-- DELETE FROM explorer_metric_samples
-- WHERE sampled_at < (EXTRACT(EPOCH FROM NOW()) * 1000 - 24 * 60 * 60 * 1000);

-- Reusable prune helper (call from Neon scheduled job if you want belt-and-braces):
CREATE OR REPLACE FUNCTION prune_explorer_metric_samples(retention_hours INT DEFAULT 24)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff BIGINT;
  deleted BIGINT;
BEGIN
  cutoff := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - retention_hours * 60 * 60 * 1000;
  DELETE FROM explorer_metric_samples WHERE sampled_at < cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;