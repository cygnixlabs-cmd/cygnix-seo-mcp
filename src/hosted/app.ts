// Runtime-agnostic HTTP app (Web Request -> Response). Used by the Cloudflare Worker and the Node dev server.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSeoServer, SERVER_VERSION } from "../server.js";
import { Store, StoreError, periodOf, periodResetIso, validEmail } from "./store.js";
import { authenticate, defaultAuthenticators, type Authenticator, type Principal } from "./auth.js";
import { TIERS, TIER_ORDER, PAID_TIERS, isTier, nextTier, type ProviderId } from "./tiers.js";
import { baseUrl, upgradeUrl, type AppDeps } from "./env.js";
import { json, apiError, withCors, readBody, clientIp, CORS_HEADERS, escapeHtml } from "./http.js";
import { timingSafeEqual, b64decode } from "./crypto.js";
import * as oauth from "./oauth.js";
import { registerHostedTools } from "./mcp-tools.js";
import { providers, configuredProviders, defaultProvider, applyBillingUpdate, BillingError, PROVIDER_ORDER } from "./billing/index.js";
import { GoogleClient, GoogleError, connectUrl, googleConfigured, googleMissing } from "./google.js";

export const QUOTA_EXCEEDED = -32029;
export const RATE_LIMITED = -32028;
const INSTRUCTIONS = "Cygnix SEO tools: keyword clustering, search intent, cannibalization (pasted CSV or live Google Search Console), title/meta CTR checks, content briefs, AI-search (AEO) readiness and llms.txt audits, and white-label PDF reports on the Agency plan. Each tools/call counts toward the key's monthly quota; call account_status to see usage.";

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string };
const rpcError = (id: JsonRpc["id"], code: number, message: string, data: Record<string, unknown>) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, data } });

