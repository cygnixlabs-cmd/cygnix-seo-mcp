// OAuth 2.1 bridge for clients that only speak OAuth (ChatGPT connectors, Claude custom connectors).
// The user authorizes by pasting their Cygnix API key (or creating a free one) on /oauth/authorize;
// the issued tokens are bound to that key, so metering and tiers are identical to Bearer API keys.
// Supports RFC 9728 protected-resource metadata, RFC 8414 AS metadata, RFC 7591 DCR, PKCE S256, refresh rotation.
// Seam: a future external IdP only needs a new Authenticator in auth.ts and updated metadata here.
import type { Store } from "./store.js";
import { baseUrl, type HostedEnv } from "./env.js";
import { json, apiError, escapeHtml, readBody, CORS_HEADERS } from "./http.js";
import { randomToken, sha256B64Url } from "./crypto.js";

export const ACCESS_TTL = 3600 * 24;       // 24 h
export const REFRESH_TTL = 3600 * 24 * 90;  // 90 days

export const protectedResourceMetadata = (env: HostedEnv) => ({
  resource: `${baseUrl(env)}/mcp`, authorization_servers: [baseUrl(env)], bearer_methods_supported: ["header"], scopes_supported: ["mcp"],
  resource_name: "Cygnix SEO MCP", resource_documentation: `${baseUrl(env)}/connect.html`,
});
export const authServerMetadata = (env: HostedEnv) => {
  const b = baseUrl(env);
  return { issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`, registration_endpoint: `${b}/oauth/register`,
    revocation_endpoint: `${b}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], scopes_supported: ["mcp"],
    service_documentation: `${b}/connect.html` };
};
const okRedirect = (u: unknown) => { if (typeof u !== "string") return false; try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname)) || /^[a-z][a-z0-9+.-]+:$/.test(x.protocol) && !["javascript:", "data:", "file:", "http:"].includes(x.protocol); } catch { return false; } };

export async function register(req: Request, store: Store) {
  const b = await readBody(req); const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(okRedirect)) return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or localhost) URLs" }, 400);
  const name = typeof b.client_name === "string" ? b.client_name.slice(0, 100) : "MCP client";
  const client_id = await store.registerClient(name, uris as string[]);
  return json({ client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "mcp" }, 201);
}

