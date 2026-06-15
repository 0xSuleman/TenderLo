import { writeAuditLog } from "@tenderlo/db";
import { billingCheckoutSchema } from "@tenderlo/shared";
import { createPayFastProvider } from "@/lib/billing";
import { created, fail, parseBody } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "ops_admin"]);
    const input = await parseBody(request, billingCheckoutSchema);
    const provider = createPayFastProvider();
    const checkout = await provider.createCheckout({ organizationId, plan: input.plan, userEmail: user.email ?? "billing@tenderlo.local" });
    await admin.from("payments").insert({
      organization_id: organizationId,
      provider: "payfast",
      provider_payment_id: checkout.providerPaymentId,
      amount: 0,
      currency: "PKR",
      status: "checkout_created",
      raw_payload: { plan: input.plan }
    });
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "billing.checkout_created",
      entityType: "payment",
      newValue: { provider_payment_id: checkout.providerPaymentId, plan: input.plan }
    });
    return created(checkout);
  } catch (error) {
    return fail(error);
  }
}
