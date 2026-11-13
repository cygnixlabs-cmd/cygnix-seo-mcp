// Crypto hosted invoices (kind "invoice"): one-time payment, confirmed automatically by a signed webhook (IPN).
// Adapter chosen by CRYPTO_GATEWAY. Implemented: "nowpayments" (default), from NOWPayments' public API docs
// (documenter.getpostman.com/view/7907941/2s93JusNJt, read 11 Nov 2026):
//   POST {base}/invoice  header x-api-key; body price_amount, price_currency, order_id, order_description,
//        ipn_callback_url, success_url, cancel_url -> { id, invoice_url }
//   IPN: POST to ipn_callback_url with header x-nowpayments-sig = hex HMAC-SHA512(IPN secret,
//        JSON.stringify(body with keys sorted recursively)). payment_status "finished" = paid.
//   Repeated deposits carry parent_payment_id; NOWPayments recommends not auto-provisioning them, so we only record them.
// Coinbase Commerce is NOT implemented: its Charge API was retired 31 Mar 2026 and the replacement
// (Coinbase Business Checkouts API) is limited to US/Singapore businesses.
import { BillingError, missing, type BillingProvider, type BillingUpdate, type ProviderFactory } from "./provider.js";
import { hmacSha512Hex, timingSafeEqual } from "../crypto.js";
import { TIERS } from "../tiers.js";

/** Exactly the key-sorting function from NOWPayments' docs (arrays are walked like objects). */
export function npSort(obj: any): any {
  return Object.keys(obj).sort().reduce((r: any, k) => { r[k] = (obj[k] && typeof obj[k] === "object") ? npSort(obj[k]) : obj[k]; return r; }, {});
}
export async function nowpaymentsSignature(secret: string, body: unknown) { return hmacSha512Hex(secret, JSON.stringify(npSort(body))); }

export const createCrypto: ProviderFactory = (env, fetchImpl) => {
  const gateway = String(env.CRYPTO_GATEWAY || "nowpayments").toLowerCase();
  const base = String(env.NOWPAYMENTS_API_BASE || "https://api.nowpayments.io/v1").replace(/\/+$/, "");
  const p: BillingProvider = {
    id: "crypto", label: "Crypto (USDT, USDC, BTC and more)", kind: "invoice",
    missingEnv: () => gateway !== "nowpayments" ? ["CRYPTO_GATEWAY=nowpayments (the only crypto adapter implemented)"] : missing(env, ["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"]),
    async createCheckout(_account, tier, urls, order) {
      if (!order) throw new BillingError(500, "no_order", "Crypto checkout needs an order.");
      const r = await fetchImpl(`${base}/invoice`, { method: "POST", headers: { "x-api-key": String(env.NOWPAYMENTS_API_KEY), "Content-Type": "application/json" },
        body: JSON.stringify({ price_amount: order.amount_usd, price_currency: "usd", order_id: order.id, order_description: `Cygnix SEO MCP ${TIERS[tier].name} (${order.period_days} days)`,
          ipn_callback_url: urls.webhookUrl, success_url: urls.successUrl, cancel_url: urls.cancelUrl }) });
      const text = await r.text();
      if (!r.ok) throw new BillingError(502, "crypto_api", `Crypto invoice failed (${r.status}): ${text.slice(0, 300)}`);
      const j = JSON.parse(text) as { id?: string | number; invoice_url?: string };
      if (!j.invoice_url) throw new BillingError(502, "crypto_api", "Crypto gateway returned no invoice_url.");
      return { provider: "crypto", url: j.invoice_url, reference: order.id, externalId: j.id != null ? String(j.id) : undefined };
    },
    async manageUrl() { return null; },
    async parseWebhook(rawBody, h) {
      let e: any; try { e = JSON.parse(rawBody); } catch { return null; }
      const sig = h.get("x-nowpayments-sig"); if (!sig || !e || typeof e !== "object") return null;
      if (!timingSafeEqual(sig.toLowerCase(), await nowpaymentsSignature(String(env.NOWPAYMENTS_IPN_SECRET), e))) return null;
      const status = String(e.payment_status || ""); if (!e.order_id || !status) return [];
      const repeat = e.parent_payment_id != null && e.parent_payment_id !== "";
      const usdOk = String(e.price_currency || "").toLowerCase() === "usd";
      const state: BillingUpdate["state"] = status === "finished" && !repeat && usdOk ? "paid" : "pending";
      return [{ provider: "crypto", eventId: `${e.payment_id ?? e.invoice_id ?? "x"}:${status}`, eventType: `payment.${status}${repeat ? ".repeat" : ""}`,
        orderId: String(e.order_id), amountUsd: usdOk ? Number(e.price_amount) : null, subscriptionId: e.payment_id != null ? String(e.payment_id) : null, state, status }];
    },
  };
  return p;
};
