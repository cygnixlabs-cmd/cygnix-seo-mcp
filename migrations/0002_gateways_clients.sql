-- Gateway-agnostic checkout: one-time / manual orders (crypto invoices, Payoneer, PayPal.me, wallet transfers)
-- and client hints for hiding prices in ChatGPT.
CREATE TABLE IF NOT EXISTS billing_orders (
  id TEXT PRIMARY KEY,                            -- ord_<24 random>; also the payment reference shown to the payer
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,                         -- crypto | payoneer | paypal_link | crypto_wallet | ...
  tier TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | paid | cancelled | failed | expired
  external_id TEXT,                               -- gateway invoice / payment id
  payer_reference TEXT,                           -- what the payer submitted (tx hash, Payoneer/PayPal txn id)
  note TEXT,
  period_days INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON billing_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON billing_orders(status, created_at);

ALTER TABLE oauth_clients ADD COLUMN last_client_info TEXT;
ALTER TABLE api_keys ADD COLUMN last_client_info TEXT;
