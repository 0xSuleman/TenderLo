import { bidPackageSchema } from "@tenderlo/shared";
import { created, fail, ok, parseBody } from "@/lib/api";
import { requireOrgContext, requireOrgRoleFromRequest } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const { data, error } = await admin.from("bid_packages").select("*, tenders(title, closing_date), bid_package_documents(*)").eq("organization_id", organizationId).order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const input = await parseBody(request, bidPackageSchema);
    const { data: profileDocs } = await admin.from("profile_documents").select("*").eq("organization_id", organizationId);
    const checklist = {
      generated_at: new Date().toISOString(),
      required_documents: ["pec_license", "tax_certificate", "experience_certificate", "bank_letter", "audited_financials", "guarantee"],
      available_documents: (profileDocs ?? []).map((doc: any) => doc.document_type)
    };
    const { data, error } = await admin
      .from("bid_packages")
      .insert({ organization_id: organizationId, tender_id: input.tender_id, name: input.name, checklist, created_by: user.id })
      .select("*")
      .single();
    if (error) throw error;
    const docs = (profileDocs ?? []).map((doc: any) => ({
      bid_package_id: data.id,
      organization_id: organizationId,
      profile_document_id: doc.id,
      storage_path: doc.storage_path,
      original_filename: doc.original_filename,
      document_type: doc.document_type,
      included: true
    }));
    if (docs.length) await admin.from("bid_package_documents").insert(docs);
    return created({ ...data, documents_included: docs.length });
  } catch (error) {
    return fail(error);
  }
}
