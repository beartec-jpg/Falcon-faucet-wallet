-- Airdrop + faucet claim logging (Neon / Postgres)
-- Run once in your database console.

CREATE TABLE IF NOT EXISTS faucet_claims (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  amount_qxrp DOUBLE PRECISION NOT NULL,
  tx_hash TEXT NOT NULL,
  ip_hash TEXT,
  day_utc DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faucet_claims_addr_day
  ON faucet_claims (network, address, day_utc);

CREATE TABLE IF NOT EXISTS airdrop_config (
  id INT PRIMARY KEY DEFAULT 1,
  network TEXT NOT NULL DEFAULT 'mainnet',
  genesis_at TIMESTAMPTZ,
  window_days INT NOT NULL DEFAULT 60,
  pool_falcon DOUBLE PRECISION NOT NULL DEFAULT 2000000000,
  first_emission_epoch INT NOT NULL DEFAULT 8,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT airdrop_config_singleton CHECK (id = 1)
);

INSERT INTO airdrop_config (id, network, window_days, pool_falcon, first_emission_epoch, notes)
VALUES (
  1,
  'mainnet',
  60,
  2000000000,
  8,
  '1% of 200B supply. Scores from mainnet genesis for 60 days. Emissions start epoch 8.'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS airdrop_allocations (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  score_validator DOUBLE PRECISION NOT NULL DEFAULT 0,
  score_setup DOUBLE PRECISION NOT NULL DEFAULT 0,
  score_dex_lp DOUBLE PRECISION NOT NULL DEFAULT 0,
  score_faucet DOUBLE PRECISION NOT NULL DEFAULT 0,
  score_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  falcon_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  faucet_active_days INT NOT NULL DEFAULT 0,
  faucet_claims INT NOT NULL DEFAULT 0,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claim_tx TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, address)
);

CREATE INDEX IF NOT EXISTS airdrop_allocations_score
  ON airdrop_allocations (network, score_total DESC);
