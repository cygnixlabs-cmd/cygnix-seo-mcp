// Whop (second, non-Stripe provider). Checkout via POST /api/v1/checkout_configurations with
// metadata.account_id (Whop copies metadata to the membership). Webhooks use the Standard Webhooks
// spec: base64 HMAC-SHA256 of "{webhook-id}.{webhook-timestamp}.{raw body}" keyed with the ws_ secret.
// Inert until WHOP_API_KEY, WHOP_WEBHOOK_SECRET and at least one WHOP_PLAN_* are set.
import { BillingError, missing, isoToSec, type BillingProvider, type ProviderFactory } from "./provider.js";
import { PAID_TIERS, planIdFor } from "../tiers.js";
import { hmacSha256B64, timingSafeEqual } from "../crypto.js";

export const WHOP_API_VERSION_DATE = "2026-10-09-2"; // pinned: plan_id (later versions rename plans to variants)

export async function verifyStandardWebhook(secret: string, rawBody: string, h: Headers, toleranceSec = 300, nowS = Math.floor(Date.now() / 1000)) {
  const id = h.get("webhook-id"), ts = h.get("webhook-timestamp"), sig = h.get("webhook-signature");
  if (!id || !ts || !sig) return false;
  if (!/^\d+$/.test(ts) || Math.abs(nowS - Number(ts)) > toleranceSec) return false;
  const expected = await hmacSha256B64(secret, `${id}.${ts}.${rawBody}`);
  return sig.split(" ").some(part => { const [v, s] = part.split(","); return v === "v1" && !!s && timingSafeEqual(s, expected); });
}

export const createWhop: ProviderFactory = (env, fetchImpl) => {
  const base = String(env.WHOP_API_BASE || "https://api.whop.com/api/v1").replace(/\/+$/, "");
  const p: BillingProvider = {
    id: "whop", label: "Whop",
    missingEnv: () => {
      const m = missing(env, ["WHOP_API_KEY", "WHOP_WEBHOOK_SECRET"]);
      if (!PAID_TIERS.some(t => planIdFor("whop", t, env))) m.push("WHOP_PLAN_PRO|WHOP_PLAN_GROWTH|WHOP_PLAN_AGENCY");
      return m;
    },
    async createCheckout(account, tier, urls) {
      const plan_id = planIdFor("whop", tier, env);
      if (!plan_id) throw new BillingError(400, "plan_unavailable", `No Whop plan configured for ${tier}.`);
      const r = await fetchImpl(`${base}/checkout_configurations`, { method: "POST",
        headers: { Authorization: `Bearer ${env.WHOP_API_KEY}`, "Content-Type": "application/json", "Api-Version-Date": WHOP_API_VERSION_DATE },
        body: JSON.stringify({ plan_id, metadata: { account_id: account.id, tier }, redirect_url: urls.successUrl }) });
      const text = await r.text();
      if (!r.ok) throw new BillingError(502, "whop_api", `Whop checkout failed (${r.status}): ${text.slice(0, 300)}`);
      const j = JSON.parse(text) as { id?: string; purchase_url?: string };
      if (!j.purchase_url) throw new BillingError(502, "whop_api", "Whop returned no purchase_url.");
      return { provider: "whop", url: j.purchase_url, reference: j.id };
    },
    async manageUrl() { return "https://whop.com/@me/settings/memberships/"; },
    async parseWebhook(rawBody, h) {
      if (!(await verifyStandardWebhook(String(env.WHOP_WEBHOOK_SECRET), rawBody, h))) return null;
      let e: any; try { e = JSON.parse(rawBody); } catch { return null; }
      const type: string = e.type || ""; const d = e.data || {};
      if (!type.startsWith("membership.")) return [];
      const state = type === "membership.activated" ? "active" : type === "membership.deactivated" ? "ending" : "pending";
      return [{ provider: "whop", eventId: e.id || h.get("webhook-id")!, eventType: type, accountId: d.metadata?.account_id ?? null,
        subscriptionId: d.id ?? null, customerId: d.user?.id ?? null, planId: d.plan?.id ?? d.plan_id ?? d.variant?.id ?? d.variant_id ?? null, state,
        status: d.status || type.split(".")[1], paidThrough: state === "ending" ? null : isoToSec(d.renewal_period_end) }];
    },
  };
  return p;
};
