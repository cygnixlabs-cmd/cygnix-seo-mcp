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
| `POST /v1/billing/checkout {tier, provider?}` | key | Returns the provider's checkout `url`. 503 until a provider is configured |
| `POST /v1/billing/manage` | key | Provider link to manage or cancel |
| `POST /v1/google/connect` · `DELETE /v1/google` | key | Google Search Console connect link / disconnect |
| `GET /v1/plans` | none | Tier catalogue + configured providers |
| `GET /health` | none | Version, which providers and Google OAuth are live |
| `POST /webhooks/paypal` · `/webhooks/whop` · `/webhooks/stripe` | signature | Subscription events → tier |
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
```

## Billing providers
`src/hosted/billing/provider.ts` defines `BillingProvider` (`missingEnv`, `createCheckout`, `manageUrl`, `parseWebhook`). Each provider turns its own signed webhooks into normalized `BillingUpdate`s. `applyBillingUpdate` maps plan IDs to tiers, handles events idempotently, ignores stale subscriptions, and keeps the paid tier until `paid_through` after a PayPal cancel.
Order of preference: `BILLING_PROVIDER`, then PayPal → Whop → Stripe (only configured ones).

## Security notes
API keys use 190-bit random values stored as SHA-256 hashes. Google refresh tokens are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`, and the OAuth `state` is HMAC-signed with a 15-minute expiry. Webhooks are verified (PayPal verify API, Standard Webhooks HMAC for Whop, Stripe v1 signatures) with a 5-minute replay window. AEO tools fetch only public http(s) hosts (private, loopback and link-local addresses are blocked) with a 2 MB / 10 s cap. The OAuth pages send `X-Frame-Options: DENY`.
