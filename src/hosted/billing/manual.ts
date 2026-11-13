// Manual gateways: no API and no webhook. Checkout creates a pending order (ord_...) and sends the buyer to
// /pay/<order id>, which shows how to pay and lets them submit a payment reference. An admin checks the
// payment in the gateway's own dashboard and activates the order (POST /admin/orders/<id>/activate or
// `cygnix-admin activate-order <id>`). Activation grants the tier for the order's prepaid period.
import { missing, type BillingProvider, type PaymentInstructions, type ProviderFactory } from "./provider.js";
import type { Order } from "../store.js";
import { TIERS } from "../tiers.js";

const usd = (n: number) => `$${n.toFixed(2)} USD`;
const plan = (o: Order) => `${TIERS[o.tier].name} plan, ${o.period_days} days`;
const after = "After paying, paste your payment/transaction reference below. Your plan is switched on once the payment is confirmed (we check manually).";

function manual(id: string, label: string, isConfigured: () => string[], instructions: (o: Order, email: string) => PaymentInstructions): BillingProvider {
  return {
    id, label, kind: "manual", missingEnv: isConfigured,
    async createCheckout(_a, _t, urls, order) { return { provider: id, url: urls.orderUrl!, reference: order!.id }; },
    async manageUrl() { return null; },
    instructions: (o, a) => instructions(o, a.email),
  };
}

/** Payoneer. Payoneer offers Payment Links (shareable URL) and Payment Requests (emailed to the payer) in its dashboard.
 *  Neither is called by API here (Payoneer's merchant Checkout API needs a separate business approval; not implemented).
 *  Enable with PAYONEER_ENABLED=true. Optional PAYONEER_LINK (any amount) or PAYONEER_LINK_PRO/GROWTH/AGENCY (fixed-amount links). */
export const createPayoneer: ProviderFactory = env => manual("payoneer", "Payoneer (card or bank transfer)",
  () => (env.PAYONEER_ENABLED === "true" || env.PAYONEER_LINK || env.PAYONEER_LINK_PRO || env.PAYONEER_LINK_GROWTH || env.PAYONEER_LINK_AGENCY) ? [] : ["PAYONEER_ENABLED"],
  (o, email) => {
    const link = (env[`PAYONEER_LINK_${o.tier.toUpperCase()}`] as string | undefined) || (env.PAYONEER_LINK as string | undefined);
    const extra = env.PAYONEER_INSTRUCTIONS ? [String(env.PAYONEER_INSTRUCTIONS)] : [];
    return link
      ? { title: "Pay with Payoneer", link: { href: link, label: "Open the Payoneer payment page" }, referenceHint: "Payoneer payment ID or the email you paid from",
          steps: [`Amount: ${usd(o.amount_usd)} (${plan(o)}).`, `Open the Payoneer payment page and pay ${usd(o.amount_usd)}. Put your order reference ${o.id} in the description/note if the form has one.`, ...extra, after] }
      : { title: "Pay with Payoneer", link: null, referenceHint: "Payoneer payment request ID (optional)",
          steps: [`Amount: ${usd(o.amount_usd)} (${plan(o)}).`, `Cygnix Labs will send a Payoneer payment request for ${usd(o.amount_usd)} to ${email}, quoting reference ${o.id}.`, "Open the email from Payoneer and pay by card, bank transfer or Payoneer balance.", ...extra, after] };
  });

/** PayPal.me link (works with a personal PayPal account). The amount is appended as /<amount>USD (PayPal.me URL convention; check it on your own link). */
export const createPayPalLink: ProviderFactory = env => manual("paypal_link", "PayPal (one-time)",
  () => missing(env, ["PAYPAL_ME_URL"]),
  o => {
    const href = `${String(env.PAYPAL_ME_URL).replace(/\/+$/, "")}/${o.amount_usd.toFixed(2)}USD`;
    return { title: "Pay with PayPal", link: { href, label: `Pay ${usd(o.amount_usd)} on PayPal` }, referenceHint: "PayPal transaction ID",
      steps: [`Amount: ${usd(o.amount_usd)} (${plan(o)}).`, `Pay ${usd(o.amount_usd)} on PayPal and write ${o.id} in the note.`, after] };
  });

/** Direct wallet transfer. CRYPTO_WALLETS = "USDT (TRC-20)=T...; USDC (Base)=0x..." */
export function parseWallets(v: unknown): { label: string; address: string }[] {
  if (typeof v !== "string") return [];
  return v.split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf("="); return i > 0 ? { label: s.slice(0, i).trim(), address: s.slice(i + 1).trim() } : null; })
    .filter((x): x is { label: string; address: string } => !!x && !!x.label && !!x.address);
}
export const createCryptoWallet: ProviderFactory = env => manual("crypto_wallet", "Crypto transfer (stablecoins)",
  () => parseWallets(env.CRYPTO_WALLETS).length ? [] : ["CRYPTO_WALLETS"],
  o => ({ title: "Pay by crypto transfer", link: null, referenceHint: "Transaction hash",
    fields: parseWallets(env.CRYPTO_WALLETS).map(w => ({ label: w.label, value: w.address })),
    steps: [`Amount: ${usd(o.amount_usd)} (${plan(o)}). Stablecoins count at face value; for other coins send the equivalent at the time of payment.`,
      "Send to one of the addresses below. Use exactly the network shown: funds sent on another network can be lost.", "Network fees are paid by the sender.", after] }));
