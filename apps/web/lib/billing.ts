import { createHash, randomUUID } from "node:crypto";
import {
  type BillingCheckoutRequest,
  type BillingCheckoutResponse,
  type BillingProvider,
  type BillingWebhookResult,
  billingRuntimeConfig,
  requiredEnv,
  ValidationError
} from "@tenderlo/shared";

export class PayFastBillingProvider implements BillingProvider {
  async createCheckout(input: BillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    const providerPaymentId = randomUUID();
    const amount = billingRuntimeConfig.planPricesPkr[input.plan].toFixed(2);
    const payload: Record<string, string> = {
      merchant_id: requiredEnv("PAYFAST_MERCHANT_ID"),
      merchant_key: requiredEnv("PAYFAST_MERCHANT_KEY"),
      return_url: process.env.PAYFAST_RETURN_URL ?? `${requiredEnv("NEXT_PUBLIC_APP_URL")}/billing`,
      cancel_url: process.env.PAYFAST_CANCEL_URL ?? `${requiredEnv("NEXT_PUBLIC_APP_URL")}/billing`,
      notify_url: process.env.PAYFAST_NOTIFY_URL ?? `${requiredEnv("NEXT_PUBLIC_APP_URL")}/api/billing/payfast/webhook`,
      m_payment_id: providerPaymentId,
      amount,
      item_name: `TenderLo ${input.plan} subscription`,
      item_description: `TenderLo ${input.plan} plan for ${input.organizationId}`,
      email_address: input.userEmail,
      custom_str1: input.organizationId,
      custom_str2: input.plan,
      subscription_type: "1",
      billing_date: new Date().toISOString().slice(0, 10),
      recurring_amount: amount,
      frequency: "3",
      cycles: "0"
    };
    payload.signature = createPayFastSignature(payload);
    const host = process.env.PAYFAST_SANDBOX === "true" ? "https://sandbox.payfast.co.za/eng/process" : "https://www.payfast.co.za/eng/process";
    return {
      checkoutUrl: `${host}?${new URLSearchParams(payload).toString()}`,
      providerPaymentId
    };
  }

  async verifyWebhook(payload: Record<string, string>): Promise<BillingWebhookResult> {
    const providedSignature = payload.signature;
    if (!providedSignature) throw new ValidationError("PayFast webhook signature is missing.");
    // HIGH-01: PayFast ITN signature is computed over the POST body parameter order, not alphabetical order.
    // We must reproduce the exact parameter order from the original POST body.
    // Since we receive the payload as an already-parsed object (order preserved by URLSearchParams in the route),
    // we recreate the signature using the original insertion order of keys.
    const expectedSignature = createPayFastSignatureOrdered(payload);
    if (providedSignature !== expectedSignature) throw new ValidationError("PayFast webhook signature verification failed.");

    const paymentStatus = (payload.payment_status ?? payload.status ?? "").toLowerCase();
    const status = paymentStatus.includes("complete") || paymentStatus.includes("paid") ? "paid" : paymentStatus.includes("cancel") ? "cancelled" : paymentStatus.includes("fail") ? "failed" : "pending";

    const result: BillingWebhookResult = {
      providerPaymentId: payload.m_payment_id ?? payload.pf_payment_id ?? "",
      status,
      amount: Number(payload.amount_gross ?? payload.amount ?? 0),
      currency: "PKR",
      rawPayload: payload
    };
    if (payload.token) result.providerSubscriptionId = payload.token;
    return result;
  }
}

export function createPayFastProvider(): BillingProvider {
  return new PayFastBillingProvider();
}

function createPayFastSignature(payload: Record<string, string>): string {
  const entries = Object.entries(payload)
    .filter(([key, value]) => key !== "signature" && value !== "")
    // MED-03: use deterministic ASCII comparison instead of locale-sensitive localeCompare
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const query = new URLSearchParams(entries).toString();
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const signed = passphrase ? `${query}&passphrase=${encodeURIComponent(passphrase)}` : query;
  return createHash("md5").update(signed).digest("hex");
}

/**
 * HIGH-01: For ITN verification, PayFast signs parameters in the original POST body order.
 * This function preserves key insertion order (as parsed by URLSearchParams in the route handler).
 */
function createPayFastSignatureOrdered(payload: Record<string, string>): string {
  const entries = Object.entries(payload).filter(([key, value]) => key !== "signature" && value !== "");
  const query = new URLSearchParams(entries).toString();
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const signed = passphrase ? `${query}&passphrase=${encodeURIComponent(passphrase)}` : query;
  return createHash("md5").update(signed).digest("hex");
}
