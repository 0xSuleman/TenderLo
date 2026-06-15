import { runComplianceForOrganizationTender } from "@tenderlo/scoring";
import { created, fail } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const complianceCheckId = await runComplianceForOrganizationTender(organizationId, id, user.id);
    return created({ compliance_check_id: complianceCheckId });
  } catch (error) {
    return fail(error);
  }
}
