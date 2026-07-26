CREATE TABLE IF NOT EXISTS codes (
  code_hash TEXT PRIMARY KEY,
  code_hint TEXT NOT NULL,
  plan TEXT NOT NULL,
  duration_days INTEGER,
  created_at TEXT NOT NULL,
  redeemed_at TEXT,
  entitlement_expires_at TEXT,
  current_activation_id TEXT,
  device_id TEXT,
  device_suffix TEXT,
  last_seen_at TEXT,
  rebind_year INTEGER NOT NULL DEFAULT 0,
  rebind_count INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_codes_activation
  ON codes(current_activation_id);

CREATE INDEX IF NOT EXISTS idx_codes_device
  ON codes(device_id);
