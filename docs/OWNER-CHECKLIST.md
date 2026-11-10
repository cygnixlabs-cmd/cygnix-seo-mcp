# Owner checklist: taking the hosted cygnix-seo-mcp live

Nothing here has been done for you. No accounts were created, no money spent, no DNS changed, nothing deployed.
Every provider stays **inert** until its env vars are set, and `GET /health` shows what is live.
Secrets are set with `npx wrangler@4 secret put NAME`. Never commit them.

## 0. Review and merge
- [ ] Review the PR `feat/hosted-remote-mcp`. The stdio/npm package is unchanged and stays at v1.0.0; nothing is published.
- [ ] Get the **Privacy Policy** and **Terms** (`site/privacy.html`, `site/terms.html`) legally reviewed. Fill in the LLC name, registered address, governing law and venue, then remove the DRAFT banners (`site/*.html`, the `.draft` div).

## 1. Cloudflare (host): free to start
- [ ] Create a Cloudflare account (free).
- [ ] **Recommended at launch: Workers Paid, $5/month.** The Free plan's 10 ms CPU limit can cut off PDF reports and large Search Console pulls. Free is fine for staging. See `docs/hosting.md`.
- [ ] Follow "Deploy" in `docs/hosting.md`: `wrangler login`, `d1 create`, paste the `database_id` into `wrangler.toml`, `d1 migrations apply --remote`, set the secrets, `wrangler deploy`.
- [ ] Set `ADMIN_TOKEN` (`openssl rand -hex 32`) and `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`). **Back up `TOKEN_ENCRYPTION_KEY`:** if it's lost, every stored Google connection must be redone.

## 2. DNS for mcp.cygnixlabs.com
cygnixlabs.com DNS is currently at host.com.pk (`ns915–ns918.host.com.pk`). Existing records include `A @ 85.187.128.22` and `CNAME skills → cygnixlabs-cmd.github.io`.

**Option A (recommended, $0):** move the zone to Cloudflare.
- [ ] Cloudflare dashboard → Add a domain → `cygnixlabs.com` → Free plan. Check that the imported records match host.com.pk **exactly**, including `@` A, `skills` CNAME (set it to **DNS only / grey cloud** so GitHub Pages keeps its certificate), and all MX/TXT (email, SPF, DKIM, DMARC).
- [ ] At the registrar (host.com.pk), replace the 4 nameservers with the 2 Cloudflare gives you. Wait until Cloudflare shows the zone as Active.
- [ ] Uncomment the `[[routes]]` block in `wrangler.toml` (`pattern = "mcp.cygnixlabs.com"`, `custom_domain = true`) and run `npx wrangler@4 deploy`. Wrangler creates the record and TLS certificate for **`mcp.cygnixlabs.com`** itself. Don't add an A/CNAME by hand.

**Option B (keep DNS at host.com.pk):** deploy `Dockerfile.hosted` to Fly.io (~$2–5/month with a volume) or Render (~$7/month plus disk). Then add one record at host.com.pk:
- [ ] `CNAME  mcp  <your-app>.fly.dev` (or the Render hostname), TTL 3600.

Then check: `curl https://mcp.cygnixlabs.com/health`.

