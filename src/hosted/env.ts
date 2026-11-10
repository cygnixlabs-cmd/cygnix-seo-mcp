import type { Db } from "./db.js";
/** Runtime configuration. Every provider block is optional and stays inert until its vars are set. */
export interface HostedEnv {
  PUBLIC_BASE_URL?: string;          // e.g. https://mcp.cygnixlabs.com (no trailing slash)
  ADMIN_TOKEN?: string;              // secret; enables /admin/* when set
  BILLING_PROVIDER?: string;         // default checkout provider: paypal | whop | stripe (else first configured)
  // PayPal Subscriptions (first provider)
  PAYPAL_ENV?: string;               // "sandbox" (default) | "live"
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_PLAN_PRO?: string; PAYPAL_PLAN_GROWTH?: string; PAYPAL_PLAN_AGENCY?: string;
  // Whop (second, non-Stripe provider)
  WHOP_API_KEY?: string; WHOP_WEBHOOK_SECRET?: string; WHOP_API_BASE?: string;
  WHOP_PLAN_PRO?: string; WHOP_PLAN_GROWTH?: string; WHOP_PLAN_AGENCY?: string;
  // Stripe (pluggable, for later)
  STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO?: string; STRIPE_PRICE_GROWTH?: string; STRIPE_PRICE_AGENCY?: string;
  // Google Search Console OAuth
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;     // base64 of 32 random bytes; encrypts Google refresh tokens + signs OAuth state
  SIGNUP_PER_IP_PER_HOUR?: string;   // default 5
  [k: string]: unknown;
}
export interface AppDeps { db: Db; env: HostedEnv; fetchImpl?: typeof fetch; /** fetch used by AEO/llms.txt tools for public URLs */ webFetch?: typeof fetch }
export const baseUrl = (env: HostedEnv) => (env.PUBLIC_BASE_URL || "https://mcp.cygnixlabs.com").replace(/\/+$/, "");
export const upgradeUrl = (env: HostedEnv) => `${baseUrl(env)}/#pricing`;
