import { savedSearchSchema } from "@tenderlo/shared";
import { fail, noContent, ok, parseBody } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const input = await parseBody(request, savedSearchSchema.partial());
    const { data, error } = await admin
      .from("saved_searches")
      .update(input)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const { error } = await admin.from("saved_searches").delete().eq("id", id).eq("organization_id", organizationId).eq("user_id", user.id);
    if (error) throw error;
    return noContent();
  } catch (error) {
    return fail(error);
  }
}
