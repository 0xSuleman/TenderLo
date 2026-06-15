import { z } from "zod";
import { calculateProfileCompleteness, writeAuditLog } from "@tenderlo/db";
import { companyProfileSchema, engineerSchema, equipmentSchema, pecLicenseSchema } from "@tenderlo/shared";
import { fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";

const profilePatchSchema = z.object({
  company_profile: companyProfileSchema.partial().optional(),
  pec_license: pecLicenseSchema.optional(),
  engineers: z.array(engineerSchema).optional(),
  equipment: z.array(equipmentSchema).optional()
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const [profile, pec, engineers, equipment, documents] = await Promise.all([
      admin.from("company_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
      admin.from("pec_licenses").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      admin.from("engineers").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      admin.from("equipment").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      admin.from("profile_documents").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false })
    ]);
    for (const result of [profile, pec, engineers, equipment, documents]) if (result.error) throw result.error;
    return ok({
      company_profile: profile.data,
      pec_licenses: pec.data,
      engineers: engineers.data,
      equipment: equipment.data,
      documents: documents.data
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const input = await parseBody(request, profilePatchSchema);
    const { data: before } = await admin.from("company_profiles").select("*").eq("organization_id", organizationId).maybeSingle();
    if (input.company_profile) {
      await admin.from("company_profiles").upsert({ organization_id: organizationId, ...input.company_profile }, { onConflict: "organization_id" });
    }
    if (input.pec_license) {
      await admin.from("pec_licenses").insert({ organization_id: organizationId, ...input.pec_license });
    }
    if (input.engineers?.length) {
      await admin.from("engineers").insert(input.engineers.map((engineer: Record<string, unknown>) => ({ organization_id: organizationId, ...engineer })));
    }
    if (input.equipment?.length) {
      await admin.from("equipment").insert(input.equipment.map((item: Record<string, unknown>) => ({ organization_id: organizationId, ...item })));
    }
    await calculateProfileCompleteness(admin, organizationId);
    const { data } = await admin.from("company_profiles").select("*").eq("organization_id", organizationId).single();
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "company_profile.updated",
      entityType: "company_profile",
      entityId: data.id,
      oldValue: before,
      newValue: input
    });
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
