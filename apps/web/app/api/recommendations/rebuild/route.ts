import { rebuildRecommendationRecords } from "@tenderlo/scoring";
import { created, fail } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    await rebuildRecommendationRecords(organizationId);
    return created({ organization_id: organizationId, status: "rebuilt" });
  } catch (error) {
    return fail(error);
  }
}
