import type { Db } from "./db.js";
/** Runtime configuration. Every provider block is optional and stays inert until its vars are set. */
export interface HostedEnv {
  PUBLIC_BASE_URL?: string;          // e.g. https://mcp.cygnixlabs.com (no trailing slash)
  ADMIN_TOKEN?: string;              // secret; enables /admin/* when set
  BILLING_PROVIDER?: string;         // default checkout provider id (else first configured in BILLING_PROVIDER_ORDER)
  BILLING_PROVIDER_ORDER?: string;   // optional comma list: order providers are shown on the checkout page
  PREPAID_PERIOD_DAYS?: string;      // days one one-time/manual payment buys (default 30)
  HIDE_PRICES_FOR_CLIENTS?: string;  // comma list of client substrings that never see prices/upgrade CTAs (default "chatgpt,openai"; "" = off)
  OPENAI_APPS_CHALLENGE?: string;    // token served at /.well-known/openai-apps-challenge for OpenAI domain verification
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
  // Payoneer (manual: Payment Link / Payment Request, admin activates)
  PAYONEER_ENABLED?: string; PAYONEER_LINK?: string; PAYONEER_LINK_PRO?: string; PAYONEER_LINK_GROWTH?: string; PAYONEER_LINK_AGENCY?: string; PAYONEER_INSTRUCTIONS?: string;
  // PayPal.me link (manual; works with a personal PayPal account until PayPal Business + Subscriptions are set up)
  PAYPAL_ME_URL?: string;
  // Crypto hosted invoice (automatic via webhook). CRYPTO_GATEWAY = nowpayments (only adapter implemented)
  CRYPTO_GATEWAY?: string; NOWPAYMENTS_API_KEY?: string; NOWPAYMENTS_IPN_SECRET?: string; NOWPAYMENTS_API_BASE?: string;
  // Crypto wallet transfer (manual): "USDT (TRC-20)=Txxx; USDC (Base)=0x..." (label=address pairs separated by ; or newlines)
  CRYPTO_WALLETS?: string;
  // Google Search Console OAuth
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;     // base64 of 32 random bytes; encrypts Google refresh tokens + signs OAuth state
  SIGNUP_PER_IP_PER_HOUR?: string;   // default 5
  [k: string]: unknown;
}
export interface AppDeps { db: Db; env: HostedEnv; fetchImpl?: typeof fetch; /** fetch used by AEO/llms.txt tools for public URLs */ webFetch?: typeof fetch }
export const baseUrl = (env: HostedEnv) => (env.PUBLIC_BASE_URL || "https://mcp.cygnixlabs.com").replace(/\/+$/, "");
export const upgradeUrl = (env: HostedEnv) => `${baseUrl(env)}/#pricing`;
/** Informational account page (plan + usage, no checkout). The only link shown to price-hidden clients such as ChatGPT. */
export const accountUrl = (env: HostedEnv) => `${baseUrl(env)}/account.html`;
export const checkoutUrl = (env: HostedEnv) => `${baseUrl(env)}/checkout.html`;
export const prepaidDays = (env: HostedEnv) => { const n = Number(env.PREPAID_PERIOD_DAYS ?? 30); return Number.isFinite(n) && n >= 1 && n <= 400 ? Math.floor(n) : 30; };