export function createApp(deps: AppDeps) {
  const store = new Store(deps.db); const env = deps.env; const fetchImpl = deps.fetchImpl ?? fetch; const webFetch = deps.webFetch ?? fetch;
  const chain: Authenticator[] = defaultAuthenticators(store);
  const billing = providers(env, fetchImpl);
  const base = () => baseUrl(env);

  const unauthorized = (msg = "Missing or invalid API key. Send Authorization: Bearer cyg_live_... (get a free key at " + base() + "/#signup).") =>
    apiError(401, "unauthorized", msg, {}, { "WWW-Authenticate": `Bearer realm="cygnix", resource_metadata="${base()}/.well-known/oauth-protected-resource"` });
  async function requireUser(req: Request): Promise<Principal | Response> {
    const p = await authenticate(req, chain); if (!p) return unauthorized();
    if (p.status !== "active") return apiError(403, "suspended", "This account is suspended. Contact info@cygnixlabs.com.");
    return p;
  }
  function requireAdmin(req: Request): Response | null {
    if (!env.ADMIN_TOKEN) return apiError(404, "not_found", "Not found");
    const t = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    return timingSafeEqual(t, String(env.ADMIN_TOKEN)) ? null : apiError(401, "unauthorized", "Bad admin token");
  }
  async function accountView(accountId: string) {
    const a = (await store.account(accountId))!; const t = TIERS[a.tier]; const used = await store.accountUsage(a.id);
    return { account: { id: a.id, email: a.email, tier: a.tier, status: a.status, billing: { provider: a.billing_provider, status: a.billing_status, paid_through: a.paid_through } },
      plan: { name: t.name, price_usd_monthly: t.priceUsdMonthly, monthly_calls: t.monthlyCalls, per_minute: t.perMinute, max_keys: t.maxKeys, white_label_reports: t.whiteLabelReports },
      usage: { period: periodOf(), calls: used, remaining: Math.max(0, t.monthlyCalls - used), resets_at: periodResetIso(), by_key: await store.usageByKey(a.id) },
      keys: await store.listKeys(a.id), upgrade_url: upgradeUrl(env) };
  }

  // ---------------- MCP endpoint ----------------
  async function mcp(req: Request): Promise<Response> {
    if (req.method === "GET" || req.method === "DELETE") return apiError(405, "method_not_allowed", "This server is stateless: POST JSON-RPC to /mcp.", {}, { Allow: "POST, OPTIONS" });
    if (req.method !== "POST") return apiError(405, "method_not_allowed", "POST only", {}, { Allow: "POST, OPTIONS" });
    const p = await requireUser(req); if (p instanceof Response) return p;
    const tier = TIERS[p.tier];
    const rl = await store.hit(`acct:${p.accountId}`, 60);
    let body: unknown; try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error", {}), 400); }
    const msgs = (Array.isArray(body) ? body : [body]) as JsonRpc[];
    if (rl.hits > tier.perMinute) {
      const id = msgs.find(m => m.id !== undefined)?.id ?? null;
      return json(rpcError(id, RATE_LIMITED, `Rate limit: ${tier.perMinute} requests/minute on the ${tier.name} plan. Retry in ${rl.resetSec}s.`, { retry_after: rl.resetSec, tier: tier.id, upgrade_url: upgradeUrl(env) }), 429, { "Retry-After": String(rl.resetSec) });
    }
    const calls = msgs.filter(m => m.method === "tools/call");
    let used = await store.accountUsage(p.accountId);
    for (const m of calls) {
      used = await store.incrementUsage(p.keyId, p.accountId);
      if (used > tier.monthlyCalls) {
        await store.decrementUsage(p.keyId);
        const nt = nextTier(tier.id);
        const msg = `Monthly quota reached: ${tier.monthlyCalls.toLocaleString("en-US")} tool calls on the ${tier.name} plan (resets ${periodResetIso()}). ` +
          (nt ? `Upgrade to ${nt.name} ($${nt.priceUsdMonthly}/mo, ${nt.monthlyCalls.toLocaleString("en-US")} calls): ${upgradeUrl(env)}` : `Contact info@cygnixlabs.com for a custom plan.`);
        const errs = calls.map(c => rpcError(c.id, QUOTA_EXCEEDED, msg, { tier: tier.id, limit: tier.monthlyCalls, used: tier.monthlyCalls, resets_at: periodResetIso(), upgrade_url: upgradeUrl(env) }));
        void m; return json(Array.isArray(body) ? errs : errs[0], 200, { "X-Cygnix-Quota-Limit": String(tier.monthlyCalls), "X-Cygnix-Quota-Remaining": "0" });
      }
    }
    await store.touchKey(p.keyId);
    const server = createSeoServer({ instructions: INSTRUCTIONS });
    registerHostedTools(server, { principal: p, store, env, fetchImpl, webFetch });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(req, { parsedBody: body, authInfo: { token: "redacted", clientId: p.keyId, scopes: ["mcp"], extra: { accountId: p.accountId, tier: p.tier } } });
      const h = new Headers(res.headers); h.set("X-Cygnix-Quota-Limit", String(tier.monthlyCalls)); h.set("X-Cygnix-Quota-Remaining", String(Math.max(0, tier.monthlyCalls - used)));
      return withCors(new Response(res.body, { status: res.status, headers: h }));
    } finally { void server.close(); }
  }

  // ---------------- REST API ----------------
  async function signup(req: Request) {
    const max = Number(env.SIGNUP_PER_IP_PER_HOUR ?? 5);
    const rl = await store.hit(`signup:${clientIp(req)}`, 3600);
    if (rl.hits > max) return apiError(429, "rate_limited", "Too many signups from this address. Try again later.", {}, { "Retry-After": String(rl.resetSec) });
    const b = await readBody(req);
    if (!validEmail(b.email)) return apiError(400, "bad_email", "A valid email is required.");
    if (b.accept_terms !== true && b.accept_terms !== "true" && b.accept_terms !== "on") return apiError(400, "terms_required", "Accept the Terms of Service to create a key (accept_terms: true).");
    const acct = await store.createAccount(b.email as string, "free");
    const { key } = await store.createKey(acct.id, "default");
    return json({ account_id: acct.id, tier: "free", api_key: key, mcp_url: `${base()}/mcp`, monthly_calls: TIERS.free.monthlyCalls,
      note: "Store this key now; it is shown only once. Connect guide: " + `${base()}/connect.html` }, 201);
  }
  async function checkout(req: Request, p: Principal) {
    const b = await readBody(req); const tier = b.tier;
    if (!isTier(tier) || !PAID_TIERS.includes(tier)) return apiError(400, "bad_tier", `tier must be one of ${PAID_TIERS.join(", ")}`);
    const ok = configuredProviders(billing);
    const want = (b.provider as ProviderId | undefined) ?? defaultProvider(env, billing);
    if (!want || !ok.includes(want)) return apiError(503, "billing_not_configured", ok.length ? `Provider unavailable. Available: ${ok.join(", ")}` : "Paid plans are not open yet. Email info@cygnixlabs.com to get early access.", { available: ok });
    const a = (await store.account(p.accountId))!;
    const r = await billing[want].createCheckout(a, tier, { successUrl: `${base()}/thanks.html?tier=${tier}`, cancelUrl: `${base()}/#pricing` });
    return json({ provider: r.provider, url: r.url, reference: r.reference ?? null });
  }
  async function manage(p: Principal) {
    const a = (await store.account(p.accountId))!;
    if (!a.billing_provider || !(a.billing_provider in billing)) return apiError(404, "no_subscription", "No paid subscription on this account.");
    const url = await billing[a.billing_provider as ProviderId].manageUrl(a, `${base()}/`);
    return url ? json({ provider: a.billing_provider, url }) : apiError(404, "no_portal", "Manage this subscription from your provider account.");
  }
  async function webhook(req: Request, provider: ProviderId) {
    const prov = billing[provider]; if (!prov || prov.missingEnv().length) return apiError(503, "billing_not_configured", `${provider} is not configured`);
    const raw = await req.text();
    const updates = await prov.parseWebhook(raw, req.headers);
    if (updates === null) return apiError(400, "bad_signature", "Webhook verification failed");
    const results: string[] = [];
    for (const u of updates) {
      const evKey = `${u.provider}:${u.eventId}`;
      if (!(await store.markEvent(evKey, u.eventType))) { results.push("duplicate"); continue; }
      try { results.push(await applyBillingUpdate(store, env, u)); } catch (e) { await store.unmarkEvent(evKey); throw e; }
    }
    return json({ received: true, results });
  }

  async function admin(req: Request, path: string): Promise<Response> {
    const deny = requireAdmin(req); if (deny) return deny;
    const seg = path.split("/").filter(Boolean).slice(1); // after "admin"
    const b = req.method === "POST" ? await readBody(req) : {};
    if (seg[0] === "accounts" && seg.length === 1) {
      if (req.method === "GET") return json({ accounts: await store.listAccounts(Number(new URL(req.url).searchParams.get("limit") ?? 100)) });
      if (!validEmail(b.email)) return apiError(400, "bad_email", "email required");
      const tier = isTier(b.tier) ? b.tier : "free"; const a = await store.createAccount(b.email as string, tier);
      const k = await store.createKey(a.id, String(b.label ?? "default"), { enforceLimit: false });
      return json({ account: a, api_key: k.key, key_id: k.row.id }, 201);
    }
    if (seg[0] === "accounts" && seg[1]) {
      const a = (await store.account(seg[1])) ?? (await store.accountByEmail(seg[1])); if (!a) return apiError(404, "no_account", "Account not found");
      if (seg.length === 2 && req.method === "GET") return json(await accountView(a.id));
      if (seg[2] === "tier") { if (!isTier(b.tier)) return apiError(400, "bad_tier", `tier must be ${TIER_ORDER.join("|")}`); await store.setTier(a.id, b.tier); return json(await accountView(a.id)); }
      if (seg[2] === "suspend" || seg[2] === "unsuspend") { await store.setStatus(a.id, seg[2] === "suspend" ? "suspended" : "active"); return json(await accountView(a.id)); }
      if (seg[2] === "keys") { const k = await store.createKey(a.id, b.label ? String(b.label) : undefined, { enforceLimit: false }); return json({ api_key: k.key, key: k.row }, 201); }
    }
    if (seg[0] === "keys" && seg[1] && seg[2] === "revoke") return json({ key: await store.revokeKey(seg[1]) });
    if (seg[0] === "keys" && seg[1] && seg[2] === "rotate") { const k = await store.rotateKey(seg[1]); return json({ api_key: k.key, key: k.row }); }
    return apiError(404, "not_found", "Unknown admin route");
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url); const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (path === "/mcp") return mcp(req);
    if (path === "/health") return json({ ok: true, version: SERVER_VERSION, billing: Object.fromEntries(PROVIDER_ORDER.map(id => [id, billing[id].missingEnv().length === 0])), google_oauth: googleConfigured(env) });
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json(oauth.protectedResourceMetadata(env));
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) return json(oauth.authServerMetadata(env));
    if (path === "/oauth/register" && req.method === "POST") return oauth.register(req, store);
    if (path === "/oauth/authorize") return req.method === "POST" ? oauth.authorizePost(req, store, env) : oauth.authorizeGet(req, store, env);
    if (path === "/oauth/token" && req.method === "POST") return oauth.token(req, store);
    if (path === "/oauth/revoke" && req.method === "POST") return oauth.revoke(req, store);
    if (path === "/v1/plans") return json({ tiers: TIER_ORDER.map(t => ({ ...TIERS[t], planEnv: undefined })), billing_providers: configuredProviders(billing) });
    if (path === "/v1/signup" && req.method === "POST") return signup(req);
    const wh = path.match(/^\/webhooks\/(paypal|whop|stripe)$/); if (wh && req.method === "POST") return webhook(req, wh[1] as ProviderId);
    if (path === "/google/callback") return googleCallback(url);
    const rep = path.match(/^\/reports\/(rpt_[A-Za-z0-9]+)\.pdf$/);
    if (rep) { const r = await store.report(rep[1]); if (!r) return apiError(404, "not_found", "Report not found or expired");
      return new Response(b64decode(r.pdf_b64) as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.title.replace(/[^\w.-]+/g, "-").slice(0, 60)}.pdf"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } }); }
    if (path.startsWith("/admin/")) return admin(req, path);
    if (path.startsWith("/v1/")) {
      const p = await requireUser(req); if (p instanceof Response) return p;
      if (path === "/v1/account" && req.method === "GET") return json(await accountView(p.accountId));
      if (path === "/v1/keys" && req.method === "GET") return json({ keys: await store.listKeys(p.accountId) });
      if (path === "/v1/keys" && req.method === "POST") { const b = await readBody(req); const k = await store.createKey(p.accountId, b.label ? String(b.label).slice(0, 60) : undefined); return json({ api_key: k.key, key: k.row }, 201); }
      const km = path.match(/^\/v1\/keys\/(key_[A-Za-z0-9]+)(\/rotate)?$/);
      if (km && req.method === "DELETE" && !km[2]) return json({ key: await store.revokeKey(km[1], p.accountId) });
      if (km && req.method === "POST" && km[2]) { const k = await store.rotateKey(km[1], p.accountId); return json({ api_key: k.key, key: k.row }); }
      if (path === "/v1/billing/checkout" && req.method === "POST") return checkout(req, p);
      if (path === "/v1/billing/manage" && req.method === "POST") return manage(p);
      if (path === "/v1/google/connect" && req.method === "POST") {
        if (!googleConfigured(env)) return apiError(503, "google_not_configured", "Search Console connection is not enabled yet.", { missing: googleMissing(env) });
        return json({ url: await connectUrl(env, p.keyId) });
      }
      if (path === "/v1/google" && req.method === "DELETE") return json({ disconnected: await new GoogleClient(env, store, fetchImpl).disconnect(p.keyId) });
    }
    return apiError(404, "not_found", "Not found");
  }
  async function googleCallback(url: URL) {
    const html = (t: string, s = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body class="auth"><main class="card">${t}</main>`, { status: s, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (!googleConfigured(env)) return html("<h1>Not available</h1><p>Search Console connection is not enabled yet.</p>", 503);
    if (url.searchParams.get("error")) return html(`<h1>Not connected</h1><p>Google returned: ${escapeHtml(url.searchParams.get("error")!)}</p>`, 400);
    try { await new GoogleClient(env, store, fetchImpl).handleCallback(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
      return html("<h1>Search Console connected</h1><p>You can close this tab and go back to your assistant. Try: “list my Search Console sites”.</p>");
    } catch (e) { return html(`<h1>Not connected</h1><p class="err">${escapeHtml((e as Error).message)}</p>`, e instanceof GoogleError ? 400 : 500); }
  }

  return async function handle(req: Request): Promise<Response> {
    try { return await route(req); }
    catch (e) {
      if (e instanceof StoreError || e instanceof BillingError) return apiError(e.status, e.code, e.message);
      console.error("unhandled", e); return apiError(500, "internal", "Internal error");
    }
  };
}
