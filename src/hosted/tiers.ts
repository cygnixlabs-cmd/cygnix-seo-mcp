// Tier catalogue. Quotas count `tools/call` requests per calendar month (UTC), pooled across an account's keys.
// initialize / tools/list / ping are free but still rate limited.
export type TierId = "free" | "pro" | "growth" | "agency";
export type ProviderId = "paypal" | "whop" | "stripe";
export interface Tier {
  id: TierId; name: string; priceUsdMonthly: number;
  monthlyCalls: number; perMinute: number; maxKeys: number; whiteLabelReports: boolean;
  /** env var holding the provider's plan / price id for this tier */
  planEnv?: Record<ProviderId, string>;
  blurb: string;
}
const plan = (t: string) => ({ paypal: `PAYPAL_PLAN_${t}`, whop: `WHOP_PLAN_${t}`, stripe: `STRIPE_PRICE_${t}` });
export const TIERS: Record<TierId, Tier> = {
  free:   { id: "free",   name: "Free",   priceUsdMonthly: 0,  monthlyCalls: 300,     perMinute: 10,  maxKeys: 1,  whiteLabelReports: false, blurb: "Every tool, including Search Console and AI-search checks. 300 calls a month." },
  pro:    { id: "pro",    name: "Pro",    priceUsdMonthly: 15, monthlyCalls: 5_000,   perMinute: 60,  maxKeys: 3,  whiteLabelReports: false, planEnv: plan("PRO"),    blurb: "Solo SEOs and site owners." },
  growth: { id: "growth", name: "Growth", priceUsdMonthly: 39, monthlyCalls: 25_000,  perMinute: 120, maxKeys: 10, whiteLabelReports: false, planEnv: plan("GROWTH"), blurb: "In-house teams and power users." },
  agency: { id: "agency", name: "Agency", priceUsdMonthly: 99, monthlyCalls: 100_000, perMinute: 300, maxKeys: 50, whiteLabelReports: true,  planEnv: plan("AGENCY"), blurb: "Agencies: one key per client, pooled quota, white-label PDF reports." },
};
export const TIER_ORDER: TierId[] = ["free", "pro", "growth", "agency"];
export const PAID_TIERS: TierId[] = ["pro", "growth", "agency"];
export const isTier = (t: unknown): t is TierId => typeof t === "string" && t in TIERS;
export function nextTier(t: TierId): Tier | null { const i = TIER_ORDER.indexOf(t); return i >= 0 && i < TIER_ORDER.length - 1 ? TIERS[TIER_ORDER[i + 1]] : null; }
export const planIdFor = (provider: ProviderId, tier: TierId, env: Record<string, unknown>) => {
  const e = TIERS[tier].planEnv?.[provider]; const v = e ? env[e] : undefined; return typeof v === "string" && v ? v : null;
};
/** Map a provider plan / price id to a tier using the configured env vars. */
export function tierForPlan(provider: ProviderId, planId: string | undefined | null, env: Record<string, unknown>): TierId | null {
  if (!planId) return null;
  for (const t of PAID_TIERS) if (planIdFor(provider, t, env) === planId) return t;
  return null;
}
