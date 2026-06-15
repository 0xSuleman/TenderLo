import { savedSearchSchema } from "@tenderlo/shared";
import { created, fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgContext(request);
    const { data, error } = await admin
      .from("saved_searches")
      .select("*, notification_rules(*)")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const input = await parseBody(request, savedSearchSchema);
    const { data, error } = await admin
      .from("saved_searches")
      .insert({ organization_id: organizationId, user_id: user.id, ...input })
      .select("*")
      .single();
    if (error) throw error;
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
