// Data access for accounts, API keys, metering, rate limits, OAuth tokens and Stripe events.
import type { Db } from "./db.js";
import { newApiKey, newId, sha256Hex } from "./crypto.js";
import { TIERS, isTier, type TierId } from "./tiers.js";

export interface Account {
  id: string; email: string; tier: TierId; status: string;
  billing_provider: string | null; billing_customer_id: string | null; billing_subscription_id: string | null; billing_status: string | null; paid_through: number | null;
  created_at: number; updated_at: number;
}
export interface ApiKeyRow { id: string; account_id: string; key_prefix: string; label: string | null; created_at: number; last_used_at: number | null; revoked_at: number | null }
/** Tier actually enforced: a cancelled subscription keeps its paid tier until paid_through, then drops to free. */
export function effectiveTier(a: Pick<Account, "tier" | "billing_status" | "paid_through">, nowS = nowSec()): TierId {
  if (a.tier !== "free" && a.billing_status === "ending" && (!a.paid_through || a.paid_through < nowS)) return "free";
  return a.tier;
}
export class StoreError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }

export const nowSec = () => Math.floor(Date.now() / 1000);
export const periodOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
export const periodResetIso = (ms = Date.now()) => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString(); };
const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: unknown): e is string => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export class Store {
  constructor(private db: Db) {}

  // ---- accounts ----
  async createAccount(email: string, tier: TierId = "free"): Promise<Account> {
    const e = normEmail(email);
    if (await this.accountByEmail(e)) throw new StoreError(409, "account_exists", "An account with this email already exists.");
    const id = newId("acct"); const t = nowSec();
    await this.db.prepare("INSERT INTO accounts (id,email,tier,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id, e, tier, "active", t, t).run();
    return (await this.account(id))!;
  }
  account(id: string) { return this.db.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<Account>(); }
  accountByEmail(email: string) { return this.db.prepare("SELECT * FROM accounts WHERE email=?").bind(normEmail(email)).first<Account>(); }
  accountBySubscription(provider: string, sub: string) { return this.db.prepare("SELECT * FROM accounts WHERE billing_provider=? AND billing_subscription_id=?").bind(provider, sub).first<Account>(); }
  accountByCustomer(provider: string, cus: string) { return this.db.prepare("SELECT * FROM accounts WHERE billing_provider=? AND billing_customer_id=?").bind(provider, cus).first<Account>(); }
  async listAccounts(limit = 100) { return (await this.db.prepare("SELECT * FROM accounts ORDER BY created_at DESC LIMIT ?").bind(limit).all<Account>()).results; }
  async setTier(id: string, tier: TierId) {
    if (!isTier(tier)) throw new StoreError(400, "bad_tier", `Unknown tier ${tier}`);
    await this.db.prepare("UPDATE accounts SET tier=?, updated_at=? WHERE id=?").bind(tier, nowSec(), id).run();
  }
  async setStatus(id: string, status: "active" | "suspended") { await this.db.prepare("UPDATE accounts SET status=?, updated_at=? WHERE id=?").bind(status, nowSec(), id).run(); }
  async setBilling(id: string, f: { provider?: string | null; customer?: string | null; subscription?: string | null; status?: string | null; paidThrough?: number | null }) {
    const a = await this.account(id); if (!a) return;
    const pick = <K extends keyof typeof f>(k: K, cur: unknown) => (f[k] !== undefined ? f[k] : cur);
    await this.db.prepare("UPDATE accounts SET billing_provider=?, billing_customer_id=?, billing_subscription_id=?, billing_status=?, paid_through=?, updated_at=? WHERE id=?")
      .bind(pick("provider", a.billing_provider), pick("customer", a.billing_customer_id), pick("subscription", a.billing_subscription_id), pick("status", a.billing_status), pick("paidThrough", a.paid_through), nowSec(), id).run();
  }

  // ---- API keys ----
  async listKeys(accountId: string, includeRevoked = false): Promise<ApiKeyRow[]> {
    const sql = `SELECT id,account_id,key_prefix,label,created_at,last_used_at,revoked_at FROM api_keys WHERE account_id=? ${includeRevoked ? "" : "AND revoked_at IS NULL"} ORDER BY created_at`;
    return (await this.db.prepare(sql).bind(accountId).all<ApiKeyRow>()).results;
  }
  /** Creates a key and returns the plaintext once. Only the SHA-256 hash is stored. */
  async createKey(accountId: string, label?: string, opts: { enforceLimit?: boolean } = {}): Promise<{ key: string; row: ApiKeyRow }> {
    const acct = await this.account(accountId); if (!acct) throw new StoreError(404, "no_account", "Account not found.");
    if (opts.enforceLimit !== false) {
      const active = (await this.listKeys(accountId)).length; const max = TIERS[acct.tier].maxKeys;
      if (active >= max) throw new StoreError(403, "key_limit", `Your ${TIERS[acct.tier].name} plan allows ${max} active key(s). Revoke one or upgrade.`);
    }
    const key = newApiKey(); const id = newId("key"); const t = nowSec();
    await this.db.prepare("INSERT INTO api_keys (id,account_id,key_hash,key_prefix,label,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, accountId, await sha256Hex(key), key.slice(0, 12), label ?? null, t).run();
    return { key, row: { id, account_id: accountId, key_prefix: key.slice(0, 12), label: label ?? null, created_at: t, last_used_at: null, revoked_at: null } };
  }
  async keyByPlaintext(key: string) {
    return this.db.prepare("SELECT k.id AS key_id, k.revoked_at, a.* FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=?")
      .bind(await sha256Hex(key)).first<Account & { key_id: string; revoked_at: number | null }>();
  }
  async keyContext(keyId: string) {
    return this.db.prepare("SELECT k.id AS key_id, k.revoked_at, a.* FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.id=?")
      .bind(keyId).first<Account & { key_id: string; revoked_at: number | null }>();
  }
  keyRow(keyId: string) { return this.db.prepare("SELECT id,account_id,key_prefix,label,created_at,last_used_at,revoked_at FROM api_keys WHERE id=?").bind(keyId).first<ApiKeyRow>(); }
  async revokeKey(keyId: string, accountId?: string) {
    const k = await this.keyRow(keyId);
    if (!k || (accountId && k.account_id !== accountId)) throw new StoreError(404, "no_key", "Key not found.");
    if (k.revoked_at) return k;
    const t = nowSec();
    await this.db.prepare("UPDATE api_keys SET revoked_at=? WHERE id=?").bind(t, keyId).run();
    await this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE key_id=? AND revoked_at IS NULL").bind(t, keyId).run();
    return { ...k, revoked_at: t };
  }
  /** Rotate = issue a replacement key with the same label, then revoke the old one. */
  async rotateKey(keyId: string, accountId?: string) {
    const k = await this.keyRow(keyId);
    if (!k || k.revoked_at || (accountId && k.account_id !== accountId)) throw new StoreError(404, "no_key", "Active key not found.");
    const fresh = await this.createKey(k.account_id, k.label ?? undefined, { enforceLimit: false });
    await this.revokeKey(keyId);
    return fresh;
  }
  async touchKey(keyId: string) { await this.db.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?").bind(nowSec(), keyId).run(); }

  // ---- metering ----
  /** Atomically adds one call for this key/month and returns the new account-wide total. */
  async incrementUsage(keyId: string, accountId: string, period = periodOf()): Promise<number> {
    await this.db.prepare("INSERT INTO usage_monthly (key_id,account_id,period,calls) VALUES (?,?,?,1) ON CONFLICT(key_id,period) DO UPDATE SET calls=calls+1")
      .bind(keyId, accountId, period).run();
    return this.accountUsage(accountId, period);
  }
  async decrementUsage(keyId: string, period = periodOf()) {
    await this.db.prepare("UPDATE usage_monthly SET calls=MAX(calls-1,0) WHERE key_id=? AND period=?").bind(keyId, period).run();
  }
  async accountUsage(accountId: string, period = periodOf()): Promise<number> {
    const r = await this.db.prepare("SELECT COALESCE(SUM(calls),0) AS n FROM usage_monthly WHERE account_id=? AND period=?").bind(accountId, period).first<{ n: number }>();
    return Number(r?.n ?? 0);
  }
  async usageByKey(accountId: string, period = periodOf()) {
    return (await this.db.prepare("SELECT key_id, calls FROM usage_monthly WHERE account_id=? AND period=? ORDER BY calls DESC").bind(accountId, period).all<{ key_id: string; calls: number }>()).results;
  }

  // ---- rate limiting (fixed window) ----
  async hit(bucket: string, windowSec: number, nowMs = Date.now()): Promise<{ hits: number; resetSec: number }> {
    const ws = Math.floor(nowMs / 1000 / windowSec) * windowSec;
    await this.db.prepare("INSERT INTO rate_windows (bucket,window_start,hits) VALUES (?,?,1) ON CONFLICT(bucket,window_start) DO UPDATE SET hits=hits+1").bind(bucket, ws).run();
    const r = await this.db.prepare("SELECT hits FROM rate_windows WHERE bucket=? AND window_start=?").bind(bucket, ws).first<{ hits: number }>();
    if (Math.random() < 0.01) await this.db.prepare("DELETE FROM rate_windows WHERE window_start < ?").bind(ws - 86400).run();
    return { hits: Number(r?.hits ?? 1), resetSec: ws + windowSec - Math.floor(nowMs / 1000) };
  }

  // ---- OAuth bridge ----
  async registerClient(name: string, redirectUris: string[]) {
    const id = newId("client");
    await this.db.prepare("INSERT INTO oauth_clients (client_id,client_name,redirect_uris,created_at) VALUES (?,?,?,?)").bind(id, name, JSON.stringify(redirectUris), nowSec()).run();
    return id;
  }
  async client(id: string) {
    const r = await this.db.prepare("SELECT * FROM oauth_clients WHERE client_id=?").bind(id).first<{ client_id: string; client_name: string; redirect_uris: string }>();
    return r ? { ...r, redirect_uris: JSON.parse(r.redirect_uris) as string[] } : null;
  }
  async saveCode(code: string, f: { client_id: string; key_id: string; redirect_uri: string; code_challenge: string; resource?: string | null }, ttl = 600) {
    await this.db.prepare("INSERT INTO oauth_codes (code_hash,client_id,key_id,redirect_uri,code_challenge,resource,expires_at) VALUES (?,?,?,?,?,?,?)")
      .bind(await sha256Hex(code), f.client_id, f.key_id, f.redirect_uri, f.code_challenge, f.resource ?? null, nowSec() + ttl).run();
  }
  async consumeCode(code: string) {
    const h = await sha256Hex(code);
    const r = await this.db.prepare("SELECT * FROM oauth_codes WHERE code_hash=?").bind(h).first<{ client_id: string; key_id: string; redirect_uri: string; code_challenge: string; resource: string | null; expires_at: number; used: number }>();
    if (!r) return null;
    const upd = await this.db.prepare("UPDATE oauth_codes SET used=1 WHERE code_hash=? AND used=0").bind(h).run();
    if (r.used || upd.meta?.changes === 0 || r.expires_at < nowSec()) return null;
    return r;
  }
  async saveToken(token: string, kind: "access" | "refresh", clientId: string, keyId: string, ttl: number) {
    await this.db.prepare("INSERT INTO oauth_tokens (token_hash,kind,client_id,key_id,expires_at) VALUES (?,?,?,?,?)").bind(await sha256Hex(token), kind, clientId, keyId, nowSec() + ttl).run();
  }
  async tokenLookup(token: string, kind: "access" | "refresh") {
    const r = await this.db.prepare("SELECT * FROM oauth_tokens WHERE token_hash=? AND kind=?").bind(await sha256Hex(token), kind)
      .first<{ token_hash: string; client_id: string; key_id: string; expires_at: number; revoked_at: number | null }>();
    return r && !r.revoked_at && r.expires_at > nowSec() ? r : null;
  }
  async revokeToken(token: string) { await this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE token_hash=?").bind(nowSec(), await sha256Hex(token)).run(); }

  // ---- billing webhook idempotency ----
  async markEvent(id: string, type: string): Promise<boolean> {
    const r = await this.db.prepare("INSERT OR IGNORE INTO billing_events (id,type,received_at) VALUES (?,?,?)").bind(id, type, nowSec()).run();
    return (r.meta?.changes ?? 1) > 0;
  }
  async unmarkEvent(id: string) { await this.db.prepare("DELETE FROM billing_events WHERE id=?").bind(id).run(); }

  // ---- Google Search Console connections (ciphertext only) ----
  async saveGoogle(keyId: string, accountId: string, refreshEnc: string, scope: string) {
    const t = nowSec();
    await this.db.prepare("INSERT INTO google_connections (key_id,account_id,refresh_token_enc,scope,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(key_id) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc, scope=excluded.scope, updated_at=excluded.updated_at")
      .bind(keyId, accountId, refreshEnc, scope, t, t).run();
  }
  google(keyId: string) { return this.db.prepare("SELECT * FROM google_connections WHERE key_id=?").bind(keyId).first<{ key_id: string; account_id: string; refresh_token_enc: string; scope: string }>(); }
  async deleteGoogle(keyId: string) { await this.db.prepare("DELETE FROM google_connections WHERE key_id=?").bind(keyId).run(); }

  // ---- white-label branding + reports ----
  branding(accountId: string) { return this.db.prepare("SELECT * FROM branding WHERE account_id=?").bind(accountId).first<Branding>(); }
  async saveBranding(accountId: string, b: Omit<Branding, "account_id" | "updated_at">) {
    await this.db.prepare("INSERT INTO branding (account_id,agency_name,logo_url,primary_color,accent_color,footer_text,website,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET agency_name=excluded.agency_name, logo_url=excluded.logo_url, primary_color=excluded.primary_color, accent_color=excluded.accent_color, footer_text=excluded.footer_text, website=excluded.website, updated_at=excluded.updated_at")
      .bind(accountId, b.agency_name, b.logo_url ?? null, b.primary_color, b.accent_color, b.footer_text ?? null, b.website ?? null, nowSec()).run();
  }
  async saveReport(id: string, accountId: string, keyId: string, title: string, pdfB64: string, ttlSec = 30 * 86400) {
    const t = nowSec();
    await this.db.prepare("INSERT INTO reports (id,account_id,key_id,title,pdf_b64,created_at,expires_at) VALUES (?,?,?,?,?,?,?)").bind(id, accountId, keyId, title, pdfB64, t, t + ttlSec).run();
  }
  async report(id: string) {
    const r = await this.db.prepare("SELECT * FROM reports WHERE id=?").bind(id).first<{ id: string; title: string; pdf_b64: string; expires_at: number }>();
    return r && r.expires_at > nowSec() ? r : null;
  }
}
export interface Branding { account_id: string; agency_name: string; logo_url: string | null; primary_color: string; accent_color: string; footer_text: string | null; website: string | null; updated_at: number }
