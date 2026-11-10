// PayPal Subscriptions (Plans + Subscriptions API v1). Inert until PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_WEBHOOK_ID and at least one PAYPAL_PLAN_* are set. Webhooks are verified with PayPal's
// /v1/notifications/verify-webhook-signature endpoint (no local cert handling needed).
import { BillingError, missing, isoToSec, type BillingProvider, type BillingUpdate, type ProviderFactory } from "./provider.js";
import { PAID_TIERS, planIdFor } from "../tiers.js";

export const paypalBase = (env: Record<string, unknown>) => env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export const createPayPal: ProviderFactory = (env, fetchImpl) => {
  const base = paypalBase(env);
  let cached: { token: string; exp: number } | null = null;
  async function token() {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const r = await fetchImpl(`${base}/v1/oauth2/token`, { method: "POST", body: "grant_type=client_credentials",
      headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new BillingError(502, "paypal_auth", `PayPal auth failed (${r.status})`);
    const j = await r.json() as { access_token: string; expires_in: number };
    cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return j.access_token;
  }
  async function api<T>(path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
    const r = await fetchImpl(`${base}${path}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Prefer: "return=representation" } });
    const text = await r.text();
    if (!r.ok) throw new BillingError(502, "paypal_api", `PayPal ${path} failed (${r.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
  const approveLink = (j: { links?: { rel: string; href: string }[] }) => j.links?.find(l => l.rel === "approve")?.href;
  const p: BillingProvider = {
    id: "paypal", label: "PayPal",
    missingEnv: () => {
      const m = missing(env, ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"]);
      if (!PAID_TIERS.some(t => planIdFor("paypal", t, env))) m.push("PAYPAL_PLAN_PRO|PAYPAL_PLAN_GROWTH|PAYPAL_PLAN_AGENCY");
      return m;
    },
    async createCheckout(account, tier, urls) {
      const plan_id = planIdFor("paypal", tier, env);
      if (!plan_id) throw new BillingError(400, "plan_unavailable", `No PayPal plan configured for ${tier}.`);
      const ctx = { brand_name: "Cygnix Labs", user_action: "SUBSCRIBE_NOW", shipping_preference: "NO_SHIPPING", return_url: urls.successUrl, cancel_url: urls.cancelUrl };
      // Already on PayPal: revise the existing subscription (upgrade/downgrade) instead of creating a second one.
      if (account.billing_provider === "paypal" && account.billing_subscription_id && account.billing_status === "active") {
        const j = await api<{ links?: { rel: string; href: string }[] }>(`/v1/billing/subscriptions/${encodeURIComponent(account.billing_subscription_id)}/revise`, { plan_id, application_context: ctx });
        const url = approveLink(j); if (!url) throw new BillingError(502, "paypal_api", "PayPal revise returned no approval link.");
        return { provider: "paypal", url, reference: account.billing_subscription_id };
      }
      const j = await api<{ id: string; links?: { rel: string; href: string }[] }>("/v1/billing/subscriptions",
        { plan_id, custom_id: account.id, subscriber: { email_address: account.email }, application_context: ctx });
      const url = approveLink(j); if (!url) throw new BillingError(502, "paypal_api", "PayPal returned no approval link.");
      return { provider: "paypal", url, reference: j.id };
    },
    async manageUrl() { return env.PAYPAL_ENV === "live" ? "https://www.paypal.com/myaccount/autopay/" : "https://www.sandbox.paypal.com/myaccount/autopay/"; },
    async parseWebhook(rawBody, h) {
      let event: any; try { event = JSON.parse(rawBody); } catch { return null; }
      const need = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
      if (need.some(n => !h.get(n))) return null;
      const v = await api<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
        auth_algo: h.get("paypal-auth-algo"), cert_url: h.get("paypal-cert-url"), transmission_id: h.get("paypal-transmission-id"),
        transmission_sig: h.get("paypal-transmission-sig"), transmission_time: h.get("paypal-transmission-time"),
        webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
      });
      if (v.verification_status !== "SUCCESS") return null;
      const type: string = event.event_type || ""; const r = event.resource || {};
      if (!type.startsWith("BILLING.SUBSCRIPTION.")) return [];
      const status: string = r.status || type.split(".").pop();
      let state: BillingUpdate["state"] = "pending";
      if (["BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED"].includes(type) || ["CANCELLED", "EXPIRED", "SUSPENDED"].includes(status)) state = "ending";
      else if (status === "ACTIVE") state = "active";
      const paidThrough = isoToSec(r.billing_info?.next_billing_time) ?? null;
      return [{ provider: "paypal", eventId: event.id, eventType: type, accountId: r.custom_id ?? null, subscriptionId: r.id ?? null,
        customerId: r.subscriber?.payer_id ?? null, planId: r.plan_id ?? null, state, status, paidThrough:
          type === "BILLING.SUBSCRIPTION.SUSPENDED" || type === "BILLING.SUBSCRIPTION.EXPIRED" ? null : paidThrough }];
    },
  };
  return p;
};
