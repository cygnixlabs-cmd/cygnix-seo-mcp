# Owner checklist: taking the hosted cygnix-seo-mcp live

Nothing here has been done for you. No accounts were created, no money spent, no DNS changed, nothing deployed.
Every provider stays **inert** until its env vars are set, and `GET /health` shows what is live.
Secrets go into cPanel -> Setup Node.js App -> Environment variables (or `npx wrangler@4 secret put NAME` on the Workers path). Never commit them.

## 0. Review and merge
- [ ] Review the PR `feat/hosted-remote-mcp`. The stdio/npm package is unchanged and stays at v1.0.0; nothing is published.
- [ ] Get the **Privacy Policy** and **Terms** legally reviewed. Source: `skills-desk/launch-kit/legal/privacy.md` + `terms.md` (v0.2, now covering one-time/crypto/Payoneer payments and the client-name hint); `site/privacy.html` / `site/terms.html` are generated from them. Fill in the operator's legal name (you as an individual in Kuwait, or the company once formed), address, governing law and venue, the record-retention period, and the manual-activation time. Then remove the DRAFT banners (`site/*.html`, the `.draft` div and `.pill`).

## 1. Host: host.com.pk cPanel "Setup Node.js App" ($0, decided 11 Nov)
DNS stays at host.com.pk. No nameserver move, no Cloudflare account, no Workers Paid. Full guide: `docs/hosting.md` Option A and `skills-desk/mcp-hostpk-deploy.md`.
- [ ] cPanel -> Software: confirm **Setup Node.js App** is there and note the highest Node.js version offered (need 22.13+ for SQLite; otherwise use MySQL). If it's missing, ask host.com.pk support to enable it; if they quote a price, stop and tell the agent.
- [ ] cPanel -> **Domains** -> Create A New Domain: `mcp.cygnixlabs.com` (own document root, not shared).
- [ ] cPanel -> **SSL/TLS Status** -> `mcp.cygnixlabs.com` -> **Run AutoSSL** (free Let's Encrypt, already used by this account).
- [ ] Setup Node.js App -> Create: Node 24.x (or 22.x >= 22.13), Production, root `mcp-app`, URL `mcp.cygnixlabs.com`, startup file `app.cjs` -> Stop App.
- [ ] File Manager -> `~/mcp-app` -> upload `cygnix-seo-mcp-cpanel.zip` -> Extract -> delete the zip -> **Run NPM Install**.
- [ ] Generate `ADMIN_TOKEN` (`openssl rand -hex 32`) and `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) in cPanel -> Terminal (or any computer). **Back up `TOKEN_ENCRYPTION_KEY`.**
- [ ] Enter the environment variables (docs/hosting.md Option A table) -> Save -> **Restart**.
- [ ] Optional MySQL instead of SQLite: cPanel -> MySQL Databases -> DB `<cpuser>_mcp` + user with ALL PRIVILEGES -> `HOSTED_DB_DRIVER=mysql` + `MYSQL_*`.

## 2. DNS for mcp.cygnixlabs.com (host.com.pk Zone Editor)
cygnixlabs.com DNS is at host.com.pk (`ns915–ns918.host.com.pk`, served by the same cPanel server 85.187.128.22). Keep every existing record as is.
- [ ] Zone Editor -> check this record exists (cPanel adds it in step 1 when the subdomain is created); add it only if missing:
  `A   mcp.cygnixlabs.com.   85.187.128.22   TTL 14400`
- No CNAME, TXT or CAA record is needed (no CAA exists on the domain, so Let's Encrypt can issue). Don't add an `mcp` CNAME while the A record exists.
- Fallback only (if Setup Node.js App is unavailable): replace the A record with `CNAME mcp <service>.onrender.com` (TTL 3600) after deploying `Dockerfile.hosted` on Render free. Read the cost notes in `skills-desk/mcp-hostpk-deploy.md` first.

Then check: `curl https://mcp.cygnixlabs.com/health`.

## 3a. Day-one payments that need no business account (pick any; each is off until set)
The checkout page lists only the gateways you turn on. One-time payments buy `PREPAID_PERIOD_DAYS` (default 30) and don't auto-renew. Manual ones need you to check the money arrived and run `npm run admin -- activate-order ord_…`.
- [ ] **PayPal.me (personal PayPal works):** set `PAYPAL_ME_URL = "https://paypal.me/<your-name>"`. Open `https://paypal.me/<your-name>/15USD` once to check the amount pre-fills. Buyers write the order reference in the note.
- [ ] **Payoneer:** set `PAYONEER_ENABLED = "true"`. Either (a) leave it at that: for each order, Payoneer → Get Paid → **Request a payment** to the buyer's email for the order amount, quoting the `ord_…` reference; or (b) create **Payment Links** in Payoneer and set `PAYONEER_LINK` (one link) or `PAYONEER_LINK_PRO` / `_GROWTH` / `_AGENCY` (fixed-amount links). Payoneer's fee depends on how the buyer pays (card up to 3.99%; the payer can choose who pays the fee).
- [ ] **Crypto transfer to your own wallet:** set `CRYPTO_WALLETS = "USDT (TRC-20)=T…; USDC (Base)=0x…"`. Use addresses you control and double-check the network labels. Buyers paste the tx hash; you check it on a block explorer before activating.
- [ ] **Crypto hosted invoice, automatic (NOWPayments):** create a NOWPayments account (check their KYC rules and that Kuwait is supported), set a payout wallet, then Dashboard → Payment Settings → generate the **IPN secret** (it's shown only once) and an **API key**. `wrangler secret put NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET`. The server sends `ipn_callback_url = https://mcp.cygnixlabs.com/webhooks/crypto` with each invoice, so there's no webhook URL to paste. Test with a small invoice first: the adapter follows their public docs but hasn't run against a live account.
- Other gateways later: add one file in `src/hosted/billing/` and one `registerProvider()` line (see docs/hosted-api.md). For any payment that arrives some other way: `npm run admin -- grant <email> <tier> [days] [provider] [reference]`.

## 3. PayPal Subscriptions (recurring; needs PayPal Business)
Needs: a **PayPal Business account** (personal accounts can't use the Subscriptions API). It can be opened in the LLC's name later. Move the subscriptions then, or start under the current business.
- [ ] Open or upgrade to PayPal Business. Verify email, link the bank, and confirm you can receive USD.
- [ ] developer.paypal.com → **Apps & Credentials** → create an app (do Sandbox first, then Live). Copy **Client ID** and **Secret** → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
- [ ] Create the product and 3 monthly plans. Either run `PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node scripts/paypal-create-plans.mjs`, or use the dashboard (Pay & Get Paid → Subscriptions → Create plan): Pro **$15**, Growth **$39**, Agency **$99**, monthly, no setup fee. Set the IDs → `PAYPAL_PLAN_PRO`, `PAYPAL_PLAN_GROWTH`, `PAYPAL_PLAN_AGENCY`.
- [ ] In the same app → **Webhooks** → Add webhook: URL **`https://mcp.cygnixlabs.com/webhooks/paypal`**. Events: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.RE-ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`. Copy the **Webhook ID** → `PAYPAL_WEBHOOK_ID`.
- [ ] Test with sandbox buyer accounts (`PAYPAL_ENV=sandbox`). When it works, repeat with Live credentials, plans and webhook, and set `PAYPAL_ENV=live` in the app's environment variables (or `wrangler.toml` on Workers).
- Fees: PayPal's standard commercial rates for your country, plus currency conversion. Payouts go to your PayPal balance and then to your bank.

## 4. Whop (second, non-Stripe provider)
Why Whop over Lemon Squeezy: Lemon Squeezy is moving merchants to Stripe Managed Payments (see `/workspace/skills-desk/research-plan.md`), which brings back the Stripe dependency we're avoiding. Whop has its own checkout, payouts and a current API (checkout configurations + Standard Webhooks).
- [ ] Create a Whop business (whop.com → Sell). Complete identity and payout verification.
- [ ] Create a product "Cygnix SEO MCP" with 3 **renewing monthly** plans: $15 / $39 / $99. Copy the plan IDs (`plan_…`) → `WHOP_PLAN_PRO`, `WHOP_PLAN_GROWTH`, `WHOP_PLAN_AGENCY`.
- [ ] Developer settings → create an **API key** that can create checkout configurations → `WHOP_API_KEY`.
- [ ] Create a webhook: URL **`https://mcp.cygnixlabs.com/webhooks/whop`**, events `membership.activated`, `membership.deactivated`, API version date pinned to **2026-10-09** or the closest date before plans were renamed to variants (the code sends `plan_id` with `Api-Version-Date: 2026-10-09-2`). Copy the `ws_…` secret → `WHOP_WEBHOOK_SECRET`.
- [ ] Test in Whop's sandbox first (`WHOP_API_BASE=https://sandbox-api.whop.com/api/v1` with sandbox keys).
- To make Whop the default checkout, set `BILLING_PROVIDER=whop` in the environment variables. Otherwise PayPal is used and Whop can be chosen per request (`provider: "whop"`).

## 5. Stripe (later, via the US LLC)
- [ ] After the LLC and its Stripe account exist: create a product with 3 monthly prices ($15/$39/$99) → `STRIPE_PRICE_PRO`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_AGENCY`. Use the secret key → `STRIPE_SECRET_KEY`.
- [ ] Webhook endpoint **`https://mcp.cygnixlabs.com/webhooks/stripe`**, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` → signing secret → `STRIPE_WEBHOOK_SECRET`.
- [ ] Turn on the Customer Billing Portal (Settings → Billing → Customer portal) so `/v1/billing/manage` works.
- Optional: Stripe Managed Payments as merchant of record for VAT/sales tax (research-plan.md).

## 6. Google Search Console OAuth (the one-click GSC connection) — AFTER launch
Launch without it: leave `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` unset so the `gsc_*` tools stay hidden and the site says "coming soon". Start the steps below now, because Google verification takes time.
- [ ] console.cloud.google.com → new project "Cygnix SEO MCP" → **APIs & Services → Library**: enable **Google Search Console API**.
- [ ] **OAuth consent screen / Google Auth Platform:** User type **External**. App name "Cygnix SEO MCP", support email, logo, home page `https://mcp.cygnixlabs.com`, privacy `https://mcp.cygnixlabs.com/privacy.html`, terms `https://mcp.cygnixlabs.com/terms.html`, authorized domain `cygnixlabs.com`. Verify domain ownership in Google Search Console with the same Google account.
- [ ] Scopes: add only `https://www.googleapis.com/auth/webmasters.readonly`.
- [ ] **Clients → Create OAuth client → Web application.** Authorized redirect URI: **`https://mcp.cygnixlabs.com/google/callback`** (add `http://localhost:8787/google/callback` for local testing) → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- [ ] **Verification (required): `webmasters.readonly` is a _sensitive_ scope.** Until Google verifies the app, it stays in Testing: at most 100 listed test users, an "unverified app" warning, and **refresh tokens that expire after 7 days**. Submit for verification with a scope justification ("read Search Console performance and URL inspection data the user asks the assistant to analyze") and a YouTube demo video showing the consent flow and how the data is used. The privacy policy must state Limited Use compliance (the draft already does). It usually takes days to a few weeks. A security assessment (CASA) is only required for _restricted_ scopes, so it shouldn't apply here.
- [ ] Keep `TOKEN_ENCRYPTION_KEY` set (step 1). Without it, Google stays inert.

## 7. Env var summary
| Var | Where (cPanel: all go in Setup Node.js App -> Environment variables) | Required for |
|---|---|---|
| `PUBLIC_BASE_URL` | wrangler.toml `[vars]` | always (`https://mcp.cygnixlabs.com`) |
| `HOSTED_DB_DRIVER`, `HOSTED_DB`, `MYSQL_HOST/DATABASE/USER/PASSWORD` or `MYSQL_URL`, `DCV_WEBROOT` | cPanel env | Node hosts only: storage (sqlite default / mysql); DCV_WEBROOT optional (AutoSSL file passthrough) |
| `ADMIN_TOKEN` | secret | `/admin/*` + admin CLI |
| `TOKEN_ENCRYPTION_KEY` | secret | Google OAuth (encrypts refresh tokens, signs state) |
| `BILLING_PROVIDER` | `[vars]` | default checkout provider (any enabled id) |
| `BILLING_PROVIDER_ORDER` | `[vars]` | optional: order on the checkout page |
| `PREPAID_PERIOD_DAYS` | `[vars]` | days one one-time payment buys (default 30) |
| `HIDE_PRICES_FOR_CLIENTS` | `[vars]` | default `chatgpt,openai`; `""` disables |
| `OPENAI_APPS_CHALLENGE` | `[vars]` | token from the OpenAI plugin portal's domain-verification step |
| `PAYPAL_ME_URL` | `[vars]` | PayPal.me one-time payments (manual) |
| `PAYONEER_ENABLED`, `PAYONEER_LINK`, `PAYONEER_LINK_PRO/GROWTH/AGENCY`, `PAYONEER_INSTRUCTIONS` | `[vars]` | Payoneer (manual) |
| `CRYPTO_WALLETS` | `[vars]` | direct crypto transfer (manual) |
| `CRYPTO_GATEWAY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` (`NOWPAYMENTS_API_BASE` optional) | `[vars]` / secrets | crypto invoices (automatic) |
| `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_PRO/GROWTH/AGENCY` | `[vars]` / secrets | PayPal |
| `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PLAN_PRO/GROWTH/AGENCY` (`WHOP_API_BASE` for sandbox) | secrets | Whop |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO/GROWTH/AGENCY` | secrets | Stripe |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | Search Console tools |
| `SIGNUP_PER_IP_PER_HOUR` | `[vars]` | optional (default 5) |

## 8. Launch checks
- [ ] `/health` shows the providers you expect as `true`.
- [ ] Sign up on the landing page → connect in Claude (OAuth) and in Cursor (header) → run `account_status`.
- [ ] Sandbox purchase → `account_status` shows the new plan. Cancel → the plan stays until the period ends (PayPal) → then Free.
- [ ] For each manual gateway you enabled: start a checkout on `/checkout.html` → the `/pay/ord_…` page shows the right link/addresses → `npm run admin -- orders pending` → `activate-order` → `account_status` shows the plan.
- [ ] Crypto invoice (if enabled): one small real invoice → the order flips to paid by itself.
- [ ] In ChatGPT developer mode: `account_status` shows no prices and links only to `/account.html`.
- [ ] Connect Search Console with a test user → `gsc_list_sites`.
- [ ] Agency: `set_report_branding` → `create_white_label_report` → open the PDF.
- [ ] Add `https://mcp.cygnixlabs.com` to Google Search Console and Bing Webmaster Tools and submit `sitemap.xml`.

## 9. List on MCP directories (after launch): APPROVED ORDER (11 Nov)
Nothing public until `https://mcp.cygnixlabs.com/health` answers. Then, one step at a time (paste-ready drafts in `skills-desk/launch-kit/submissions/`):
1. go live → 2. `npm publish` 1.0.1 → 3. official MCP Registry (`mcp-publisher publish`) → 4. Glama → 5. mcp.so (free) → 6. MCP Marketplace (free) → 7. Claude directory → 8. ChatGPT plugin directory → 9. Agensi + Apify links.
Skipped: MCPize (rev-share hosting) and Smithery (curated). PulseMCP picks the server up from the registry. Free listings only.
- ChatGPT: prices are hidden automatically for ChatGPT clients (`HIDE_PRICES_FOR_CLIENTS`). Domain verification: put the portal's token in `OPENAI_APPS_CHALLENGE` and restart the app; it's served at `/.well-known/openai-apps-challenge`.
