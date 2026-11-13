// Runtime-agnostic HTTP app (Web Request -> Response). Used by the Cloudflare Worker and the Node dev server.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSeoServer, SERVER_VERSION } from "../server.js";
import { Store, StoreError, periodOf, periodResetIso, validEmail } from "./store.js";
import { authenticate, defaultAuthenticators, type Authenticator, type Principal } from "./auth.js";
import { TIERS, TIER_ORDER, PAID_TIERS, isTier, nextTier, type ProviderId } from "./tiers.js";
import { baseUrl, upgradeUrl, accountUrl, checkoutUrl, prepaidDays, type AppDeps } from "./env.js";
import { matchesHidden, hidePatterns, initClientInfo } from "./client-detect.js";
import { json, apiError, withCors, readBody, clientIp, CORS_HEADERS, escapeHtml } from "./http.js";
import { timingSafeEqual, b64decode } from "./crypto.js";
import * as oauth from "./oauth.js";
import { registerHostedTools } from "./mcp-tools.js";
import { providers, configuredProviders, defaultProvider, applyBillingUpdate, BillingError, providerOrder, providerSummary, activateOrder, grantPaid } from "./billing/index.js";
import type { Order } from "./store.js";
import { GoogleClient, GoogleError, connectUrl, googleConfigured, googleMissing } from "./google.js";

