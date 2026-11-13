# Hosting the remote cygnix-seo-mcp

**Decision (owner, 11 Nov 2026): keep `cygnixlabs.com` DNS at host.com.pk and run the server on the existing host.com.pk cPanel
account with "Setup Node.js App" (Option A below). $0 extra.** No nameserver move, no Workers Paid.
The Cloudflare Workers + D1 path still works unchanged (kept for later), and `Dockerfile.hosted` stays as the container fallback.

| Option | Cost | DNS change at host.com.pk | Status |
|---|---|---|---|
| **A. host.com.pk cPanel, Setup Node.js App** (`app.cjs`, SQLite file or cPanel MySQL) | $0 (existing hosting) | `A mcp 85.187.128.22` (cPanel adds it when the subdomain is created) | **Recommended** |
| B. Free container host + `CNAME mcp` | Render free $0 but may ask for a card, sleeps after 15 min (~1 min cold start), no disk; Koyeb needs a card + $29 hold + pro-rated Pro; Fly.io has no free tier (~$2.19/mo) | `CNAME mcp <host>` | Fallback only |
| C. Cloudflare Workers + D1 | $0 (Free) / $5 Paid | needs nameservers moved to Cloudflare (CNAME setup needs Business) | Not used (owner keeps DNS at host.pk) |

## Option A: cPanel "Setup Node.js App" (host.com.pk)

