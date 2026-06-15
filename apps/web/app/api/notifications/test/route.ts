import { sendNotification } from "@tenderlo/notifications";
import { created, fail } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "ops_admin"]);
    const { data: org } = await admin.from("organizations").select("primary_contact_email").eq("id", organizationId).single();
    const result = await sendNotification({
      organizationId,
      userId: user.id,
      channel: "email",
      type: "test",
      title: "TenderLo test alert",
      body: "Email alerts are configured for this contractor workspace.",
      to: org?.primary_contact_email ?? user.email ?? undefined
    });
    await admin.from("notifications").insert({
      organization_id: organizationId,
      user_id: user.id,
      type: "test",
      title: "TenderLo test alert",
      body: "Email alerts are configured for this contractor workspace.",
      channel: "email",
      status: result.status === "sent" ? "sent" : "failed",
      last_error: result.error ?? null,
      sent_at: result.status === "sent" ? new Date().toISOString() : null,
      delivery_attempts: 1
    });
    return created(result);
  } catch (error) {
    return fail(error);
  }
}
