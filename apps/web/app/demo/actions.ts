"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@tenderlo/db";

function textField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function demoRequestAction(formData: FormData): Promise<void> {
  const company = textField(formData, "company");
  const email = textField(formData, "email");
  const focus = textField(formData, "focus");

  if (!company || !email) {
    redirect("/demo?error=Please+provide+your+company+name+and+email.");
  }

  // Persist the demo request so it's never silently lost (HIGH-03)
  const admin = createServiceClient();
  await admin.from("audit_logs").insert({
    organization_id: null,
    actor_user_id: null,
    action: "demo.request_submitted",
    entity_type: "demo_request",
    entity_id: email,
    new_value: { company, email, focus, submitted_at: new Date().toISOString() }
  });

  redirect("/demo?message=Thank+you%21+Our+team+will+be+in+touch+within+1+business+day.");
}
