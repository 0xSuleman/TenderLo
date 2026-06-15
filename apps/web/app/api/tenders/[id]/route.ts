import { fail, ok } from "@/lib/api";
import { createSupabaseAdminClient, requireOrgContext } from "@/lib/supabase";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = createSupabaseAdminClient();
    let isOps = false;
    let hasPremium = false;
    try {
      const orgContext = await requireOrgContext(request);
      isOps = orgContext.isOps;
      const { data: subscription } = await admin
        .from("subscriptions")
        .select("id")
        .eq("organization_id", orgContext.organizationId)
        .in("status", ["trialing", "active", "manual_invoice"])
        .limit(1);
      hasPremium = Boolean(subscription?.length);
    } catch {
      hasPremium = false;
    }
    const { data: tender, error } = await admin
      .from("tenders")
      .select("*, tender_sources(name, source_type), tender_sector_matches(*), tender_source_links(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!tender) throw new Error("Tender not found.");
    if (!isOps && !["published", "closed", "corrigendum"].includes(tender.status)) throw new Error("Tender not available.");

    if (!hasPremium && !isOps) {
      return ok({
        id: tender.id,
        title: tender.title,
        department: tender.department,
        province: tender.province,
        city: tender.city,
        sector: tender.sector,
        closing_date: tender.closing_date,
        status: tender.status,
        tender_sources: tender.tender_sources,
        preview_notice: "Full tender details require an active TenderLo plan."
      });
    }

    const [{ data: fields }, { data: docs }] = await Promise.all([
      admin.from("extracted_fields").select("*").eq("tender_id", id).neq("verification_status", "rejected").order("confidence_score", { ascending: false }),
      admin.from("tender_documents").select("id, source_url, original_filename, mime_type, page_count, parser_status, ocr_status").eq("tender_id", id)
    ]);
    return ok({ ...tender, extracted_fields: fields, documents: docs });
  } catch (error) {
    return fail(error);
  }
}
