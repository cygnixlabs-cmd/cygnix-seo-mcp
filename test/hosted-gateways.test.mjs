import test from "node:test"; import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeApp, mockFetch } from "./helpers.mjs";
import { npSort } from "../dist/hosted/billing/crypto.js";
import { parseWallets } from "../dist/hosted/billing/manual.js";

const NOW = { NOWPAYMENTS_API_KEY: "np_key", NOWPAYMENTS_IPN_SECRET: "ipn_secret" };
const WALLETS = { CRYPTO_WALLETS: "USDT (TRC-20)=TXyz123; USDC (Base)=0xabc" };
const auth = k => ({ authorization: `Bearer ${k}` });
const npSig = (secret, body) => createHmac("sha512", secret).update(JSON.stringify(npSort(body))).digest("hex");
const npMock = () => mockFetch([["https://api.nowpayments.io/v1/invoice", (u, i) => ({ id: "4522625843", invoice_url: "https://nowpayments.io/payment/?iid=4522625843", echo: JSON.parse(i.body) })]]);

test("checkout page data lists only enabled providers, in BILLING_PROVIDER_ORDER", async () => {
  const none = await (await makeApp().req("/v1/plans")).json();
  assert.deepEqual(none.providers, []); assert.equal(none.default_provider, null);
  const { req } = makeApp({ ...WALLETS, PAYONEER_ENABLED: "true", PAYPAL_ME_URL: "https://paypal.me/cygnix", BILLING_PROVIDER_ORDER: "crypto_wallet,payoneer" });
  const p = await (await req("/v1/plans")).json();
  assert.deepEqual(p.providers.map(x => x.id), ["crypto_wallet", "payoneer", "paypal_link"]);
  assert.ok(p.providers.every(x => x.kind === "manual" && x.recurring === false && x.label));
  assert.equal(p.prepaid_period_days, 30);
  assert.deepEqual(parseWallets("A=1;;B = 2\nbad\nC="), [{ label: "A", address: "1" }, { label: "B", address: "2" }]);
});

test("crypto (NOWPayments): invoice carries our order id + IPN url; signed 'finished' IPN activates once; tampered/short/repeat rejected", async () => {
  const f = npMock(); const { signup, post, req, store } = makeApp(NOW, { fetchImpl: f });
  const s = await signup();
  const c = await (await post("/v1/billing/checkout", { tier: "growth", provider: "crypto" }, auth(s.api_key))).json();
  assert.equal(c.kind, "invoice"); assert.match(c.url, /nowpayments\.io\/payment/); assert.match(c.order_id, /^ord_[A-Za-z0-9]{24}$/); assert.equal(c.amount_usd, 39);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(f.calls[0].init.headers["x-api-key"], "np_key"); assert.equal(sent.order_id, c.order_id); assert.equal(sent.price_amount, 39); assert.equal(sent.price_currency, "usd");
  assert.equal(sent.ipn_callback_url, "https://mcp.test/webhooks/crypto"); assert.equal(sent.success_url, `https://mcp.test/pay/${c.order_id}`);
  assert.equal((await store.order(c.order_id)).external_id, "4522625843");
  const ipn = (status, extra = {}) => ({ payment_id: 5077125051, invoice_id: 4522625843, payment_status: status, pay_address: "addr", price_amount: 39, price_currency: "usd", pay_amount: 39.1, actually_paid: 39.1, pay_currency: "usdttrc20", order_id: c.order_id, order_description: "x", parent_payment_id: null, fee: { currency: "usdttrc20", depositFee: 0.1 }, ...extra });
  const send = (body, sig = npSig(NOW.NOWPAYMENTS_IPN_SECRET, body)) => post("/webhooks/crypto", body, { "x-nowpayments-sig": sig });
  assert.deepEqual((await (await send(ipn("confirming"))).json()).results, ["order_confirming"]);
  assert.equal((await store.account(s.account_id)).tier, "free");
  const fin = ipn("finished");
  assert.equal((await send(fin, npSig("wrong", fin))).status, 400, "bad signature");
  assert.equal((await send({ ...fin, price_amount: 15 }, npSig(NOW.NOWPAYMENTS_IPN_SECRET, fin))).status, 400, "tampered body");
  assert.deepEqual((await (await send(fin)).json()).results, ["tier_growth"]);
  const a = await store.account(s.account_id); assert.equal(a.tier, "growth"); assert.equal(a.billing_status, "prepaid"); assert.equal(a.billing_provider, "crypto");
  assert.ok(Math.abs(a.paid_through - (Date.now() / 1000 + 30 * 86400)) < 60);
  assert.deepEqual((await (await send(fin)).json()).results, ["duplicate"]);
  // a second order paid short is not activated
  const c2 = await (await post("/v1/billing/checkout", { tier: "agency", provider: "crypto" }, auth(s.api_key))).json();
  const short = { ...ipn("finished", { payment_id: 2, order_id: c2.order_id }), price_amount: 39 };
  assert.deepEqual((await (await send(short)).json()).results, ["amount_mismatch"]);
  const rep = { ...ipn("finished", { payment_id: 3, order_id: c2.order_id, parent_payment_id: 5077125051 }), price_amount: 99 };
  assert.deepEqual((await (await send(rep)).json()).results, ["order_finished"], "repeated deposits are recorded, not auto-activated");
  assert.equal((await store.account(s.account_id)).tier, "growth");
  const page = await (await req(`/pay/${c.order_id}`)).text(); assert.match(page, /Paid\. Your plan is active/);
});

