import { createPayFastProvider } from "@/lib/billing";
import { fail, ok } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";
import { billingRuntimeConfig, ValidationError } from "@tenderlo/shared";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.text();
    const payload = Object.fromEntries(new URLSearchParams(body).entries());
    const provider = createPayFastProvider();
    const result = await provider.verifyWebhook(payload);
    const admin = createSupabaseAdminClient();
    const organizationId = payload.custom_str1;
    const plan = payload.custom_str2;
    if (!organizationId || !plan) throw new ValidationError("PayFast webhook is missing organization or plan metadata.");

    const { data: subscription } = await admin
      .from("subscriptions")
      .upsert(
        {
          organization_id: organizationId,
          plan,
          status: result.status === "paid" ? "active" : result.status === "failed" ? "past_due" : "cancelled",
          provider: "payfast",
          provider_subscription_id: result.providerSubscriptionId ?? result.providerPaymentId,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + billingRuntimeConfig.defaultSubscriptionPeriodDays * 86_400_000).toISOString()
        },
        { onConflict: "organization_id,provider_subscription_id" }
      )
      .select("*")
      .maybeSingle();

    await admin.from("payments").upsert(
      {
        organization_id: organizationId,
        subscription_id: subscription?.id ?? null,
        provider: "payfast",
        provider_payment_id: result.providerPaymentId,
        amount: result.amount,
        currency: result.currency,
        status: result.status,
        raw_payload: result.rawPayload
      },
      { onConflict: "provider,provider_payment_id" }
    );
    await writeAuditLog(admin, {
      organizationId,
      action: "billing.webhook_processed",
      entityType: "payment",
      newValue: result
    });
    return ok({ received: true });
  } catch (error) {
    return fail(error);
  }
}