interface AuthzParams { client_id: string; redirect_uri: string; state: string; code_challenge: string; code_challenge_method: string; resource: string; scope: string; response_type: string }
const pick = (src: Record<string, unknown> | URLSearchParams, k: string) => String((src instanceof URLSearchParams ? src.get(k) : src[k]) ?? "");
async function validateAuthz(src: Record<string, unknown> | URLSearchParams, store: Store): Promise<{ p: AuthzParams } | { error: string }> {
  const p: AuthzParams = { client_id: pick(src, "client_id"), redirect_uri: pick(src, "redirect_uri"), state: pick(src, "state"), code_challenge: pick(src, "code_challenge"),
    code_challenge_method: pick(src, "code_challenge_method"), resource: pick(src, "resource"), scope: pick(src, "scope"), response_type: pick(src, "response_type") };
  const c = p.client_id ? await store.client(p.client_id) : null;
  if (!c) return { error: "Unknown client_id. Remove and re-add the connector so it can register again." };
  if (!c.redirect_uris.includes(p.redirect_uri)) return { error: "redirect_uri does not match the registered client." };
  if (p.response_type !== "code") return { error: "response_type must be code." };
  if (p.code_challenge_method !== "S256" || p.code_challenge.length < 43) return { error: "PKCE with S256 is required." };
  return { p };
}
const page = (env: HostedEnv, body: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Cygnix SEO MCP</title><link rel="stylesheet" href="${baseUrl(env)}/styles.css"></head><body class="auth"><main class="card">${body}</main></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
function form(env: HostedEnv, p: AuthzParams, clientName: string, err = "") {
  const hidden = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`).join("");
  return page(env, `<h1>Connect Cygnix SEO MCP</h1><p><strong>${escapeHtml(clientName)}</strong> wants to use your Cygnix SEO tools. Paste your API key to approve. Usage counts against that key's plan.</p>
${err ? `<p class="err">${escapeHtml(err)}</p>` : ""}<form method="post" action="${baseUrl(env)}/oauth/authorize">${hidden}<label>Cygnix API key<input name="api_key" type="password" autocomplete="off" placeholder="cyg_live_..." required></label><button type="submit">Approve</button></form>
<p class="muted">No key yet? <a href="${baseUrl(env)}/#signup" target="_blank" rel="noopener">Get a free key</a> (300 calls/month), then come back to this tab.</p>`, err ? 400 : 200);
}
export async function authorizeGet(req: Request, store: Store, env: HostedEnv) {
  const v = await validateAuthz(new URL(req.url).searchParams, store);
  if ("error" in v) return page(env, `<h1>Cannot connect</h1><p class="err">${escapeHtml(v.error)}</p>`, 400);
  return form(env, v.p, (await store.client(v.p.client_id))!.client_name);
}
export async function authorizePost(req: Request, store: Store, env: HostedEnv) {
  const b = await readBody(req); const v = await validateAuthz(b, store);
  if ("error" in v) return page(env, `<h1>Cannot connect</h1><p class="err">${escapeHtml(v.error)}</p>`, 400);
  const key = String(b.api_key ?? "").trim(); const ctx = key.startsWith("cyg_live_") ? await store.keyByPlaintext(key) : null;
  if (!ctx || ctx.revoked_at) return form(env, v.p, (await store.client(v.p.client_id))!.client_name, "That API key is not valid or was revoked.");
  const code = `cyg_code_${randomToken(32)}`;
  await store.saveCode(code, { client_id: v.p.client_id, key_id: ctx.key_id, redirect_uri: v.p.redirect_uri, code_challenge: v.p.code_challenge, resource: v.p.resource || null });
  const to = new URL(v.p.redirect_uri); to.searchParams.set("code", code); if (v.p.state) to.searchParams.set("state", v.p.state); to.searchParams.set("iss", baseUrl(env));
  return new Response(null, { status: 302, headers: { Location: to.toString(), "Cache-Control": "no-store" } });
}
const tokenErr = (error: string, d: string, status = 400) => json({ error, error_description: d }, status);
async function issue(store: Store, clientId: string, keyId: string) {
  const access = `cyg_at_${randomToken(40)}`, refresh = `cyg_rt_${randomToken(40)}`;
  await store.saveToken(access, "access", clientId, keyId, ACCESS_TTL); await store.saveToken(refresh, "refresh", clientId, keyId, REFRESH_TTL);
  return json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: "mcp" });
}
export async function token(req: Request, store: Store) {
  const b = await readBody(req); const grant = String(b.grant_type ?? ""); const clientId = String(b.client_id ?? "");
  if (grant === "authorization_code") {
    const c = await store.consumeCode(String(b.code ?? ""));
    if (!c) return tokenErr("invalid_grant", "Code is invalid, expired or already used.");
    if (c.client_id !== clientId || c.redirect_uri !== String(b.redirect_uri ?? "")) return tokenErr("invalid_grant", "client_id or redirect_uri mismatch.");
    if ((await sha256B64Url(String(b.code_verifier ?? ""))) !== c.code_challenge) return tokenErr("invalid_grant", "PKCE verification failed.");
    const k = await store.keyContext(c.key_id); if (!k || k.revoked_at) return tokenErr("invalid_grant", "API key was revoked.");
    return issue(store, c.client_id, c.key_id);
  }
  if (grant === "refresh_token") {
    const rt = String(b.refresh_token ?? ""); const t = await store.tokenLookup(rt, "refresh");
    if (!t || (clientId && t.client_id !== clientId)) return tokenErr("invalid_grant", "Refresh token is invalid or expired.");
    const k = await store.keyContext(t.key_id); if (!k || k.revoked_at) return tokenErr("invalid_grant", "API key was revoked.");
    await store.revokeToken(rt);
    return issue(store, t.client_id, t.key_id);
  }
  return tokenErr("unsupported_grant_type", "Use authorization_code or refresh_token.");
}
export async function revoke(req: Request, store: Store) { const b = await readBody(req); if (b.token) await store.revokeToken(String(b.token)); return new Response(null, { status: 200, headers: CORS_HEADERS }); }
export { apiError };
