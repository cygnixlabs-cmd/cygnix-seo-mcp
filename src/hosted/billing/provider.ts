// Gateway-agnostic billing. Every gateway implements BillingProvider and is registered in billing/index.ts.
// Three kinds:
//   subscription  hosted recurring checkout + signed webhooks (PayPal Subscriptions, Whop, Stripe)
//   invoice       one-time hosted invoice + signed webhook/IPN (crypto via NOWPayments)
//   manual        no API: we show payment instructions/link for an order; an admin activates it (Payoneer, PayPal.me, wallet transfer)
// invoice/manual payments buy a prepaid period (PREPAID_PERIOD_DAYS, default 30) on the chosen tier.
// A provider stays inert (never shown, never called) until missingEnv() is empty.
import type { Account, Order } from "../store.js";
import type { ProviderId, TierId } from "../tiers.js";
import type { HostedEnv } from "../env.js";

export type ProviderKind = "subscription" | "invoice" | "manual";
export interface CheckoutUrls { successUrl: string; cancelUrl: string; /** order page for invoice/manual providers */ orderUrl?: string; /** webhook URL for this provider */ webhookUrl: string }
export interface CheckoutResult { provider: ProviderId; url: string; reference?: string; /** gateway-side id to store on the order */ externalId?: string }
export interface BillingUpdate {
  provider: ProviderId; eventId: string; eventType: string;
  accountId?: string | null; customerId?: string | null; subscriptionId?: string | null; planId?: string | null;
  /** invoice providers: our order id (ord_...) */
  orderId?: string | null; amountUsd?: number | null;
  /** active = grant the plan's tier; paid = one-time order paid (prepaid period); ending = paid access ends (now or at paidThrough); pending = record status only */
  state: "active" | "paid" | "ending" | "pending";
  status: string; paidThrough?: number | null;
}
/** What the order page shows for a manual provider. */
export interface PaymentInstructions { title: string; steps: string[]; link?: { href: string; label: string } | null; fields?: { label: string; value: string }[]; referenceHint: string }
export interface BillingProvider {
  id: ProviderId; label: string; kind: ProviderKind;
  /** Env vars still missing. Empty = configured. A provider with missing vars is never shown or called. */
  missingEnv(): string[];
  /** subscription providers ignore `order`; invoice/manual providers get the pending order created for this checkout. */
  createCheckout(account: Account, tier: TierId, urls: CheckoutUrls, order?: Order): Promise<CheckoutResult>;
  /** Where the customer manages or cancels. null = no portal (prepaid: just don't renew). */
  manageUrl(account: Account, returnUrl: string): Promise<string | null>;
  /** Verify the webhook signature and normalize. null = signature/verification failed. [] = nothing to do. Absent = no webhooks (manual). */
  parseWebhook?(rawBody: string, headers: Headers): Promise<BillingUpdate[] | null>;
  /** manual providers: instructions for the order page. */
  instructions?(order: Order, account: Account): PaymentInstructions;
}
export type ProviderFactory = (env: HostedEnv, fetchImpl: typeof fetch) => BillingProvider;
export class BillingError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }
export const missing = (env: HostedEnv, names: string[]) => names.filter(n => !env[n]);
export const isoToSec = (v: unknown) => { if (typeof v === "number") return v > 1e11 ? Math.floor(v / 1000) : v; if (typeof v !== "string" || !v) return null; const t = Date.parse(v); return Number.isNaN(t) ? null : Math.floor(t / 1000); };
