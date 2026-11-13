import type { HostedEnv } from "../env.js";
import { prepaidDays } from "../env.js";
import type { Store, Order } from "../store.js";
import { nowSec } from "../store.js";
import { tierForPlan, TIERS, type ProviderId, type TierId } from "../tiers.js";
import type { BillingProvider, BillingUpdate, ProviderFactory } from "./provider.js";
import { createPayPal } from "./paypal.js";
import { createWhop } from "./whop.js";
import { createStripe } from "./stripe.js";
import { createCrypto } from "./crypto.js";
import { createPayoneer, createPayPalLink, createCryptoWallet } from "./manual.js";
export * from "./provider.js";

/** Provider registry. Add a gateway = one file implementing BillingProvider + one registerProvider() line. */
const FACTORIES = new Map<ProviderId, ProviderFactory>();
export const DEFAULT_PROVIDER_ORDER: ProviderId[] = [];
export function registerProvider(id: ProviderId, factory: ProviderFactory) {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) throw new Error(`bad provider id ${id}`);
  FACTORIES.set(id, factory); if (!DEFAULT_PROVIDER_ORDER.includes(id)) DEFAULT_PROVIDER_ORDER.push(id);
}
registerProvider("paypal", createPayPal);           // PayPal Subscriptions (needs PayPal Business)
registerProvider("whop", createWhop);
registerProvider("stripe", createStripe);
registerProvider("crypto", createCrypto);           // hosted crypto invoice + IPN (NOWPayments)
registerProvider("payoneer", createPayoneer);       // manual
registerProvider("paypal_link", createPayPalLink);  // manual (PayPal.me, personal account OK)
registerProvider("crypto_wallet", createCryptoWallet); // manual
/** Kept for callers that import the old name. */
export const PROVIDER_ORDER = DEFAULT_PROVIDER_ORDER;

export function providers(env: HostedEnv, fetchImpl: typeof fetch): Record<ProviderId, BillingProvider> {
  return Object.fromEntries([...FACTORIES].map(([id, f]) => [id, f(env, fetchImpl)]));
}
/** Display order: BILLING_PROVIDER_ORDER (comma list) first, then the registry order. */
export function providerOrder(env?: HostedEnv): ProviderId[] {
  const pref = String(env?.BILLING_PROVIDER_ORDER ?? "").split(",").map(s => s.trim()).filter(id => FACTORIES.has(id));
  return [...new Set([...pref, ...DEFAULT_PROVIDER_ORDER])];
}
export const configuredProviders = (all: Record<ProviderId, BillingProvider>, env?: HostedEnv) => providerOrder(env).filter(id => all[id] && all[id].missingEnv().length === 0);
export function defaultProvider(env: HostedEnv, all: Record<ProviderId, BillingProvider>): ProviderId | null {
  const ok = configuredProviders(all, env);
  const pref = env.BILLING_PROVIDER as ProviderId | undefined;
  return pref && ok.includes(pref) ? pref : ok[0] ?? null;
}
export const providerSummary = (all: Record<ProviderId, BillingProvider>, env?: HostedEnv) =>
  configuredProviders(all, env).map(id => ({ id, label: all[id].label, kind: all[id].kind, recurring: all[id].kind === "subscription" }));

/** Grant an order's tier for its prepaid period. Renewing the same tier stacks onto the remaining time. */
export async function activateOrder(store: Store, order: Order): Promise<{ tier: TierId; paid_through: number }> {
  const a = await store.account(order.account_id); if (!a) throw new Error("order account missing");
  const now = nowSec();
  const start = a.billing_status === "prepaid" && a.tier === order.tier && a.paid_through && a.paid_through > now ? a.paid_through : now;
  const paidThrough = start + order.period_days * 86400;
  await store.setBilling(a.id, { provider: order.provider, subscription: order.id, status: "prepaid", paidThrough });
  await store.setTier(a.id, order.tier);
  return { tier: order.tier, paid_through: paidThrough };
}
/** Admin / manual path for any gateway: record a paid order and activate it. */
export async function grantPaid(store: Store, env: HostedEnv, f: { accountId: string; tier: TierId; provider: string; days?: number; reference?: string | null; amountUsd?: number }) {
  const o = await store.createOrder({ accountId: f.accountId, provider: f.provider, tier: f.tier, amountUsd: f.amountUsd ?? TIERS[f.tier].priceUsdMonthly, periodDays: f.days ?? prepaidDays(env) });
  await store.updateOrder(o.id, { payerReference: f.reference ?? null, note: "admin grant" });
  await store.markOrderPaid(o.id);
  return { order: (await store.order(o.id))!, ...(await activateOrder(store, (await store.order(o.id))!)) };
}