test("manual gateways: Payoneer/PayPal.me/wallet orders -> pay page -> payer reference -> admin activates; renewals stack", async () => {
  const env = { ...WALLETS, PAYONEER_ENABLED: "true", PAYONEER_LINK_PRO: "https://link.payoneer.com/Token?t=PRO", PAYPAL_ME_URL: "https://paypal.me/cygnix/", ADMIN_TOKEN: "adm" };
  const { signup, post, req, store } = makeApp(env);
  const s = await signup("buyer@x.co");
  const pp = await (await post("/v1/billing/checkout", { tier: "pro", provider: "paypal_link" }, auth(s.api_key))).json();
  assert.equal(pp.kind, "manual"); assert.equal(pp.url, `https://mcp.test/pay/${pp.order_id}`);
  let html = await (await req(`/pay/${pp.order_id}`)).text();
  assert.match(html, /https:\/\/paypal\.me\/cygnix\/15\.00USD/); assert.match(html, new RegExp(pp.order_id)); assert.match(html, /noindex/);
  const py = await (await post("/v1/billing/checkout", { tier: "pro", provider: "payoneer" }, auth(s.api_key))).json();
  assert.match(await (await req(`/pay/${py.order_id}`)).text(), /link\.payoneer\.com\/Token\?t=PRO/);
  const pg = await (await post("/v1/billing/checkout", { tier: "growth", provider: "payoneer" }, auth(s.api_key))).json();
  assert.match(await (await req(`/pay/${pg.order_id}`)).text(), /send a Payoneer payment request for \$39\.00 USD to buyer@x\.co/, "no link for this tier -> payment request flow");
  const w = await (await post("/v1/billing/checkout", { tier: "pro", provider: "crypto_wallet" }, auth(s.api_key))).json();
  html = await (await req(`/pay/${w.order_id}`)).text(); assert.match(html, /TXyz123/); assert.match(html, /USDC \(Base\)/);
  // payer submits a reference (form post)
  html = await (await req(`/pay/${w.order_id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "reference=0xdeadbeef" })).text();
  assert.match(html, /reference received/); assert.equal((await store.order(w.order_id)).payer_reference, "0xdeadbeef");
  assert.equal((await store.account(s.account_id)).tier, "free", "nothing activates without the admin");
  // admin
  const A = { authorization: "Bearer adm" };
  const pending = await (await req("/admin/orders?status=pending", { headers: A })).json(); assert.equal(pending.orders.length, 4);
  assert.equal((await post(`/admin/orders/${w.order_id}/activate`, {}, { authorization: "Bearer nope" })).status, 401);
  const act = await (await post(`/admin/orders/${w.order_id}/activate`, {}, A)).json();
  assert.equal(act.tier, "pro"); assert.equal((await store.account(s.account_id)).tier, "pro");
  assert.equal((await post(`/admin/orders/${w.order_id}/activate`, {}, A)).status, 409, "activates once");
  const first = (await store.account(s.account_id)).paid_through;
  await post(`/admin/orders/${py.order_id}/activate`, {}, A);
  assert.equal((await store.account(s.account_id)).paid_through, first + 30 * 86400, "same-tier renewal stacks");
  assert.equal((await (await post(`/admin/orders/${pp.order_id}/cancel`, {}, A)).json()).order.status, "cancelled");
  assert.match(await (await req(`/pay/${pp.order_id}`)).text(), /This order is cancelled/);
  const mine = await (await req("/v1/billing/orders", { headers: auth(s.api_key) })).json(); assert.equal(mine.orders.length, 4); assert.ok(mine.orders[0].pay_url);
  const m = await post("/v1/billing/manage", {}, auth(s.api_key)); assert.equal(m.status, 404); assert.equal((await m.json()).error.code, "prepaid");
});

test("prepaid plans expire to free; admin grant works for any gateway without webhooks", async () => {
  const { signup, post, call, store } = makeApp({ ADMIN_TOKEN: "adm" });
  const s = await signup();
  const g = await (await post(`/admin/accounts/${s.account_id}/grant`, { tier: "agency", days: 7, provider: "whop", reference: "manual-123" }, { authorization: "Bearer adm" })).json();
  assert.equal(g.tier, "agency"); assert.equal(g.order.status, "paid"); assert.equal(g.order.payer_reference, "manual-123"); assert.equal(g.order.period_days, 7);
  assert.match((await call(s.api_key, "account_status")).body.result.content[0].text, /Plan: Agency/);
  await store.setBilling(s.account_id, { paidThrough: Math.floor(Date.now() / 1000) - 10 });
  assert.match((await call(s.api_key, "account_status")).body.result.content[0].text, /Plan: Free/, "expired prepaid -> free");
  assert.equal((await post(`/admin/accounts/${s.account_id}/grant`, { tier: "free" }, { authorization: "Bearer adm" })).status, 400);
});

test("unpaid manual orders are capped per account; failing gateway marks the order failed", async () => {
  const f = mockFetch([["https://api.nowpayments.io/v1/invoice", () => new Response("nope", { status: 500 })]]);
  const { signup, post, store } = makeApp({ ...NOW, ...WALLETS }, { fetchImpl: f });
  const s = await signup();
  assert.equal((await post("/v1/billing/checkout", { tier: "pro", provider: "crypto" }, auth(s.api_key))).status, 502);
  assert.equal((await store.listOrders({ accountId: s.account_id }))[0].status, "failed");
  for (let i = 0; i < 5; i++) assert.equal((await post("/v1/billing/checkout", { tier: "pro", provider: "crypto_wallet" }, auth(s.api_key))).status, 200);
  assert.equal((await post("/v1/billing/checkout", { tier: "pro", provider: "crypto_wallet" }, auth(s.api_key))).status, 429);
  assert.equal((await post("/v1/billing/checkout", { tier: "pro", provider: "payoneer" }, auth(s.api_key))).status, 503, "disabled provider refused");
});

test("OpenAI domain-verification token is served only when configured", async () => {
  assert.equal((await makeApp().req("/.well-known/openai-apps-challenge")).status, 404);
  const r = await makeApp({ OPENAI_APPS_CHALLENGE: "tok_abc\n" }).req("/.well-known/openai-apps-challenge");
  assert.equal(r.status, 200); assert.equal(await r.text(), "tok_abc"); assert.match(r.headers.get("content-type"), /text\/plain/);
});
