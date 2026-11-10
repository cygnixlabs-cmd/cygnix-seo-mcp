// Stripe (pluggable, for later). Checkout Sessions in subscription mode + Billing Portal + signed webhooks.
// Inert until STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and at least one STRIPE_PRICE_* are set.
import { BillingError, missing, type BillingProvider, type BillingUpdate, type ProviderFactory } from "./provider.js";
import { PAID_TIERS, planIdFor } from "../tiers.js";
import { hmacSha256Hex, timingSafeEqual } from "../crypto.js";

export async function verifyStripeSignature(secret: string, rawBody: string, header: string | null, toleranceSec = 300, nowS = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = header.split(","); const t = parts.find(p => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!t || !/^\d+$/.test(t) || !sigs.length || Math.abs(nowS - Number(t)) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return sigs.some(s => timingSafeEqual(s, expected));
}
const form = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export const createStripe: ProviderFactory = (env, fetchImpl) => {
  async function api<T>(path: string, body?: Record<string, string | undefined>): Promise<T> {
    const r = await fetchImpl(`https://api.stripe.com/v1${path}`, { method: body ? "POST" : "GET", body: body ? form(body) : undefined,
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" } });
    const text = await r.text();
    if (!r.ok) throw new BillingError(502, "stripe_api", `Stripe ${path} failed (${r.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
  const fromSub = (eventId: string, type: string, s: any, accountId?: string | null): BillingUpdate => {
    const st: string = s.status || "";
    const state = type === "customer.subscription.deleted" || ["canceled", "unpaid", "incomplete_expired"].includes(st) ? "ending" : ["active", "trialing"].includes(st) ? "active" : "pending";
    const item = s.items?.data?.[0];
    return { provider: "stripe", eventId, eventType: type, accountId: accountId ?? s.metadata?.account_id ?? null, customerId: s.customer ?? null,
      subscriptionId: s.id ?? null, planId: item?.price?.id ?? null, state, status: st, paidThrough: state === "ending" ? null : (item?.current_period_end ?? s.current_period_end ?? null) };
  };
  const p: BillingProvider = {
    id: "stripe", label: "Card (Stripe)", kind: "subscription",
    missingEnv: () => {
      const m = missing(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
      if (!PAID_TIERS.some(t => planIdFor("stripe", t, env))) m.push("STRIPE_PRICE_PRO|STRIPE_PRICE_GROWTH|STRIPE_PRICE_AGENCY");
      return m;
    },
    async createCheckout(account, tier, urls) {
      const price = planIdFor("stripe", tier, env);
      if (!price) throw new BillingError(400, "plan_unavailable", `No Stripe price configured for ${tier}.`);
      const s = await api<{ id: string; url: string }>("/checkout/sessions", {
        mode: "subscription", "line_items[0][price]": price, "line_items[0][quantity]": "1",
        success_url: urls.successUrl, cancel_url: urls.cancelUrl, client_reference_id: account.id, allow_promotion_codes: "true",
        ...(account.billing_provider === "stripe" && account.billing_customer_id ? { customer: account.billing_customer_id } : { customer_email: account.email }),
        "metadata[account_id]": account.id, "subscription_data[metadata][account_id]": account.id,
      });
      return { provider: "stripe", url: s.url, reference: s.id };
    },
    async manageUrl(account, returnUrl) {
      if (account.billing_provider !== "stripe" || !account.billing_customer_id) return null;
      const s = await api<{ url: string }>("/billing_portal/sessions", { customer: account.billing_customer_id, return_url: returnUrl });
      return s.url;
    },
    async parseWebhook(rawBody, h) {
      if (!(await verifyStripeSignature(String(env.STRIPE_WEBHOOK_SECRET), rawBody, h.get("stripe-signature")))) return null;
      let e: any; try { e = JSON.parse(rawBody); } catch { return null; }
      const o = e.data?.object || {};
      if (e.type === "checkout.session.completed" && o.mode === "subscription" && o.subscription) {
        const sub = await api<any>(`/subscriptions/${encodeURIComponent(o.subscription)}`);
        return [fromSub(e.id, e.type, sub, o.client_reference_id ?? o.metadata?.account_id)];
      }
      if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(e.type)) return [fromSub(e.id, e.type, o)];
      return [];
    },
  };
  return p;
};
