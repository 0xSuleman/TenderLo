"use server";

import { redirect } from "next/navigation";
import { createPayFastProvider } from "@/lib/billing";
import { getPageContext } from "@/lib/page-context";

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const context = await getPageContext();
  if (!context) throw new Error("Authentication required.");
  const plan = String(formData.get("plan") ?? "growth") as "starter" | "growth" | "pro";
  const provider = createPayFastProvider();
  const checkout = await provider.createCheckout({
    organizationId: context.organizationId,
    plan,
    userEmail: "billing@tenderlo.local"
  });
  await context.admin.from("payments").insert({
    organization_id: context.organizationId,
    provider: "payfast",
    provider_payment_id: checkout.providerPaymentId,
    amount: 0,
    currency: "PKR",
    status: "checkout_created",
    raw_payload: { plan }
  });
  redirect(checkout.checkoutUrl as never);
}
