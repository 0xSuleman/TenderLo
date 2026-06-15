import { subcontractingOpportunitySchema } from "@tenderlo/shared";
import { created, fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const { data, error } = await admin
      .from("subcontracting_opportunities")
      .select("*, tenders(title, closing_date)")
      .or(`organization_id.eq.${organizationId},status.eq.open`)
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
    const input = await parseBody(request, subcontractingOpportunitySchema);
    const { data, error } = await admin.from("subcontracting_opportunities").insert({ organization_id: organizationId, created_by: user.id, ...input }).select("*").single();
    if (error) throw error;
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
