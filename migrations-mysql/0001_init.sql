-- cygnix-seo-mcp hosted: MySQL / MariaDB schema (mirror of migrations/0001 + 0002 for SQLite/D1).
-- Applied automatically on start when HOSTED_DB_DRIVER=mysql. utf8mb4_bin keeps SQLite's case-sensitive matching.
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  tier VARCHAR(16) NOT NULL DEFAULT 'free',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  billing_provider VARCHAR(32),
  billing_customer_id VARCHAR(191),
  billing_subscription_id VARCHAR(191),
  billing_status VARCHAR(32),
  paid_through BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_accounts_sub (billing_provider, billing_subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(32) NOT NULL,
  label VARCHAR(191),
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT,
  last_client_info TEXT,
  INDEX idx_keys_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS usage_monthly (
  key_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  period CHAR(7) NOT NULL,
  calls INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period),
  INDEX idx_usage_account (account_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS rate_windows (
  bucket VARCHAR(191) NOT NULL,
  window_start BIGINT NOT NULL,
  hits INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id VARCHAR(64) PRIMARY KEY,
  client_name VARCHAR(255),
  redirect_uris TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_client_info TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash CHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge VARCHAR(191) NOT NULL,
  resource TEXT,
  expires_at BIGINT NOT NULL,
  used TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  INDEX idx_tokens_key (key_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS billing_events (
  id VARCHAR(191) PRIMARY KEY,
  type VARCHAR(128) NOT NULL,
  received_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS google_connections (
  key_id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS branding (
  account_id VARCHAR(64) PRIMARY KEY,
  agency_name VARCHAR(255) NOT NULL,
  logo_url TEXT,
  primary_color VARCHAR(16) NOT NULL DEFAULT '#1F3A5F',
  accent_color VARCHAR(16) NOT NULL DEFAULT '#F2A541',
  footer_text TEXT,
  website TEXT,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  pdf_b64 LONGTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX idx_reports_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS billing_orders (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  tier VARCHAR(16) NOT NULL,
  amount_usd DOUBLE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  external_id VARCHAR(191),
  payer_reference VARCHAR(255),
  note TEXT,
  period_days INT NOT NULL DEFAULT 30,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  paid_at BIGINT,
  INDEX idx_orders_account (account_id),
  INDEX idx_orders_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
