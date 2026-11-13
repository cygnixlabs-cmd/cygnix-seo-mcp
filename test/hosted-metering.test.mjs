import test from "node:test"; import assert from "node:assert/strict";
import { makeApp } from "./helpers.mjs";
import { TIERS, tierForPlan, planIdFor, nextTier } from "../dist/hosted/tiers.js";
import { periodOf, effectiveTier } from "../dist/hosted/store.js";

test("tier catalogue: prices and quotas are monotonic", () => {
  assert.deepEqual(["free", "pro", "growth", "agency"].map(t => TIERS[t].priceUsdMonthly), [0, 15, 39, 99]);
  const q = ["free", "pro", "growth", "agency"].map(t => TIERS[t].monthlyCalls);
  assert.deepEqual(q, [...q].sort((a, b) => a - b)); assert.equal(TIERS.agency.whiteLabelReports, true); assert.equal(TIERS.growth.whiteLabelReports, false);
  assert.equal(nextTier("free").id, "pro"); assert.equal(nextTier("agency"), null);
});

test("provider plan ids map to tiers per provider", () => {
  const env = { PAYPAL_PLAN_PRO: "P-PRO", PAYPAL_PLAN_AGENCY: "P-AG", WHOP_PLAN_GROWTH: "plan_g", STRIPE_PRICE_PRO: "price_pro" };
  assert.equal(tierForPlan("paypal", "P-PRO", env), "pro"); assert.equal(tierForPlan("paypal", "P-AG", env), "agency");
  assert.equal(tierForPlan("whop", "plan_g", env), "growth"); assert.equal(tierForPlan("stripe", "price_pro", env), "pro");
  assert.equal(tierForPlan("whop", "P-PRO", env), null, "ids do not leak across providers"); assert.equal(tierForPlan("paypal", null, env), null);
  assert.equal(planIdFor("paypal", "growth", env), null);
});

test("only tools/call is metered, per key and pooled per account", async () => {
  const { signup, rpc, call, store } = makeApp();
  const s = await signup(); const acct = await store.account(s.account_id); await store.setTier(acct.id, "pro");
  const k2 = await store.createKey(acct.id, "client-b");
  await rpc(s.api_key, "tools/list"); await rpc(s.api_key, "ping");
  assert.equal(await store.accountUsage(acct.id), 0);
  const r = await call(s.api_key, "classify_search_intent", { keywords: "seo tools" });
  assert.equal(r.res.headers.get("x-cygnix-quota-remaining"), "4999");
  await call(k2.key, "classify_search_intent", { keywords: "seo" }); await call(k2.key, "classify_search_intent", { keywords: "seo" });
  assert.equal(await store.accountUsage(acct.id), 3);
  const byKey = Object.fromEntries((await store.usageByKey(acct.id)).map(x => [x.key_id, x.calls]));
  assert.equal(byKey[k2.row.id], 2);
});

test("over quota returns a JSON-RPC error with an upgrade link and does not run the tool", async () => {
  const { signup, call, store, db } = makeApp();
  const s = await signup(); const k = (await store.listKeys(s.account_id))[0];
  await db.prepare("INSERT INTO usage_monthly (key_id,account_id,period,calls) VALUES (?,?,?,?)").bind(k.id, s.account_id, periodOf(), TIERS.free.monthlyCalls).run();
  const r = await call(s.api_key, "classify_search_intent", { keywords: "buy" });
  assert.equal(r.status, 200); assert.equal(r.body.error.code, -32029);
  assert.match(r.body.error.message, /Monthly quota reached: 300 tool calls on the Free plan/);
  assert.match(r.body.error.message, /Upgrade to Pro \(\$15\/mo, 5,000 calls\): https:\/\/mcp\.test\/#pricing/);
  assert.equal(r.body.error.data.upgrade_url, "https://mcp.test/#pricing");
  assert.equal(await store.accountUsage(s.account_id), 300, "rejected call is not counted");
  await store.setTier(s.account_id, "pro");
  const ok = await call(s.api_key, "classify_search_intent", { keywords: "buy" });
  assert.ok(ok.body.result, "upgrade lifts the block immediately");
});

test("per-minute rate limit returns 429 with Retry-After", async () => {
  const { signup, rpc } = makeApp();
  const s = await signup();
  for (let i = 0; i < TIERS.free.perMinute; i++) assert.equal((await rpc(s.api_key, "ping")).status, 200);
  const r = await rpc(s.api_key, "ping");
  assert.equal(r.status, 429); assert.equal(r.body.error.code, -32028); assert.ok(Number(r.res.headers.get("retry-after")) > 0);
});

test("key management: tier key limit, rotate, revoke, account view", async () => {
  const { signup, req, post, rpc, store } = makeApp();
  const s = await signup(); const auth = { authorization: `Bearer ${s.api_key}` };
  const over = await post("/v1/keys", { label: "second" }, auth);
  assert.equal(over.status, 403); assert.match((await over.json()).error.message, /allows 1 active key/);
  await store.setTier(s.account_id, "agency");
  const created = await (await post("/v1/keys", { label: "client-a" }, auth)).json();
  assert.match(created.api_key, /^cyg_live_/);
  const rot = await (await post(`/v1/keys/${created.key.id}/rotate`, {}, auth)).json();
  assert.notEqual(rot.api_key, created.api_key); assert.equal(rot.key.label, "client-a");
  assert.equal((await rpc(created.api_key, "ping")).status, 401, "old key dead after rotate");
  assert.equal((await rpc(rot.api_key, "ping")).status, 200);
  const view = await (await req("/v1/account", { headers: auth })).json();
  assert.equal(view.plan.name, "Agency"); assert.equal(view.keys.length, 2); assert.equal(view.usage.remaining, 100000);
  const other = await signup();
  const steal = await req(`/v1/keys/${rot.key.id}`, { method: "DELETE", headers: { authorization: `Bearer ${other.api_key}` } });
  assert.equal(steal.status, 404, "cannot revoke another account's key");
});

test("cancelled subscription keeps paid tier until paid_through", () => {
  const now = 1_800_000_000;
  assert.equal(effectiveTier({ tier: "pro", billing_status: "ending", paid_through: now + 100 }, now), "pro");
  assert.equal(effectiveTier({ tier: "pro", billing_status: "ending", paid_through: now - 1 }, now), "free");
  assert.equal(effectiveTier({ tier: "pro", billing_status: "active", paid_through: null }, now), "pro");
});

test("admin API is disabled without ADMIN_TOKEN and works with it", async () => {
  assert.equal((await makeApp().req("/admin/accounts")).status, 404);
  const { req, post, rpc } = makeApp({ ADMIN_TOKEN: "t0ken" });
  const h = { authorization: "Bearer t0ken" };
  assert.equal((await req("/admin/accounts", { headers: { authorization: "Bearer wrong!" } })).status, 401);
  const c = await (await post("/admin/accounts", { email: "agency@x.co", tier: "agency" }, h)).json();
  assert.equal(c.account.tier, "agency");
  assert.equal((await rpc(c.api_key, "ping")).status, 200);
  const t = await (await post(`/admin/accounts/agency@x.co/tier`, { tier: "growth" }, h)).json();
  assert.equal(t.account.tier, "growth");
  await post(`/admin/keys/${c.key_id}/revoke`, {}, h);
  assert.equal((await rpc(c.api_key, "ping")).status, 401);
});
