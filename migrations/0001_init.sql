-- cygnix-seo-mcp hosted: initial schema (Cloudflare D1 / SQLite).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',          -- active | suspended
  billing_provider TEXT,                          -- paypal | whop | stripe (null = never paid)
  billing_customer_id TEXT,
  billing_subscription_id TEXT,
  billing_status TEXT,
  paid_through INTEGER,                           -- unix sec; paid tier is kept until then after a cancel
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_sub ON accounts(billing_provider, billing_subscription_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  key_hash TEXT NOT NULL UNIQUE,                  -- SHA-256 hex of the full key; the key itself is never stored
  key_prefix TEXT NOT NULL,                       -- first 12 chars, for display only
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keys_account ON api_keys(account_id);

-- Monthly metering, per key (quota is enforced on the account total).
CREATE TABLE IF NOT EXISTS usage_monthly (
  key_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  period TEXT NOT NULL,                           -- YYYY-MM (UTC)
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period)
);
CREATE INDEX IF NOT EXISTS idx_usage_account ON usage_monthly(account_id, period);

-- Fixed-window rate limiter (per account per minute, per IP for signup).
CREATE TABLE IF NOT EXISTS rate_windows (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- OAuth 2.1 bridge (API key -> OAuth tokens) for ChatGPT / Claude connectors.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,                    -- JSON array
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                             -- access | refresh
  client_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tokens_key ON oauth_tokens(key_id);

-- Billing webhook idempotency (all providers; id is "<provider>:<event id>").
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

-- Google Search Console connections: refresh tokens encrypted with AES-256-GCM (TOKEN_ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS google_connections (
  key_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,                -- base64(iv || ciphertext)
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- White-label branding (Agency) and generated PDF reports.
CREATE TABLE IF NOT EXISTS branding (
  account_id TEXT PRIMARY KEY,
  agency_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1F3A5F',
  accent_color TEXT NOT NULL DEFAULT '#F2A541',
  footer_text TEXT,
  website TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,                            -- unguessable, used in the download URL
  account_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pdf_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_account ON reports(account_id);
