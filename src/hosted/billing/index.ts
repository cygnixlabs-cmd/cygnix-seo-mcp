import type { HostedEnv } from "../env.js";
import type { Store } from "../store.js";
import { tierForPlan, type ProviderId } from "../tiers.js";
import type { BillingProvider, BillingUpdate } from "./provider.js";
import { createPayPal } from "./paypal.js";
import { createWhop } from "./whop.js";
import { createStripe } from "./stripe.js";
export * from "./provider.js";

export const PROVIDER_ORDER: ProviderId[] = ["paypal", "whop", "stripe"];
export function providers(env: HostedEnv, fetchImpl: typeof fetch): Record<ProviderId, BillingProvider> {
  return { paypal: createPayPal(env, fetchImpl), whop: createWhop(env, fetchImpl), stripe: createStripe(env, fetchImpl) };
}
export const configuredProviders = (all: Record<ProviderId, BillingProvider>) => PROVIDER_ORDER.filter(id => all[id].missingEnv().length === 0);
export function defaultProvider(env: HostedEnv, all: Record<ProviderId, BillingProvider>): ProviderId | null {
  const ok = configuredProviders(all);
  const pref = env.BILLING_PROVIDER as ProviderId | undefined;
  return pref && ok.includes(pref) ? pref : ok[0] ?? null;
}

/** Apply one verified, normalized billing event to the account it belongs to. Returns what happened (for logs/tests). */
export async function applyBillingUpdate(store: Store, env: HostedEnv, u: BillingUpdate): Promise<string> {
  let acct = u.accountId ? await store.account(u.accountId) : null;
  if (!acct && u.subscriptionId) acct = await store.accountBySubscription(u.provider, u.subscriptionId);
  if (!acct && u.customerId) acct = await store.accountByCustomer(u.provider, u.customerId);
  if (!acct) return "no_account";
  const sameSub = !acct.billing_subscription_id || acct.billing_provider !== u.provider || acct.billing_subscription_id === u.subscriptionId;
  if (u.state === "ending") {
    // Ignore an old subscription ending after the customer already moved to a new one.
    if (!sameSub && acct.billing_status === "active") return "ignored_stale";
    await store.setBilling(acct.id, { provider: u.provider, subscription: u.subscriptionId ?? acct.billing_subscription_id, status: "ending",
      paidThrough: acct.paid_through && acct.paid_through > Math.floor(Date.now() / 1000) && u.eventType.match(/CANCELLED|deleted|deactivated/i) ? acct.paid_through : null });
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
  await store.setBilling(acct.id, { provider: u.provider, customer: u.customerId ?? undefined, subscription: u.subscriptionId ?? undefined, status: u.status.toLowerCase() || "pending" });
  return "status_recorded";
}
