// Runs only when MYSQL_TEST_URL is set (e.g. mysql://root@localhost/cygnix_test). Exercises the real store/app on MySQL/MariaDB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/hosted/app.js";
import { openMysqlDb } from "../dist/hosted/mysql-db.js";
import { Store } from "../dist/hosted/store.js";

const url = process.env.MYSQL_TEST_URL;
test("hosted app on MySQL: signup, metering, upserts, idempotent events, branding, oauth code", { skip: !url && "set MYSQL_TEST_URL to run" }, async () => {
  const db = await openMysqlDb({ MYSQL_URL: url }, new URL("../migrations-mysql", import.meta.url).pathname);
  try {
    for (const t of ["reports", "branding", "google_connections", "billing_events", "billing_orders", "oauth_tokens", "oauth_codes", "oauth_clients", "rate_windows", "usage_monthly", "api_keys", "accounts"]) await db.prepare(`DELETE FROM ${t}`).run();
    const handle = createApp({ db, env: { PUBLIC_BASE_URL: "https://mcp.test", ADMIN_TOKEN: "a".repeat(40) } });
    const post = (p, b, h = {}) => handle(new Request("https://mcp.test" + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) }));
    const s = await (await post("/v1/signup", { email: "MySQL@Example.com", accept_terms: true })).json();
    assert.ok(s.api_key, JSON.stringify(s));
    const hdr = { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${s.api_key}` };
    for (let i = 1; i <= 3; i++) { const r = await post("/mcp", { jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "search_intent", arguments: { keywords: ["buy running shoes", "how to tie shoes"] } } }, hdr); assert.equal(r.status, 200, await r.clone().text()); }
    const store = new Store(db);
    const me = await (await handle(new Request("https://mcp.test/v1/account", { headers: { authorization: `Bearer ${s.api_key}` } }))).json();
    assert.equal(me.usage.calls, 3, JSON.stringify(me));
    const acct = await store.accountByEmail("mysql@example.com"); assert.equal(acct.id, s.account_id);
    const [k] = await store.listKeys(acct.id);
    await store.decrementUsage(k.id); assert.equal(await store.accountUsage(acct.id), 2);
    for (let i = 0; i < 5; i++) await store.decrementUsage(k.id);
    assert.equal(await store.accountUsage(acct.id), 0, "GREATEST(calls-1,0) floors at 0");
    const h1 = await store.hit("t:bucket", 60, 1_700_000_000_000), h2 = await store.hit("t:bucket", 60, 1_700_000_000_000); assert.equal(h2.hits, h1.hits + 1);
    assert.equal(await store.markEvent("paypal:EV1", "x"), true); assert.equal(await store.markEvent("paypal:EV1", "x"), false);
    await store.saveBranding(acct.id, { agency_name: "A", logo_url: null, primary_color: "#111111", accent_color: "#222222", footer_text: null, website: null });
    await store.saveBranding(acct.id, { agency_name: "B", logo_url: null, primary_color: "#333333", accent_color: "#222222", footer_text: "f", website: null });
    const b = await store.branding(acct.id); assert.equal(b.agency_name, "B"); assert.equal(b.primary_color, "#333333");
    await store.saveGoogle(k.id, acct.id, "enc1", "s"); await store.saveGoogle(k.id, acct.id, "enc2", "s"); assert.equal((await store.google(k.id)).refresh_token_enc, "enc2");
    const c = await store.registerClient("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
    await store.saveCode("code-1", { client_id: c, key_id: k.id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: "x".repeat(43), resource: null });
    assert.ok(await store.consumeCode("code-1")); assert.equal(await store.consumeCode("code-1"), null, "codes are single-use");
    const o = await store.createOrder({ accountId: acct.id, provider: "payoneer", tier: "pro", amountUsd: 15, periodDays: 30 });
    assert.equal((await store.listOrders({ status: "pending", limit: 5 })).length, 1);
    assert.equal(await store.markOrderPaid(o.id, "TX1"), true); assert.equal(await store.markOrderPaid(o.id, "TX1"), false);
    const big = "A".repeat(200_000); await store.saveReport("rep_1", acct.id, k.id, "Big", big); assert.equal((await store.report("rep_1")).pdf_b64.length, 200_000);
  } finally { await db.close(); }
});
