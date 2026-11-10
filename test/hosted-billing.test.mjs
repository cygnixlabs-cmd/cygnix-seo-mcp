import test from "node:test"; import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeApp, mockFetch } from "./helpers.mjs";

const PAYPAL = { PAYPAL_CLIENT_ID: "cid", PAYPAL_CLIENT_SECRET: "csecret", PAYPAL_WEBHOOK_ID: "WH-1", PAYPAL_PLAN_PRO: "P-PRO", PAYPAL_PLAN_GROWTH: "P-GROWTH", PAYPAL_PLAN_AGENCY: "P-AGENCY" };
const WHOP = { WHOP_API_KEY: "whop_test_key", WHOP_WEBHOOK_SECRET: "ws_testsecret", WHOP_PLAN_PRO: "plan_pro", WHOP_PLAN_AGENCY: "plan_agency" };
const STRIPE = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_GROWTH: "price_growth" };

const paypalMock = (verify = "SUCCESS") => mockFetch([
  ["https://api-m.sandbox.paypal.com/v1/oauth2/token", () => ({ access_token: "A21", expires_in: 3600 })],
  ["https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature", () => ({ verification_status: verify })],
  [u => /\/v1\/billing\/subscriptions\/[^/]+\/revise$/.test(u), () => ({ links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/revise?x=1" }] })],
  ["https://api-m.sandbox.paypal.com/v1/billing/subscriptions", (u, i) => ({ id: "I-SUB1", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1" }], echo: JSON.parse(i.body) })],
]);
const ppHeaders = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem", "paypal-transmission-id": "t1", "paypal-transmission-sig": "sig", "paypal-transmission-time": new Date().toISOString() };
const ppEvent = (id, type, resource) => ({ id, event_type: type, resource_type: "subscription", resource });

test("billing is inert with no provider env vars", async () => {
  const { signup, post, req } = makeApp();
  const s = await signup();
  const h = await (await req("/health")).json(); assert.deepEqual(h.billing, { paypal: false, whop: false, stripe: false });
  const c = await post("/v1/billing/checkout", { tier: "pro" }, { authorization: `Bearer ${s.api_key}` });
  assert.equal(c.status, 503); assert.equal((await c.json()).error.code, "billing_not_configured");
  for (const p of ["paypal", "whop", "stripe"]) assert.equal((await post(`/webhooks/${p}`, "{}")).status, 503);
  const partial = makeApp({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" });
  assert.equal((await (await partial.req("/health")).json()).billing.paypal, false, "partially configured stays inert");
});

test("PayPal: checkout creates a subscription with custom_id and returns the approve link", async () => {
  const f = paypalMock(); const { signup, post } = makeApp(PAYPAL, { fetchImpl: f });
  const s = await signup("buyer@x.co");
  const r = await (await post("/v1/billing/checkout", { tier: "growth" }, { authorization: `Bearer ${s.api_key}` })).json();
  assert.equal(r.provider, "paypal"); assert.match(r.url, /ba_token=BA-1/);
  const sent = f.calls.find(c => c.url.endsWith("/v1/billing/subscriptions"));
  const body = JSON.parse(sent.init.body); assert.equal(body.plan_id, "P-GROWTH"); assert.equal(body.custom_id, s.account_id); assert.equal(body.subscriber.email_address, "buyer@x.co");
  assert.match(f.calls[0].init.headers.Authorization, /^Basic /);
});

test("PayPal webhook: verified ACTIVATED -> tier, idempotent, CANCELLED keeps access to period end, bad sig rejected", async () => {
  const f = paypalMock(); const { signup, post, store } = makeApp(PAYPAL, { fetchImpl: f });
  const s = await signup();
  const next = new Date(Date.now() + 20 * 86400_000).toISOString();
  const act = ppEvent("WH-EV-1", "BILLING.SUBSCRIPTION.ACTIVATED", { id: "I-SUB1", status: "ACTIVE", plan_id: "P-AGENCY", custom_id: s.account_id, subscriber: { payer_id: "PAYER1" }, billing_info: { next_billing_time: next } });
  const r1 = await (await post("/webhooks/paypal", act, ppHeaders)).json(); assert.deepEqual(r1.results, ["tier_agency"]);
  let a = await store.account(s.account_id); assert.equal(a.tier, "agency"); assert.equal(a.billing_subscription_id, "I-SUB1"); assert.equal(a.billing_provider, "paypal");
  const verifyCall = f.calls.find(c => c.url.includes("verify-webhook-signature")); const vb = JSON.parse(verifyCall.init.body);
  assert.equal(vb.webhook_id, "WH-1"); assert.equal(vb.transmission_id, "t1"); assert.equal(vb.webhook_event.id, "WH-EV-1");
  assert.deepEqual((await (await post("/webhooks/paypal", act, ppHeaders)).json()).results, ["duplicate"]);
  const cancel = ppEvent("WH-EV-2", "BILLING.SUBSCRIPTION.CANCELLED", { id: "I-SUB1", status: "CANCELLED", plan_id: "P-AGENCY", custom_id: s.account_id });
  assert.deepEqual((await (await post("/webhooks/paypal", cancel, ppHeaders)).json()).results, ["ending_at_period_end"]);
  a = await store.account(s.account_id); assert.equal(a.tier, "agency"); assert.equal(a.billing_status, "ending");
  const susp = ppEvent("WH-EV-3", "BILLING.SUBSCRIPTION.SUSPENDED", { id: "I-SUB1", status: "SUSPENDED", plan_id: "P-AGENCY", custom_id: s.account_id });
  assert.deepEqual((await (await post("/webhooks/paypal", susp, ppHeaders)).json()).results, ["downgraded_free"]);
  assert.equal((await store.account(s.account_id)).tier, "free");
  const bad = makeApp(PAYPAL, { fetchImpl: paypalMock("FAILURE") });
  assert.equal((await bad.post("/webhooks/paypal", act, ppHeaders)).status, 400);
  assert.equal((await post("/webhooks/paypal", act, {})).status, 400, "missing transmission headers");
});

test("PayPal: upgrade on an active PayPal subscription uses /revise", async () => {
  const f = paypalMock(); const { signup, post, store } = makeApp(PAYPAL, { fetchImpl: f });
  const s = await signup(); await store.setBilling(s.account_id, { provider: "paypal", subscription: "I-SUB9", status: "active" }); await store.setTier(s.account_id, "pro");
  const r = await (await post("/v1/billing/checkout", { tier: "agency" }, { authorization: `Bearer ${s.api_key}` })).json();
  assert.match(r.url, /revise/); assert.ok(f.calls.some(c => c.url.endsWith("/v1/billing/subscriptions/I-SUB9/revise")));
});

const whopSign = (secret, id, ts, body) => `v1,${createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64")}`;
test("Whop: checkout configuration carries account metadata; signed membership webhooks map to tiers", async () => {
  const f = mockFetch([["https://api.whop.com/api/v1/checkout_configurations", (u, i) => ({ id: "ch_1", purchase_url: "https://whop.com/checkout/plan_pro?session=ch_1" })]]);
  const { signup, post, store } = makeApp(WHOP, { fetchImpl: f });
  const s = await signup();
  const c = await (await post("/v1/billing/checkout", { tier: "pro", provider: "whop" }, { authorization: `Bearer ${s.api_key}` })).json();
  assert.equal(c.provider, "whop"); assert.match(c.url, /whop\.com\/checkout/);
  const sent = f.calls[0]; const b = JSON.parse(sent.init.body);
  assert.equal(b.plan_id, "plan_pro"); assert.equal(b.metadata.account_id, s.account_id); assert.equal(sent.init.headers["Api-Version-Date"], "2026-10-09-2");
  const ev = JSON.stringify({ id: "msg_1", type: "membership.activated", api_version: "v1", data: { id: "mem_1", status: "active", plan: { id: "plan_agency" }, user: { id: "user_1" }, metadata: { account_id: s.account_id } } });
  const ts = String(Math.floor(Date.now() / 1000));
  const ok = await post("/webhooks/whop", ev, { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": whopSign(WHOP.WHOP_WEBHOOK_SECRET, "msg_1", ts, ev) });
  assert.deepEqual((await ok.json()).results, ["tier_agency"]); assert.equal((await store.account(s.account_id)).tier, "agency");
  const tampered = await post("/webhooks/whop", ev.replace("plan_agency", "plan_pro"), { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": whopSign(WHOP.WHOP_WEBHOOK_SECRET, "msg_1", ts, ev) });
  assert.equal(tampered.status, 400);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal((await post("/webhooks/whop", ev, { "webhook-id": "msg_1", "webhook-timestamp": old, "webhook-signature": whopSign(WHOP.WHOP_WEBHOOK_SECRET, "msg_1", old, ev) })).status, 400, "replay window");
  const de = JSON.stringify({ id: "msg_2", type: "membership.deactivated", data: { id: "mem_1", status: "canceled", plan: { id: "plan_agency" }, metadata: { account_id: s.account_id } } });
  await post("/webhooks/whop", de, { "webhook-id": "msg_2", "webhook-timestamp": ts, "webhook-signature": whopSign(WHOP.WHOP_WEBHOOK_SECRET, "msg_2", ts, de) });
  assert.equal((await store.account(s.account_id)).tier, "free");
});

const stripeSig = (secret, body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
test("Stripe (pluggable): checkout session + signed webhooks map price -> tier; deleted -> free", async () => {
  const sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: {}, items: { data: [{ price: { id: "price_growth" }, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30 }] } };
  const f = mockFetch([["https://api.stripe.com/v1/checkout/sessions", () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" })], ["https://api.stripe.com/v1/subscriptions/sub_1", () => sub]]);
  const { signup, post, store } = makeApp(STRIPE, { fetchImpl: f });
  const s = await signup();
  const c = await (await post("/v1/billing/checkout", { tier: "pro", provider: "stripe" }, { authorization: `Bearer ${s.api_key}` })).json();
  assert.equal(c.url, "https://checkout.stripe.com/c/cs_1");
  const form = new URLSearchParams(f.calls[0].init.body); assert.equal(form.get("mode"), "subscription"); assert.equal(form.get("line_items[0][price]"), "price_pro"); assert.equal(form.get("client_reference_id"), s.account_id);
  const done = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", customer: "cus_1", client_reference_id: s.account_id } } });
  assert.deepEqual((await (await post("/webhooks/stripe", done, { "stripe-signature": stripeSig(STRIPE.STRIPE_WEBHOOK_SECRET, done) })).json()).results, ["tier_growth"]);
  assert.equal((await post("/webhooks/stripe", done, { "stripe-signature": stripeSig("whsec_wrong", done) })).status, 400);
  const del = JSON.stringify({ id: "evt_2", type: "customer.subscription.deleted", data: { object: { ...sub, status: "canceled" } } });
  assert.deepEqual((await (await post("/webhooks/stripe", del, { "stripe-signature": stripeSig(STRIPE.STRIPE_WEBHOOK_SECRET, del) })).json()).results, ["downgraded_free"]);
  assert.equal((await store.account(s.account_id)).tier, "free");
});

test("default provider: BILLING_PROVIDER wins when configured, else PayPal -> Whop -> Stripe", async () => {
  const { providers, defaultProvider } = await import("../dist/hosted/billing/index.js");
  const env = { ...WHOP, ...STRIPE }; assert.equal(defaultProvider(env, providers(env, fetch)), "whop");
  const env2 = { ...PAYPAL, ...WHOP, BILLING_PROVIDER: "whop" }; assert.equal(defaultProvider(env2, providers(env2, fetch)), "whop");
  const env3 = { ...PAYPAL, BILLING_PROVIDER: "stripe" }; assert.equal(defaultProvider(env3, providers(env3, fetch)), "paypal");
});

test("unknown plan id does not change tier", async () => {
  const { signup, post, store } = makeApp(PAYPAL, { fetchImpl: paypalMock() });
  const s = await signup();
  const ev = ppEvent("WH-X", "BILLING.SUBSCRIPTION.ACTIVATED", { id: "I-Z", status: "ACTIVE", plan_id: "P-UNKNOWN", custom_id: s.account_id });
  assert.deepEqual((await (await post("/webhooks/paypal", ev, ppHeaders)).json()).results, ["unknown_plan"]);
  assert.equal((await store.account(s.account_id)).tier, "free");
});
