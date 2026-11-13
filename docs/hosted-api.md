# Hosted API reference

Base URL: `https://mcp.cygnixlabs.com` (local: `http://localhost:8787`).

## MCP
`POST /mcp`: MCP Streamable HTTP, stateless, JSON responses (`enableJsonResponse`). `GET`/`DELETE` return 405, since there are no sessions.
Auth: `Authorization: Bearer cyg_live_…`, `X-Api-Key: cyg_live_…`, or an OAuth access token `cyg_at_…`.
Without auth: `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

| Situation | Response |
|---|---|
| Monthly quota used up | HTTP 200, JSON-RPC error `-32029`. The message has the limit, reset date and upgrade link. `error.data` = `{tier, limit, used, resets_at, upgrade_url}`. The call is not counted and the tool does not run. |
| Per-minute limit | HTTP 429, `Retry-After`, JSON-RPC error `-32028` |
| Every metered response | `X-Cygnix-Quota-Limit`, `X-Cygnix-Quota-Remaining` |

Only `tools/call` is metered. `initialize`, `tools/list` and `ping` are free but count toward the per-minute limit.

### Tools
Core (same as stdio): `cluster_keywords`, `classify_search_intent`, `find_keyword_cannibalization`, `check_title_meta`, `content_brief_outline`.
Hosted: `account_status`, `check_ai_search_readiness`, `check_llms_txt`, `set_report_branding` + `create_white_label_report` (Agency).
These appear only when Google OAuth is configured: `gsc_connect`, `gsc_list_sites`, `gsc_search_analytics`, `gsc_find_cannibalization`, `gsc_inspect_url`, `gsc_disconnect`.

## Tiers
| Tier | $/mo | Tool calls/mo (pooled per account) | Req/min | Keys | White-label PDF |
|---|---|---|---|---|---|
| Free | 0 | 300 | 10 | 1 | – |
| Pro | 15 | 5,000 | 60 | 3 | – |
| Growth | 39 | 25,000 | 120 | 10 | – |
| Agency | 99 | 100,000 | 300 | 50 | yes |

How these were sized: Free is about 10 calls/day, enough to try every tool on one site. Pro covers a solo SEO's daily use (~150–250 calls/day). Growth is 5× Pro for teams. Agency is 4× Growth, with one key per client and branded reports. Every call costs us very little (deterministic tools, or one Google API request), so the quotas mainly protect against abuse. For comparison, Advanced GSC MCP sells at $15 / $40 / $105.

## REST
| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/signup` `{email, accept_terms:true}` | none (5/hour/IP) | Create a Free account + key (shown once) |
| `GET /v1/account` | key | Plan, usage this month (total + per key), keys |
| `GET /v1/keys` · `POST /v1/keys {label}` | key | List / create (limited by tier) |
| `DELETE /v1/keys/:id` · `POST /v1/keys/:id/rotate` | key | Revoke / rotate (also revokes the key's OAuth tokens) |
| `POST /v1/billing/checkout {tier, provider?}` | key | Returns `{provider, kind, url, order_id?}`. Subscription providers: the hosted checkout. Invoice/manual providers: a pending order is created first; `url` is the crypto invoice or `/pay/<order>`. 503 until a provider is configured; disabled providers are refused. Max 5 unpaid orders per account |
| `POST /v1/billing/manage` | key | Provider link to manage or cancel (404 `prepaid` for one-time plans) |
| `GET /v1/billing/orders` | key | This account's one-time/manual orders with `pay_url` |
| `GET|POST /pay/:order_id` | unguessable id | Order page: payment instructions + "I've paid" reference form (20 posts/hour/IP) |
| `POST /v1/google/connect` · `DELETE /v1/google` | key | Google Search Console connect link / disconnect |
| `GET /v1/plans` | none | Tier catalogue, `providers` (enabled only: id, label, kind, recurring), `default_provider`, `prepaid_period_days`. The checkout page (`/checkout.html`) renders only these |
| `GET /health` | none | Version, which providers and Google OAuth are live |
| `POST /webhooks/<provider>` (`paypal`, `whop`, `stripe`, `crypto`) | signature | Subscription events → tier; crypto IPN → order paid → prepaid period. Manual providers have no webhook (404) |
| `GET /.well-known/openai-apps-challenge` | none | Plain-text OpenAI domain-verification token when `OPENAI_APPS_CHALLENGE` is set, else 404 |
| `GET /google/callback` | signed state | Google OAuth redirect |
| `GET /reports/:id.pdf` | unguessable id | White-label PDF (30 days) |
| `/admin/*` | `ADMIN_TOKEN` | Used by the admin CLI. 404 when `ADMIN_TOKEN` is unset |

## OAuth 2.1 bridge (for ChatGPT / Claude connectors)
`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `POST /oauth/register` (RFC 7591 DCR, public clients), `GET|POST /oauth/authorize` (the user pastes their API key), `POST /oauth/token` (`authorization_code` with PKCE S256, `refresh_token` with rotation), `POST /oauth/revoke`.
Access tokens last 24 h and refresh tokens 90 days. All tokens are stored hashed and bound to one API key.
**Seam:** to add a real IdP or account login later, implement `Authenticator` in `src/hosted/auth.ts` and point the metadata in `src/hosted/oauth.ts` at it. Metering and tiers don't change.

## Admin CLI
```bash
export CYGNIX_ADMIN_URL=https://mcp.cygnixlabs.com CYGNIX_ADMIN_TOKEN=…
npm run admin -- accounts
npm run admin -- create client@agency.com agency "Client A"
npm run admin -- tier client@agency.com growth
npm run admin -- key client@agency.com "Client B"
npm run admin -- rotate key_… | revoke key_… | suspend <id|email> | unsuspend <id|email>
npm run admin -- orders pending                       # manual/one-time orders waiting for you
npm run admin -- activate-order ord_… "payoneer 12345" # after you see the money in the gateway
npm run admin -- cancel-order ord_… "never paid"
npm run admin -- grant client@agency.com agency 30 whop "receipt 987"  # any gateway, no webhook needed
```

## Billing providers (gateway-agnostic)
`src/hosted/billing/provider.ts` defines `BillingProvider` (`id`, `label`, `kind`, `missingEnv`, `createCheckout`, `manageUrl`, optional `parseWebhook`, optional `instructions`). `src/hosted/billing/index.ts` is the registry: **adding a gateway = one file + one `registerProvider("id", factory)` line.** Every provider is inert (not listed, not callable, webhook 503) until `missingEnv()` is empty; `GET /health` shows each one.

| id | kind | Turn on with | Confirmation | Status |
|---|---|---|---|---|
| `paypal` | subscription | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_*` (PayPal **Business** only) | verified webhook | implemented, sandbox-tested with mocks |
| `whop` | subscription | `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PLAN_*` | Standard Webhooks HMAC | implemented |
| `stripe` | subscription | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Stripe v1 signature | implemented (for later) |
| `crypto` | invoice | `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` (`CRYPTO_GATEWAY=nowpayments`, default) | IPN `x-nowpayments-sig` = HMAC-SHA512 of key-sorted JSON | implemented from NOWPayments' public API docs; **not yet tested against a live account** |
| `payoneer` | manual | `PAYONEER_ENABLED=true`; optional `PAYONEER_LINK` or `PAYONEER_LINK_PRO/GROWTH/AGENCY`, `PAYONEER_INSTRUCTIONS` | admin activates | no Payoneer API used |
| `paypal_link` | manual | `PAYPAL_ME_URL` (personal PayPal OK) | admin activates | link = `<url>/<amount>USD` (PayPal.me convention; check on your link) |
| `crypto_wallet` | manual | `CRYPTO_WALLETS="USDT (TRC-20)=T…; USDC (Base)=0x…"` | admin activates | – |

- **Subscriptions** map provider plan IDs to tiers (`tierForPlan`), are idempotent per event, ignore stale subscriptions, and keep the paid tier until `paid_through` after a PayPal cancel.
- **Invoice/manual** payments create a `billing_orders` row (`ord_` + 24 random chars, also the payment reference). Paying it sets `billing_status = "prepaid"`, the tier, and `paid_through = now + PREPAID_PERIOD_DAYS` (default 30). Paying again for the same tier stacks onto the remaining time. When `paid_through` passes, the key drops to Free automatically (`effectiveTier`). There's no auto-renewal and no reminder email yet.
- Crypto IPN rules: only `payment_status = "finished"`, `price_currency = "usd"` and `price_amount ≥ order amount` activate. Repeated deposits (`parent_payment_id` set) and partial payments are recorded but never auto-activate (NOWPayments' own recommendation); an admin can still activate them.
- **Manual activation for any gateway:** `POST /admin/orders/:id/activate` for a pending order, or `POST /admin/accounts/:id/grant {tier, days?, provider?, reference?}` for a payment that came in some other way (for example a Whop sale without webhooks). Both record a paid order for the books.
- Display order: `BILLING_PROVIDER_ORDER` (comma list), then the registry order. Default selection: `BILLING_PROVIDER` if enabled, else the first enabled one.
- Not implemented on purpose: Coinbase Commerce (its Charge API was retired on 31 Mar 2026; the Coinbase Business Checkouts API that replaced it is limited to US/Singapore businesses), the Payoneer Checkout API (needs separate merchant approval), and Lemon Squeezy (moving merchants onto Stripe).

## Hiding prices for ChatGPT (OpenAI plugin rules)
OpenAI's plugin guidelines say plugins "must not display subscription plans, initiate new subscriptions, or promote upgrades", and may only say a feature isn't on the user's plan and link to an informational page. So when the client matches `HIDE_PRICES_FOR_CLIENTS` (default `chatgpt,openai`, case-insensitive substrings; `""` turns it off):
- `account_status` shows plan name, usage and limits, plus `https://mcp.cygnixlabs.com/account.html`. No prices, no "Upgrade" line.
- Agency-only tools say "not included in this key's current plan. See your account page: …".
- Quota and rate-limit errors drop prices and `upgrade_url`; `data.account_url` replaces it.
- Tool descriptions and server instructions say "Agency accounts" instead of "Agency plan"; the Agensi footer on the 5 core tools is removed; the OAuth sign-in page doesn't mention the free quota.
- `account.html` is informational only (plan, usage, keys, orders). Checkout lives on `checkout.html`, which is never linked from tool output in this mode.

Detection (any one): `User-Agent` (ChatGPT sends `openai-mcp/1.0.0 (ChatGPT)`, per public server logs, not an OpenAI spec), `initialize` `clientInfo.name`/`title` (ChatGPT reports `openai-mcp`), the OAuth `client_name` the connector registered with, or the last `clientInfo` stored for that OAuth client or API key. Other clients (Claude, Cursor, VS Code) are unchanged.

## Security notes
API keys use 190-bit random values stored as SHA-256 hashes. Google refresh tokens are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`, and the OAuth `state` is HMAC-signed with a 15-minute expiry. Webhooks are verified (PayPal verify API, Standard Webhooks HMAC for Whop, Stripe v1 signatures, NOWPayments HMAC-SHA512) with a 5-minute replay window where the gateway sends a timestamp. Order pages are noindex, no-store, frame-denied and keyed by a 24-character random id. AEO tools fetch only public http(s) hosts (private, loopback and link-local addresses are blocked) with a 2 MB / 10 s cap. The OAuth pages send `X-Frame-Options: DENY`.
