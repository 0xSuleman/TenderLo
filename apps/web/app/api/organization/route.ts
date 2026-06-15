import { organizationInputSchema } from "@tenderlo/shared";
import { fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const { data, error } = await admin.from("organizations").select("*").eq("id", organizationId).single();
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "ops_admin"]);
    const input = await parseBody(request, organizationInputSchema.partial());
    const { data: before } = await admin.from("organizations").select("*").eq("id", organizationId).single();
    const { data, error } = await admin.from("organizations").update(input).eq("id", organizationId).select("*").single();
    if (error) throw error;
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "organization.updated",
      entityType: "organization",
      entityId: organizationId,
      oldValue: before,
      newValue: data
    });
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
