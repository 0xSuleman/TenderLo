"use server";

import { revalidatePath } from "next/cache";
import { calculateProfileCompleteness, writeAuditLog } from "@tenderlo/db";
import { getPageContext } from "@/lib/page-context";

export async function saveCompanyProfileAction(formData: FormData): Promise<void> {
  const context = await getPageContext();
  if (!context) throw new Error("Authentication required.");
  const sectors = String(formData.get("sectors") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const regions = String(formData.get("operating_regions") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await context.admin.from("company_profiles").upsert(
    {
      organization_id: context.organizationId,
      business_type: formData.get("business_type"),
      ntn: formData.get("ntn"),
      strn: formData.get("strn"),
      website: formData.get("website"),
      sectors,
      operating_regions: regions
    },
    { onConflict: "organization_id" }
  );
  await calculateProfileCompleteness(context.admin, context.organizationId);
  await writeAuditLog(context.admin, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "company_profile.updated",
    entityType: "company_profile",
    newValue: { sectors, regions }
  });
  revalidatePath("/profile");
}

export async function addPecLicenseAction(formData: FormData): Promise<void> {
  const context = await getPageContext();
  if (!context) throw new Error("Authentication required.");
  const specializationCodes = String(formData.get("specialization_codes") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await context.admin.from("pec_licenses").insert({
    organization_id: context.organizationId,
    license_number: formData.get("license_number"),
    category: formData.get("category"),
    specialization_codes: specializationCodes,
    issue_date: formData.get("issue_date") || null,
    expiry_date: formData.get("expiry_date") || null,
    verification_status: "unverified"
  });
  await calculateProfileCompleteness(context.admin, context.organizationId);
  revalidatePath("/profile");
}
