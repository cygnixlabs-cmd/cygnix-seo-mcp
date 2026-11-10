# Hosting the remote cygnix-seo-mcp

**Decision: Cloudflare Workers + D1 + Workers Static Assets**, with a Docker/Node fallback (`Dockerfile.hosted`).

## Why Cloudflare Workers + D1

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

## Deploy (owner runs this; nothing has been deployed)

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

## Fallback: Docker (Fly.io / Render / VPS)

```bash
docker build -f Dockerfile.hosted -t cygnix-seo-mcp-hosted .
docker run -p 8080:8080 -v $PWD/data:/data -e ADMIN_TOKEN=... -e PUBLIC_BASE_URL=https://mcp.cygnixlabs.com cygnix-seo-mcp-hosted
```

Mount a persistent volume at `/data` (SQLite file). DNS: `CNAME mcp <app>.fly.dev` (or the Render hostname) at host.com.pk.
