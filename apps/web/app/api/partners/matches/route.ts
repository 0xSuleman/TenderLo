import { buildCompanyProfileSnapshot } from "@tenderlo/db";
import { scorePartnerFit } from "@tenderlo/scoring";
import { partnerPreferenceSchema, safeJson } from "@tenderlo/shared";
import { created, fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const { data, error } = await admin.from("partner_matches").select("*, organizations!partner_matches_matched_organization_id_fkey(name, city, province)").eq("organization_id", organizationId).order("score", { ascending: false });
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const input = await parseBody(request, partnerPreferenceSchema);
    await admin.from("partner_preferences").upsert({ organization_id: organizationId, ...input }, { onConflict: "organization_id" });
    const ownProfile = await buildCompanyProfileSnapshot(admin, organizationId);
    const { data: orgs } = await admin.from("organizations").select("id").neq("id", organizationId).limit(100);
    const rows = [];
    for (const org of (orgs ?? []) as Array<{ id: string }>) {
      const candidateProfile = await buildCompanyProfileSnapshot(admin, org.id);
      const scored = scorePartnerFit(ownProfile, candidateProfile);
      if (scored.score < 30) continue;
      rows.push({ organization_id: organizationId, matched_organization_id: org.id, score: scored.score, reasons: scored.reasons });
    }
    if (rows.length) await admin.from("partner_matches").upsert(rows, { onConflict: "organization_id,matched_organization_id" });
    return created({ matches_created: rows.length, preferences: safeJson(input) });
  } catch (error) {
    return fail(error);
  }
}
