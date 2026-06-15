import { created, fail } from "@/lib/api";
import { requireOrgContext } from "@/lib/supabase";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, organizationId, user } = await requireOrgContext(request, ["owner", "admin", "member", "viewer", "ops_admin"]);
    const { data, error } = await admin
      .from("saved_tenders")
      .upsert({ organization_id: organizationId, user_id: user.id, tender_id: id }, { onConflict: "organization_id,user_id,tender_id" })
      .select("*")
      .single();
    if (error) throw error;
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