## 3. PayPal Subscriptions (first payment provider)
Needs: a **PayPal Business account** (personal accounts can't use the Subscriptions API). It can be opened in the LLC's name later. Move the subscriptions then, or start under the current business.
- [ ] Open or upgrade to PayPal Business. Verify email, link the bank, and confirm you can receive USD.
- [ ] developer.paypal.com → **Apps & Credentials** → create an app (do Sandbox first, then Live). Copy **Client ID** and **Secret** → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
- [ ] Create the product and 3 monthly plans. Either run `PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node scripts/paypal-create-plans.mjs`, or use the dashboard (Pay & Get Paid → Subscriptions → Create plan): Pro **$15**, Growth **$39**, Agency **$99**, monthly, no setup fee. Set the IDs → `PAYPAL_PLAN_PRO`, `PAYPAL_PLAN_GROWTH`, `PAYPAL_PLAN_AGENCY`.
- [ ] In the same app → **Webhooks** → Add webhook: URL **`https://mcp.cygnixlabs.com/webhooks/paypal`**. Events: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.RE-ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`. Copy the **Webhook ID** → `PAYPAL_WEBHOOK_ID`.
- [ ] Test with sandbox buyer accounts (`PAYPAL_ENV=sandbox`). When it works, repeat with Live credentials, plans and webhook, and set `PAYPAL_ENV = "live"` in `wrangler.toml`.
- Fees: PayPal's standard commercial rates for your country, plus currency conversion. Payouts go to your PayPal balance and then to your bank.

## 4. Whop (second, non-Stripe provider)
Why Whop over Lemon Squeezy: Lemon Squeezy is moving merchants to Stripe Managed Payments (see `/workspace/skills-desk/research-plan.md`), which brings back the Stripe dependency we're avoiding. Whop has its own checkout, payouts and a current API (checkout configurations + Standard Webhooks).
- [ ] Create a Whop business (whop.com → Sell). Complete identity and payout verification.
- [ ] Create a product "Cygnix SEO MCP" with 3 **renewing monthly** plans: $15 / $39 / $99. Copy the plan IDs (`plan_…`) → `WHOP_PLAN_PRO`, `WHOP_PLAN_GROWTH`, `WHOP_PLAN_AGENCY`.
- [ ] Developer settings → create an **API key** that can create checkout configurations → `WHOP_API_KEY`.
- [ ] Create a webhook: URL **`https://mcp.cygnixlabs.com/webhooks/whop`**, events `membership.activated`, `membership.deactivated`, API version date pinned to **2026-10-09** or the closest date before plans were renamed to variants (the code sends `plan_id` with `Api-Version-Date: 2026-10-09-2`). Copy the `ws_…` secret → `WHOP_WEBHOOK_SECRET`.
- [ ] Test in Whop's sandbox first (`WHOP_API_BASE=https://sandbox-api.whop.com/api/v1` with sandbox keys).
- To make Whop the default checkout, set `BILLING_PROVIDER = "whop"` in `wrangler.toml`. Otherwise PayPal is used and Whop can be chosen per request (`provider: "whop"`).

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
| Var | Where | Required for |
|---|---|---|
| `PUBLIC_BASE_URL` | wrangler.toml `[vars]` | always (`https://mcp.cygnixlabs.com`) |
| `ADMIN_TOKEN` | secret | `/admin/*` + admin CLI |
| `TOKEN_ENCRYPTION_KEY` | secret | Google OAuth (encrypts refresh tokens, signs state) |
| `BILLING_PROVIDER` | `[vars]` | default checkout provider (`paypal`) |
| `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_PRO/GROWTH/AGENCY` | `[vars]` / secrets | PayPal |
| `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PLAN_PRO/GROWTH/AGENCY` (`WHOP_API_BASE` for sandbox) | secrets | Whop |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO/GROWTH/AGENCY` | secrets | Stripe |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | Search Console tools |
| `SIGNUP_PER_IP_PER_HOUR` | `[vars]` | optional (default 5) |

## 8. Launch checks
- [ ] `/health` shows the providers you expect as `true`.
- [ ] Sign up on the landing page → connect in Claude (OAuth) and in Cursor (header) → run `account_status`.
- [ ] Sandbox purchase → `account_status` shows the new plan. Cancel → the plan stays until the period ends (PayPal) → then Free.
- [ ] Connect Search Console with a test user → `gsc_list_sites`.
- [ ] Agency: `set_report_branding` → `create_white_label_report` → open the PDF.
- [ ] Add `https://mcp.cygnixlabs.com` to Google Search Console and Bing Webmaster Tools and submit `sitemap.xml`.

## 9. List on MCP directories (after launch)
- [ ] **Official MCP Registry:** add a `remotes` entry (`{"type":"streamable-http","url":"https://mcp.cygnixlabs.com/mcp"}`) to `server.json`, bump the version, and publish with `mcp-publisher`. This is a publish step for you to approve.
- [ ] **Smithery, mcp.so, Glama, PulseMCP:** submit the remote URL. They're free and drive installs and LLM citations.
- [ ] **MCP Marketplace (mcp-marketplace.io), MCPize:** list the hosted server (paid-listing options are in research-plan.md).
- [ ] **Claude connectors directory:** submit as a remote connector (OAuth supported).
- [ ] **ChatGPT apps directory:** allowed as "sign in with an existing account". **Don't mention prices in the listing.** OpenAI doesn't allow selling digital subscriptions inside ChatGPT.
- [ ] Link the landing page from skills.cygnixlabs.com, the Apify READMEs and the Agensi listings.