/** Apply one verified, normalized billing event to the account it belongs to. Returns what happened (for logs/tests). */
export async function applyBillingUpdate(store: Store, env: HostedEnv, u: BillingUpdate): Promise<string> {
  if (u.orderId) {
    const o = await store.order(u.orderId);
    if (!o || o.provider !== u.provider) return "no_order";
    if (u.subscriptionId && !o.external_id) await store.updateOrder(o.id, { externalId: u.subscriptionId });
    if (u.state !== "paid") { if (o.status === "pending" && ["failed", "expired", "refunded"].includes(u.status)) await store.updateOrder(o.id, { status: u.status === "refunded" ? "cancelled" : u.status, note: `gateway: ${u.status}` });
      return `order_${u.status || "pending"}`; }
    if (u.amountUsd == null || u.amountUsd + 0.005 < o.amount_usd) { await store.updateOrder(o.id, { note: `amount mismatch: got ${u.amountUsd ?? "?"} USD` }); return "amount_mismatch"; }
    if (!(await store.markOrderPaid(o.id, u.subscriptionId))) return o.status === "paid" ? "already_paid" : `order_${o.status}`;
    const r = await activateOrder(store, (await store.order(o.id))!);
    return `tier_${r.tier}`;
  }
  let acct = u.accountId ? await store.account(u.accountId) : null;
  if (!acct && u.subscriptionId) acct = await store.accountBySubscription(u.provider, u.subscriptionId);
  if (!acct && u.customerId) acct = await store.accountByCustomer(u.provider, u.customerId);
  if (!acct) return "no_account";
  const sameSub = !acct.billing_subscription_id || acct.billing_provider !== u.provider || acct.billing_subscription_id === u.subscriptionId;
  if (u.state === "ending") {
    // PayPal CANCELLED stops future billing but the paid period stays usable; Stripe deleted / Whop deactivated mean access has ended.
    // Ignore an old subscription ending after the customer already moved to a new one (or onto a prepaid plan).
    if (!sameSub && (acct.billing_status === "active" || acct.billing_status === "prepaid")) return "ignored_stale";
    await store.setBilling(acct.id, { provider: u.provider, subscription: u.subscriptionId ?? acct.billing_subscription_id, status: "ending",
      paidThrough: acct.paid_through && acct.paid_through > Math.floor(Date.now() / 1000) && /CANCELLED$/.test(u.eventType) ? acct.paid_through : null });
    const after = await store.account(acct.id);
    if (!after!.paid_through || after!.paid_through <= Math.floor(Date.now() / 1000)) { await store.setTier(acct.id, "free"); return "downgraded_free"; }
    return "ending_at_period_end";
  }
  if (u.state === "active") {
    const tier = tierForPlan(u.provider, u.planId, env);
    if (!tier) return "unknown_plan";
    await store.setBilling(acct.id, { provider: u.provider, customer: u.customerId ?? undefined, subscription: u.subscriptionId ?? undefined, status: "active", paidThrough: u.paidThrough ?? null });
    await store.setTier(acct.id, tier);
    return `tier_${tier}`;
  }
  // A pending event from another subscription must not overwrite a prepaid plan (that would drop its expiry).
  if (acct.billing_status === "prepaid" && !sameSub) return "ignored_prepaid";
  await store.setBilling(acct.id, { provider: u.provider, customer: u.customerId ?? undefined, subscription: u.subscriptionId ?? undefined, status: u.status.toLowerCase() || "pending" });
  return "status_recorded";
}
