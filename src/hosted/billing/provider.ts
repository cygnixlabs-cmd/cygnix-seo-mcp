// Provider-agnostic billing. Each provider turns checkout requests into a hosted payment page and turns its
// signed webhooks into normalized BillingUpdates; applyBillingUpdate() maps those onto account tiers.
import type { Account } from "../store.js";
import type { ProviderId, TierId } from "../tiers.js";
import type { HostedEnv } from "../env.js";

export interface CheckoutUrls { successUrl: string; cancelUrl: string }
export interface CheckoutResult { provider: ProviderId; url: string; reference?: string }
export interface BillingUpdate {
  provider: ProviderId; eventId: string; eventType: string;
  accountId?: string | null; customerId?: string | null; subscriptionId?: string | null; planId?: string | null;
  /** active = grant the plan's tier; ending = paid access ends (now or at paidThrough); pending = record status only */
  state: "active" | "ending" | "pending";
  status: string; paidThrough?: number | null;
}
export interface BillingProvider {
  id: ProviderId; label: string;
  /** Env vars still missing. Empty = configured. A provider with missing vars is never called. */
  missingEnv(): string[];
  createCheckout(account: Account, tier: TierId, urls: CheckoutUrls): Promise<CheckoutResult>;
  /** Where the customer manages or cancels. */
  manageUrl(account: Account, returnUrl: string): Promise<string | null>;
  /** Verify the webhook signature and normalize. null = signature/verification failed. [] = nothing to do. */
  parseWebhook(rawBody: string, headers: Headers): Promise<BillingUpdate[] | null>;
}
export type ProviderFactory = (env: HostedEnv, fetchImpl: typeof fetch) => BillingProvider;
export class BillingError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }
export const missing = (env: HostedEnv, names: string[]) => names.filter(n => !env[n]);
export const isoToSec = (v: unknown) => { if (typeof v === "number") return v > 1e11 ? Math.floor(v / 1000) : v; if (typeof v !== "string" || !v) return null; const t = Date.parse(v); return Number.isNaN(t) ? null : Math.floor(t / 1000); };
