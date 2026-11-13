// One-click Google Search Console connection (OAuth 2.0 web flow, offline access).
// Inert until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY are set.
// Refresh tokens are stored per API key, AES-256-GCM encrypted; access tokens are never stored.
import type { HostedEnv } from "./env.js";
import { baseUrl } from "./env.js";
import type { Store } from "./store.js";
import { decryptString, encryptString, hmacSha256Hex, randomToken, timingSafeEqual } from "./crypto.js";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const googleMissing = (env: HostedEnv) => ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].filter(k => !env[k]);
export const googleConfigured = (env: HostedEnv) => googleMissing(env).length === 0;
export const googleRedirectUri = (env: HostedEnv) => `${baseUrl(env)}/google/callback`;
export class GoogleError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export async function signState(env: HostedEnv, keyId: string, ttlSec = 900) {
  const body = `${keyId}.${Math.floor(Date.now() / 1000) + ttlSec}.${randomToken(12)}`;
  return `${body}.${await hmacSha256Hex(String(env.TOKEN_ENCRYPTION_KEY), `gstate:${body}`)}`;
}
export async function verifyState(env: HostedEnv, state: string): Promise<string | null> {
  const parts = state.split("."); if (parts.length !== 4) return null;
  const [keyId, exp, nonce, sig] = parts; const body = `${keyId}.${exp}.${nonce}`;
  if (!timingSafeEqual(sig, await hmacSha256Hex(String(env.TOKEN_ENCRYPTION_KEY), `gstate:${body}`))) return null;
  return Number(exp) >= Math.floor(Date.now() / 1000) ? keyId : null;
}
export async function connectUrl(env: HostedEnv, keyId: string) {
  const q = new URLSearchParams({ client_id: String(env.GOOGLE_CLIENT_ID), redirect_uri: googleRedirectUri(env), response_type: "code", scope: GSC_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: await signState(env, keyId) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export class GoogleClient {
  constructor(private env: HostedEnv, private store: Store, private fetchImpl: typeof fetch) {}
  private async tokenRequest(params: Record<string, string>) {
    const r = await this.fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: String(this.env.GOOGLE_CLIENT_ID), client_secret: String(this.env.GOOGLE_CLIENT_SECRET), ...params }).toString() });
    const j = await r.json().catch(() => ({})) as Record<string, string>;
    return { ok: r.ok, j };
  }
  /** OAuth callback: exchange code, store encrypted refresh token for the key named in the signed state. */
  async handleCallback(code: string, state: string): Promise<{ keyId: string }> {
    const keyId = await verifyState(this.env, state); if (!keyId) throw new GoogleError("bad_state", "This connect link expired or was tampered with. Ask the assistant for a new one (tool: gsc_connect).");
    const ctx = await this.store.keyContext(keyId); if (!ctx || ctx.revoked_at) throw new GoogleError("no_key", "API key not found or revoked.");
    const { ok, j } = await this.tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri(this.env) });
    if (!ok || !j.refresh_token) throw new GoogleError("exchange_failed", `Google did not return a refresh token (${j.error || "unknown"}). Try connecting again.`);
    if (!String(j.scope || "").includes(GSC_SCOPE)) throw new GoogleError("scope_denied", "Search Console read access was not granted.");
    await this.store.saveGoogle(keyId, ctx.id, await encryptString(String(this.env.TOKEN_ENCRYPTION_KEY), j.refresh_token), j.scope);
    return { keyId };
  }
  async accessToken(keyId: string): Promise<string> {
    const c = await this.store.google(keyId);
    if (!c) throw new GoogleError("not_connected", "Google Search Console is not connected for this key. Call gsc_connect and open the link.");
    const refresh = await decryptString(String(this.env.TOKEN_ENCRYPTION_KEY), c.refresh_token_enc);
    const { ok, j } = await this.tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
    if (!ok) {
      if (j.error === "invalid_grant") { await this.store.deleteGoogle(keyId); throw new GoogleError("not_connected", "Google access was revoked or expired. Call gsc_connect to reconnect."); }
      throw new GoogleError("google_error", `Google token refresh failed (${j.error || "unknown"}).`);
    }
    return j.access_token;
  }
  private async api<T>(keyId: string, url: string, body?: unknown): Promise<T> {
    const r = await this.fetchImpl(url, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${await this.accessToken(keyId)}`, "Content-Type": "application/json" } });
    const text = await r.text();
    if (!r.ok) throw new GoogleError("gsc_api", `Search Console API ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
  listSites(keyId: string) { return this.api<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(keyId, "https://www.googleapis.com/webmasters/v3/sites"); }
  searchAnalytics(keyId: string, siteUrl: string, body: Record<string, unknown>) {
    return this.api<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(keyId,
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body);
  }
  inspectUrl(keyId: string, siteUrl: string, inspectionUrl: string) {
    return this.api<any>(keyId, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { siteUrl, inspectionUrl });
  }
  async disconnect(keyId: string) {
    const c = await this.store.google(keyId); if (!c) return false;
    try { const t = await decryptString(String(this.env.TOKEN_ENCRYPTION_KEY), c.refresh_token_enc);
      await this.fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }); } catch { /* best effort */ }
    await this.store.deleteGoogle(keyId); return true;
  }
}
