import { randomBytes, createHash } from "node:crypto";
import { calculateProfileCompleteness, writeAuditLog } from "@tenderlo/db";
import { onboardingSchema } from "@tenderlo/shared";
import { created, fail, parseBody } from "@/lib/api";
import { createSupabaseAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const input = await parseBody(request, onboardingSchema);
    const admin = createSupabaseAdminClient();

    const { data: organization, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: input.name,
        legal_name: input.legal_name ?? input.name,
        primary_contact_name: input.primary_contact_name ?? input.full_name,
        primary_contact_email: input.primary_contact_email ?? user.email,
        phone: input.phone,
        city: input.city,
        province: input.province
      })
      .select("*")
      .single();
    if (orgError) throw orgError;

    await admin.from("profiles").upsert({ user_id: user.id, full_name: input.full_name, phone: input.phone }, { onConflict: "user_id" });
    await admin.from("memberships").insert({ organization_id: organization.id, user_id: user.id, role: "owner", status: "active" });
    await admin.from("company_profiles").insert({ organization_id: organization.id, operating_regions: input.province ? [input.province] : [], sectors: [] });
    await admin.from("subscriptions").insert({
      organization_id: organization.id,
      plan: "starter",
      status: "trialing",
      provider: "internal_trial",
      provider_subscription_id: createHash("sha256").update(randomBytes(32)).digest("hex")
    });
    await calculateProfileCompleteness(admin, organization.id);
    await writeAuditLog(admin, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "organization.onboarded",
      entityType: "organization",
      entityId: organization.id,
      newValue: organization
    });

    return created({ organization });
  } catch (error) {
    return fail(error);
  }
}