The account (`cygnixlabs.com`) lives on `sg1-lr3.supercp.com` (85.187.128.22, LiteSpeed, CloudLinux cPanel, Let's Encrypt AutoSSL).
The host.com.pk nameservers (`ns915/ns916`) resolve to the same server, so the cPanel Zone Editor is the live DNS.

How it fits:
- **Runner.** CloudLinux Node.js Selector starts `app.cjs` under LiteSpeed `lsnode` (or Phusion Passenger on Apache hosts). `PORT` is
  often a socket path; `node-server.ts` handles both. `app.cjs` is CommonJS and imports the ESM server, so it works whether the runner
  `require()`s or imports the startup file.
- **Streamable HTTP.** The server runs the SDK transport in *stateless JSON-response mode* (`enableJsonResponse: true`, no sessions):
  every `POST /mcp` gets one `application/json` reply, and `GET /mcp` answers 405 (allowed by the spec when the server offers no SSE stream).
  Proxy buffering and SSE idle timeouts on shared hosting therefore don't matter. Responses also send `X-Accel-Buffering: no`.
- **Storage.** `HOSTED_DB_DRIVER=sqlite` (default) uses `node:sqlite` (built into Node >= 22.13, no native build) at `~/mcp-app/data/hosted.sqlite`.
  `HOSTED_DB_DRIVER=mysql` uses cPanel MySQL/MariaDB through `mysql2` (pure JS) with its own schema in `migrations-mysql/`. Pick MySQL if
  the Selector only offers Node < 22.13. Both are covered by tests (MySQL test runs with `MYSQL_TEST_URL`).
- **TLS.** cPanel AutoSSL (Let's Encrypt, already issuing for this account) covers `mcp.cygnixlabs.com` once the subdomain exists. The Node
  server passes `/.well-known/acme-challenge/*` and `/.well-known/pki-validation/*` through to the subdomain's document root so renewals keep working.

### Deploy (owner clicks; nothing has been deployed)
1. Build the upload bundle (agent already built one): `npm run bundle:cpanel` -> `build/cpanel/cygnix-seo-mcp-cpanel.zip` (flat archive; never upload `node_modules`).
2. cPanel -> **Domains** -> Create A New Domain -> `mcp.cygnixlabs.com`, untick "Share document root" (doc root `mcp.cygnixlabs.com`). Check **Zone Editor** shows `A mcp 85.187.128.22`; add it if not.
3. cPanel -> **SSL/TLS Status** -> tick `mcp.cygnixlabs.com` -> **Run AutoSSL**. Wait for the green lock.
4. cPanel -> **Setup Node.js App** -> Create Application: Node.js version **24.x** (else highest 22.x >= 22.13; if only <= 22.12/20, use MySQL), Application mode **Production**,
   Application root **`mcp-app`**, Application URL **`mcp.cygnixlabs.com`** (no sub-path), Application startup file **`app.cjs`** -> Create -> **Stop App**.
5. **File Manager** -> `~/mcp-app` -> Upload the zip -> Extract here (overwrite the placeholder `app.js` is fine) -> delete the zip.
6. Back in Setup Node.js App -> the app -> **Run NPM Install**.
7. Add the environment variables (section below) -> **Save** -> **Start/Restart App**.
8. Verify (section below). Errors land in `~/mcp-app/stderr.log`.

Updates: rebuild the bundle, upload + extract over `~/mcp-app` (keeps `data/`), Run NPM Install if `package.json` changed, Restart.
Backups: cPanel backups include `~/mcp-app/data/` (SQLite) or the MySQL database. For a consistent SQLite copy, Stop App first.

### Environment variables (Setup Node.js App -> Environment variables)
| Name | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://mcp.cygnixlabs.com` |
| `HOSTED_DB_DRIVER` | `sqlite` (or `mysql`) |
| `HOSTED_DB` | optional; default `<app root>/data/hosted.sqlite` |
| `MYSQL_HOST` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | only for `mysql`: `localhost`, `<cpuser>_mcp`, `<cpuser>_mcp`, the password (or one `MYSQL_URL`) |
| `ADMIN_TOKEN` | 64 hex chars (`openssl rand -hex 32`) |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (back it up) |
| `BILLING_PROVIDER` | `paypal_link` while only personal PayPal exists |
| `PAYPAL_ME_URL` | `https://paypal.me/<name>` |
| `PAYONEER_ENABLED` | `true` once Payoneer is approved |
| `HIDE_PRICES_FOR_CLIENTS` | `chatgpt,openai` (default) |
| `PREPAID_PERIOD_DAYS` | `30` |

Every other provider var (PayPal Subscriptions, Whop, Stripe, NOWPayments, Google) stays unset until used; `/health` shows what is live. Crypto stays off.

MySQL setup (only if needed): cPanel -> **MySQL Databases** -> create DB `mcp` (becomes `<cpuser>_mcp`) -> create user `mcp` with a generated password ->
Add User To Database -> ALL PRIVILEGES. Tables are created on first start.

### Verify
```bash
curl -s https://mcp.cygnixlabs.com/health                                   # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' https://mcp.cygnixlabs.com/mcp      # 405 (stateless server, POST only)
curl -si -X POST https://mcp.cygnixlabs.com/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -5   # 401 + WWW-Authenticate
curl -s -X POST https://mcp.cygnixlabs.com/v1/signup -H 'content-type: application/json' -d '{"email":"you@example.com","accept_terms":true}'   # 201 + api_key
curl -s -X POST https://mcp.cygnixlabs.com/mcp -H "authorization: Bearer cyg_live_..." -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | head -c 300   # tools list
curl -s https://mcp.cygnixlabs.com/.well-known/oauth-authorization-server | head -c 200
curl -svI https://mcp.cygnixlabs.com/ 2>&1 | grep -iE 'issuer|HTTP/'          # Let's Encrypt cert, 200
```
Admin from anywhere: `CYGNIX_ADMIN_URL=https://mcp.cygnixlabs.com CYGNIX_ADMIN_TOKEN=... node dist/hosted/admin-cli.js accounts`.

### Honest limits (Option A)
- Shared-hosting LVE limits (CPU, RAM, entry processes) apply; fine for launch traffic, not for heavy load.
- The runner stops idle apps; the first request after idle takes ~1-3 s to boot. MCP clients tolerate this.
- No server-to-client SSE stream (not needed by any tool). Request bodies over 2 MB get 413.
- `node:sqlite` prints an ExperimentalWarning into `stderr.log` on Node 22 (harmless).
- Whether "Setup Node.js App" is enabled on this host.com.pk package must be checked in cPanel (Software section). If it's missing, ask host.com.pk support to enable the Node.js Selector; if they want money for it, stop and report the price.

## Option C (kept): Cloudflare Workers + D1


| Need | Workers + D1 | Alternatives considered |
|---|---|---|
| $0 to start | Free plan: 100k requests/day, D1 5 GB, 5M rows read/day, 100k rows written/day, static assets free | Fly.io (card + ~$2–5/mo with a volume), Render ($7/mo for a non-sleeping service + disk), Railway (~$5/mo), Vercel (functions + external DB) |
| Cheap to scale | Workers Paid **$5/mo** (10M requests, 50M D1 writes/mo included) | VPS $5–6/mo but you run patches, TLS, backups |
| Global latency for Claude/ChatGPT callers | Runs at the edge; no cold starts worth noticing | Single-region containers |
| Streamable HTTP MCP | Stateless JSON responses fit Workers perfectly; the SDK's Web-standard transport runs unmodified (verified with `wrangler dev`) | Same code runs on Node via `src/hosted/node.ts` |
| One deploy for API + landing pages | Static Assets serve `site/` from the same Worker and domain | Separate static host |
| Data | D1 = SQLite; the same SQL runs locally on `node:sqlite` in tests | Postgres would need a separate provider |
| Ops | No servers, automatic TLS, built-in logs (`observability`), `wrangler rollback` | |

Measured bundle: ~1.7 MB raw / ~400 KB gzip (`npm run worker:check`), under the 3 MB free-plan limit.

### Honest limits

- **CPU time:** the Free plan allows 10 ms CPU per request. Plain tool calls are light, but PDF reports, big GSC pulls and the MCP SDK's per-request setup can go over. **Plan on Workers Paid ($5/mo) at launch.** It allows up to 30 s CPU per request. Free is fine for staging.
- **D1 writes:** each metered `tools/call` writes 3 rows (usage, rate window, last-used). The Free plan's 100k writes/day is about 30k tool calls/day, which is plenty at launch.
- **DNS:** a Worker Custom Domain needs the `cygnixlabs.com` zone on Cloudflare DNS. Today the nameservers are at `host.com.pk` (`ns915–918.host.com.pk`). Moving them to Cloudflare (free plan) is the one-time owner step; see OWNER-CHECKLIST step 2. Cloudflare's CNAME-only "partial" setup needs the Business plan, so it doesn't apply here. **Fallback** if you don't want to move DNS: deploy `Dockerfile.hosted` to Fly.io or Render and add one `CNAME mcp → <app host>` at host.com.pk. That needs no code changes.

## Local development

```bash
npm ci
npm run build
npm run hosted:dev                 # Node 22.13+: http://localhost:8787/mcp (SQLite at .data/hosted.sqlite)
# or the real Workers runtime with a local D1:
npx wrangler@4 d1 migrations apply cygnix-seo-mcp --local
npx wrangler@4 dev --var ADMIN_TOKEN:dev-admin
```

Get a key and call a tool:

```bash
curl -s -XPOST localhost:8787/v1/signup -H 'content-type: application/json' -d '{"email":"me@example.com","accept_terms":true}'
curl -s -XPOST localhost:8787/mcp -H "authorization: Bearer cyg_live_..." -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"classify_search_intent","arguments":{"keywords":"buy seo audit"}}}'
npx @modelcontextprotocol/inspector   # Transport: Streamable HTTP, URL http://localhost:8787/mcp, header Authorization: Bearer cyg_live_...
```

## Deploy on Workers (Option C only; not the chosen path)

1. `npx wrangler@4 login` (Cloudflare account, free).
2. `npx wrangler@4 d1 create cygnix-seo-mcp`, then paste the printed `database_id` into `wrangler.toml`.
3. `npx wrangler@4 d1 migrations apply cygnix-seo-mcp --remote`
4. Set the secrets (each command prompts for the value; nothing goes in git):
   ```bash
   npx wrangler@4 secret put ADMIN_TOKEN            # openssl rand -hex 32
   npx wrangler@4 secret put TOKEN_ENCRYPTION_KEY   # openssl rand -base64 32
   # PayPal: PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID PAYPAL_PLAN_PRO PAYPAL_PLAN_GROWTH PAYPAL_PLAN_AGENCY
   # Whop:   WHOP_API_KEY WHOP_WEBHOOK_SECRET WHOP_PLAN_PRO WHOP_PLAN_GROWTH WHOP_PLAN_AGENCY
   # Google: GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
   # Stripe (later): STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_PRO STRIPE_PRICE_GROWTH STRIPE_PRICE_AGENCY
   ```
   Any block you leave unset stays inert. `/health` shows what is live.
5. `npx wrangler@4 deploy`, then smoke-test `https://cygnix-seo-mcp.<your-subdomain>.workers.dev/health`.
6. After the DNS move, uncomment the `[[routes]]` block in `wrangler.toml` and `npx wrangler@4 deploy` again. Wrangler then creates the `mcp.cygnixlabs.com` record and certificate.
7. Set `PAYPAL_ENV = "live"` in `wrangler.toml` once sandbox purchases work, then redeploy.

Rollback: `npx wrangler@4 rollback`. Backups: `npx wrangler@4 d1 export cygnix-seo-mcp --remote --output backup.sql`. D1 also has 30-day Time Travel.

## Option B fallback: Docker (Render / Fly.io / VPS)

```bash
docker build -f Dockerfile.hosted -t cygnix-seo-mcp-hosted .
docker run -p 8080:8080 -v $PWD/data:/data -e ADMIN_TOKEN=... -e PUBLIC_BASE_URL=https://mcp.cygnixlabs.com cygnix-seo-mcp-hosted
```

Mount a persistent volume at `/data` (SQLite file). Hosts without a disk (Render free) lose the file on every restart: set `HOSTED_DB_DRIVER=mysql` and point `MYSQL_*` at the cPanel database (cPanel -> Remote MySQL -> allow the host's egress IPs). DNS: `CNAME mcp <app>.onrender.com` (or `<app>.fly.dev`) at host.com.pk, replacing the `A mcp` record. Costs are in `skills-desk/mcp-hostpk-deploy.md`.
