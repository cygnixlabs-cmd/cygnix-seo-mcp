#!/usr/bin/env node
// One-time helper the OWNER runs to create the PayPal product + 3 monthly plans (Pro $15, Growth $39, Agency $99).
// Sandbox by default. Prints the PAYPAL_PLAN_* values to set as secrets. Creates billing objects, so it is never run in CI.
//   PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/paypal-create-plans.mjs
const env = process.env; const base = env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) { console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET"); process.exit(1); }
const tok = await (await fetch(`${base}/v1/oauth2/token`, { method: "POST", body: "grant_type=client_credentials",
  headers: { Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" } })).json();
const api = async (path, body) => { const r = await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" } });
  const j = await r.json(); if (!r.ok) { console.error(path, r.status, JSON.stringify(j)); process.exit(1); } return j; };
const product = await api("/v1/catalogs/products", { name: "Cygnix SEO MCP", description: "Hosted SEO and AI-search MCP server", type: "SERVICE", category: "SOFTWARE", home_url: "https://mcp.cygnixlabs.com" });
for (const [tier, price] of [["PRO", "15"], ["GROWTH", "39"], ["AGENCY", "99"]]) {
  const plan = await api("/v1/billing/plans", { product_id: product.id, name: `Cygnix SEO MCP ${tier[0] + tier.slice(1).toLowerCase()}`, status: "ACTIVE",
    billing_cycles: [{ frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: price, currency_code: "USD" } } }],
    payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 2 } });
  console.log(`PAYPAL_PLAN_${tier}=${plan.id}`);
}