export const QUOTA_EXCEEDED = -32029;
export const RATE_LIMITED = -32028;
const instructions = (gsc: boolean, hide = false) => `Cygnix SEO tools: keyword clustering, search intent, keyword cannibalization (${gsc ? "pasted CSV or live Google Search Console via gsc_* tools" : "from a pasted Search Console CSV export; live Search Console connection is coming soon"}), title/meta CTR checks, content briefs, AI-search (AEO) readiness and llms.txt audits, and white-label PDF reports${hide ? " for agency accounts" : " on the Agency plan"}. Each tools/call counts toward the key's monthly quota; call account_status to see usage.`;

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
    return { account: { id: a.id, email: a.email, tier: a.tier, status: a.status, billing: { provider: a.billing_provider, status: a.billing_status, paid_through: a.paid_through,
        paid_through_iso: a.paid_through ? new Date(a.paid_through * 1000).toISOString() : null, prepaid: a.billing_status === "prepaid" } },
      plan: { name: t.name, price_usd_monthly: t.priceUsdMonthly, monthly_calls: t.monthlyCalls, per_minute: t.perMinute, max_keys: t.maxKeys, white_label_reports: t.whiteLabelReports },
      usage: { period: periodOf(), calls: used, remaining: Math.max(0, t.monthlyCalls - used), resets_at: periodResetIso(), by_key: await store.usageByKey(a.id) },
      keys: await store.listKeys(a.id), upgrade_url: upgradeUrl(env), checkout_url: checkoutUrl(env), account_url: accountUrl(env) };
  }
  /** Hide prices / upgrade CTAs for clients matching HIDE_PRICES_FOR_CLIENTS (default ChatGPT/OpenAI). See client-detect.ts. */
  async function hidePricesFor(req: Request, p: Principal, initInfo: string | null): Promise<boolean> {
    if (!hidePatterns(env).length) return false;
    if (matchesHidden(env, [req.headers.get("user-agent"), initInfo])) return true;
    if (p.oauthClientId) { const c = await store.client(p.oauthClientId); return matchesHidden(env, [c?.client_name, c?.last_client_info]); }
    return matchesHidden(env, [await store.keyClientHint(p.keyId)]);
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
    const initInfo = initClientInfo(msgs as never);
    if (initInfo) await store.setClientHint({ oauthClientId: p.oauthClientId, keyId: p.via === "api_key" ? p.keyId : null }, initInfo);
    const hide = await hidePricesFor(req, p, initInfo);
    const links = hide ? { account_url: accountUrl(env) } : { upgrade_url: upgradeUrl(env) };
    if (rl.hits > tier.perMinute) {
      const id = msgs.find(m => m.id !== undefined)?.id ?? null;
      const msg = hide ? `Rate limit: ${tier.perMinute} requests/minute on this key's current plan. Retry in ${rl.resetSec}s.` : `Rate limit: ${tier.perMinute} requests/minute on the ${tier.name} plan. Retry in ${rl.resetSec}s.`;
      return json(rpcError(id, RATE_LIMITED, msg, { retry_after: rl.resetSec, tier: tier.id, ...links }), 429, { "Retry-After": String(rl.resetSec) });
    }
    const calls = msgs.filter(m => m.method === "tools/call");
    let used = await store.accountUsage(p.accountId);
    for (const m of calls) {
      used = await store.incrementUsage(p.keyId, p.accountId);
      if (used > tier.monthlyCalls) {
        await store.decrementUsage(p.keyId);
        const nt = nextTier(tier.id);
        const msg = hide
          ? `Monthly quota reached: this key's current plan includes ${tier.monthlyCalls.toLocaleString("en-US")} tool calls a month (resets ${periodResetIso()}). See your account page: ${accountUrl(env)}`
          : `Monthly quota reached: ${tier.monthlyCalls.toLocaleString("en-US")} tool calls on the ${tier.name} plan (resets ${periodResetIso()}). ` +
            (nt ? `Upgrade to ${nt.name} ($${nt.priceUsdMonthly}/mo, ${nt.monthlyCalls.toLocaleString("en-US")} calls): ${upgradeUrl(env)}` : `Contact info@cygnixlabs.com for a custom plan.`);
        const errs = calls.map(c => rpcError(c.id, QUOTA_EXCEEDED, msg, { tier: tier.id, limit: tier.monthlyCalls, used: tier.monthlyCalls, resets_at: periodResetIso(), ...links }));
        void m; return json(Array.isArray(body) ? errs : errs[0], 200, { "X-Cygnix-Quota-Limit": String(tier.monthlyCalls), "X-Cygnix-Quota-Remaining": "0" });
      }
    }
    await store.touchKey(p.keyId);
    const server = createSeoServer({ instructions: instructions(googleConfigured(env), hide), hideUpsell: hide });
    registerHostedTools(server, { principal: p, store, env, fetchImpl, webFetch, hidePrices: hide });
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
    const ok = configuredProviders(billing, env);
    const want = (typeof b.provider === "string" && b.provider ? b.provider : null) ?? defaultProvider(env, billing);
    if (!want || !ok.includes(want)) return apiError(503, "billing_not_configured", ok.length ? `Provider unavailable. Available: ${ok.join(", ")}` : "Paid plans are not open yet. Email info@cygnixlabs.com to get early access.", { available: ok });
    const a = (await store.account(p.accountId))!; const prov = billing[want];
    let order: Order | undefined;
    if (prov.kind !== "subscription") {
      const open = (await store.listOrders({ accountId: a.id, status: "pending", limit: 50 })).length;
      if (open >= 5) return apiError(429, "too_many_orders", "You have 5 unpaid orders. Pay or wait for one to be cancelled first.");
      order = await store.createOrder({ accountId: a.id, provider: want, tier, amountUsd: TIERS[tier].priceUsdMonthly, periodDays: prepaidDays(env) });
    }
    try {
      const r = await prov.createCheckout(a, tier, { successUrl: order ? `${base()}/pay/${order.id}` : `${base()}/thanks.html?tier=${tier}`, cancelUrl: checkoutUrl(env),
        orderUrl: order ? `${base()}/pay/${order.id}` : undefined, webhookUrl: `${base()}/webhooks/${want}` }, order);
      if (order && r.externalId) await store.updateOrder(order.id, { externalId: r.externalId });
      return json({ provider: r.provider, kind: prov.kind, url: r.url, reference: r.reference ?? null, order_id: order?.id ?? null,
        ...(order ? { amount_usd: order.amount_usd, period_days: order.period_days } : {}) });
    } catch (e) { if (order) await store.updateOrder(order.id, { status: "failed", note: (e as Error).message.slice(0, 200) }); throw e; }
  }
  async function manage(p: Principal) {
    const a = (await store.account(p.accountId))!;
    if (a.billing_status === "prepaid") return apiError(404, "prepaid", `Prepaid plan (no subscription to cancel). It ends ${a.paid_through ? new Date(a.paid_through * 1000).toISOString().slice(0, 10) : "soon"}; renew any time at ${checkoutUrl(env)}.`);
    if (!a.billing_provider || !(a.billing_provider in billing)) return apiError(404, "no_subscription", "No paid subscription on this account.");
    const url = await billing[a.billing_provider as ProviderId].manageUrl(a, `${base()}/`);
    return url ? json({ provider: a.billing_provider, url }) : apiError(404, "no_portal", "Manage this subscription from your provider account.");
  }
  async function webhook(req: Request, provider: ProviderId) {
    const prov = billing[provider]; if (!prov || !prov.parseWebhook) return apiError(404, "not_found", "Unknown webhook");
    if (prov.missingEnv().length) return apiError(503, "billing_not_configured", `${provider} is not configured`);
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
    const seg = path.split("/").filter(Boolean).slice(1).map(s => { try { return decodeURIComponent(s); } catch { return s; } }); // after "admin"
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
    if (seg[0] === "accounts" && seg[1] && seg[2] === "grant") { /* manual activation for any gateway */
      const a = (await store.account(seg[1])) ?? (await store.accountByEmail(seg[1])); if (!a) return apiError(404, "no_account", "Account not found");
      if (!isTier(b.tier) || b.tier === "free") return apiError(400, "bad_tier", `tier must be ${PAID_TIERS.join("|")}`);
      const days = b.days === undefined ? undefined : Number(b.days); if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 400)) return apiError(400, "bad_days", "days must be 1-400");
      const r = await grantPaid(store, env, { accountId: a.id, tier: b.tier, provider: String(b.provider ?? "manual").slice(0, 40), days, reference: b.reference ? String(b.reference).slice(0, 200) : null,
        amountUsd: b.amount_usd !== undefined ? Number(b.amount_usd) : undefined });
      return json({ ...r, account: await accountView(a.id) });
    }
    if (seg[0] === "orders" && seg.length === 1 && req.method === "GET") { const q = new URL(req.url).searchParams; return json({ orders: await store.listOrders({ status: q.get("status") ?? undefined, limit: Number(q.get("limit") ?? 100) }) }); }
    if (seg[0] === "orders" && seg[1]) {
      const o = await store.order(seg[1]); if (!o) return apiError(404, "no_order", "Order not found");
      if (seg.length === 2 && req.method === "GET") return json({ order: o });
      if (seg[2] === "activate" && req.method === "POST") {
        if (!(await store.markOrderPaid(o.id))) return apiError(409, "not_pending", `Order is ${o.status}`);
        if (b.reference) await store.updateOrder(o.id, { payerReference: String(b.reference).slice(0, 200) });
        const r = await activateOrder(store, (await store.order(o.id))!);
        return json({ order: await store.order(o.id), ...r });
      }
      if (seg[2] === "cancel" && req.method === "POST") {
        if (o.status !== "pending") return apiError(409, "not_pending", `Order is ${o.status}`);
        return json({ order: await store.updateOrder(o.id, { status: "cancelled", note: b.note ? String(b.note).slice(0, 200) : "cancelled by admin" }) });
      }
    }
    if (seg[0] === "keys" && seg[1] && seg[2] === "revoke") return json({ key: await store.revokeKey(seg[1]) });
    if (seg[0] === "keys" && seg[1] && seg[2] === "rotate") { const k = await store.rotateKey(seg[1]); return json({ api_key: k.key, key: k.row }); }
    return apiError(404, "not_found", "Unknown admin route");
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url); const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (path === "/mcp") return mcp(req);
    if (path === "/health") return json({ ok: true, version: SERVER_VERSION, billing: Object.fromEntries(providerOrder(env).map(id => [id, billing[id].missingEnv().length === 0])), google_oauth: googleConfigured(env) });
    if (path === "/.well-known/openai-apps-challenge") return env.OPENAI_APPS_CHALLENGE
      ? new Response(String(env.OPENAI_APPS_CHALLENGE).trim(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }) : apiError(404, "not_found", "Not found");
    if (path === "/.well-known/mcp/server-card.json") return json(await serverCard());
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json(oauth.protectedResourceMetadata(env));
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) return json(oauth.authServerMetadata(env));
    if (path === "/oauth/register" && req.method === "POST") return oauth.register(req, store);
    if (path === "/oauth/authorize") return req.method === "POST" ? oauth.authorizePost(req, store, env) : oauth.authorizeGet(req, store, env);
    if (path === "/oauth/token" && req.method === "POST") return oauth.token(req, store);
    if (path === "/oauth/revoke" && req.method === "POST") return oauth.revoke(req, store);
    if (path === "/v1/plans") return json({ tiers: TIER_ORDER.map(t => ({ ...TIERS[t], planEnv: undefined })), billing_providers: configuredProviders(billing, env),
      providers: providerSummary(billing, env), default_provider: defaultProvider(env, billing), prepaid_period_days: prepaidDays(env) });
    if (path === "/v1/signup" && req.method === "POST") return signup(req);
    const wh = path.match(/^\/webhooks\/([a-z][a-z0-9_]{1,30})$/); if (wh && req.method === "POST") return webhook(req, wh[1]);
    const pay = path.match(/^\/pay\/(ord_[A-Za-z0-9]{24})$/); if (pay) return orderPage(req, pay[1]);
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
      if (path === "/v1/billing/orders" && req.method === "GET") return json({ orders: (await store.listOrders({ accountId: p.accountId, limit: 50 })).map(o => ({ ...o, pay_url: `${base()}/pay/${o.id}` })) });
      if (path === "/v1/google/connect" && req.method === "POST") {
        if (!googleConfigured(env)) return apiError(503, "google_not_configured", "Search Console connection is not enabled yet.", { missing: googleMissing(env) });
        return json({ url: await connectUrl(env, p.keyId) });
      }
      if (path === "/v1/google" && req.method === "DELETE") return json({ disconnected: await new GoogleClient(env, store, fetchImpl).disconnect(p.keyId) });
    }
    return apiError(404, "not_found", "Not found");
  }
  /** Static metadata (SEP-1649 server card) so directory scanners can list tools without an API key. */
  let card: unknown = null;
  async function serverCard() {
    if (card) return card;
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const server = createSeoServer({ instructions: instructions(googleConfigured(env)) });
    const demo: Principal = { accountId: "card", keyId: "card", tier: "agency", email: "card@local", status: "active", via: "api_key", account: {} as never };
    registerHostedTools(server, { principal: demo, store, env, fetchImpl, webFetch });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
    const client = new Client({ name: "card", version: "1" }); await client.connect(b);
    const { tools } = await client.listTools(); await client.close(); await server.close();
    card = { serverInfo: { name: "Cygnix SEO MCP", version: SERVER_VERSION }, authentication: { required: true, schemes: ["oauth2", "bearer"] },
      documentation: `${base()}/connect.html`, tools, resources: [], prompts: [] };
    return card;
  }
  /** Order page for one-time / manual payments: instructions + "I've paid" reference form. The 24-char random id is the capability. */
  async function orderPage(req: Request, id: string): Promise<Response> {
    const html = (t: string, s = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Order ${escapeHtml(id)}: Cygnix SEO MCP</title><link rel="stylesheet" href="/styles.css"></head><body class="auth"><main class="card">${t}<p class="muted"><a href="/account.html">Your account</a> · Questions: <a href="mailto:info@cygnixlabs.com?subject=Order%20${escapeHtml(id)}">info@cygnixlabs.com</a> (quote ${escapeHtml(id)})</p></main></body></html>`,
      { status: s, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
    let o = await store.order(id); if (!o) return html("<h1>Order not found</h1>", 404);
    let notice = "";
    if (req.method === "POST") {
      const rl = await store.hit(`proof:${clientIp(req)}`, 3600); if (rl.hits > 20) return html("<h1>Too many submissions</h1><p>Try again later.</p>", 429);
      const ref = String((await readBody(req)).reference ?? "").trim().slice(0, 200);
      if (o.status === "pending" && ref) { o = (await store.updateOrder(o.id, { payerReference: ref }))!; notice = `<p class="ok">Thanks, reference received. We'll switch your plan on once the payment is confirmed.</p>`; }
    }
    const a = (await store.account(o.account_id))!; const prov = billing[o.provider];
    const head = `<h1>${escapeHtml(TIERS[o.tier].name)} plan: $${o.amount_usd.toFixed(2)} USD</h1><p>Order reference <code>${escapeHtml(o.id)}</code> · ${o.period_days} days · status <strong>${escapeHtml(o.status)}</strong></p>`;
    if (o.status === "paid") return html(`${head}<p class="ok">Paid. Your plan is active on every key of this account; no need to reconnect.</p>`);
    if (o.status !== "pending") return html(`${head}<p>This order is ${escapeHtml(o.status)}. Start a new one from the <a href="/checkout.html">checkout page</a>.</p>`);
    if (!prov?.instructions) return html(`${head}<p>Waiting for the payment provider to confirm. This page updates when it does; refresh in a minute.</p>`);
    const i = prov.instructions(o, a);
    return html(`${head}${notice}<h2>${escapeHtml(i.title)}</h2><ol>${i.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>` +
      (i.link ? `<p><a class="btn" href="${escapeHtml(i.link.href)}" target="_blank" rel="noopener">${escapeHtml(i.link.label)}</a></p>` : "") +
      (i.fields?.length ? `<table>${i.fields.map(f => `<tr><th>${escapeHtml(f.label)}</th><td><code>${escapeHtml(f.value)}</code></td></tr>`).join("")}</table>` : "") +
      `<form method="post"><label>${escapeHtml(i.referenceHint)}<input name="reference" maxlength="200" autocomplete="off" value="${escapeHtml(o.payer_reference ?? "")}"></label><button type="submit">I've paid</button></form>`);
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
