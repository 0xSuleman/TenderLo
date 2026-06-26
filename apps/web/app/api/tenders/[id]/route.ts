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
        category: tender.procurement_category,
        procurement_category: tender.procurement_category,
        sector: tender.sector,
        closing_date: tender.closing_date,
        active_status: formatActiveStatus(tender.status, tender.closing_date),
        status: tender.status,
        tender_sources: tender.tender_sources,
        preview_notice: "Full tender details require an active TenderLo plan."
      });
    }

    const [{ data: fields }, { data: docs }] = await Promise.all([
      admin.from("extracted_fields").select("*").eq("tender_id", id).neq("verification_status", "rejected").order("confidence_score", { ascending: false }),
      admin.from("tender_documents").select("id, storage_path, source_url, original_filename, mime_type, page_count, parser_status, ocr_status").eq("tender_id", id)
    ]);
    return ok({
      ...tender,
      category: tender.procurement_category,
      tender_type: tender.procurement_category,
      active_status: formatActiveStatus(tender.status, tender.closing_date),
      estimated_cost: formatEstimatedCost(tender.estimated_value),
      extracted_fields: fields,
      documents: (docs ?? []).map((doc: any) => ({
        ...doc,
        download_url: `/tender_files/${encodeStoragePath(doc.storage_path)}`
      }))
    });
  } catch (error) {
    return fail(error);
  }
}

function formatActiveStatus(status: string, closingDate: string | null): "Active" | "Expired / Non-Active" {
  if (!["published", "corrigendum"].includes(status)) return "Expired / Non-Active";
  if (!closingDate) return "Active";
  return Date.parse(closingDate) >= startOfToday().getTime() ? "Active" : "Expired / Non-Active";
}

function formatEstimatedCost(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Cost Not Available";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Cost Not Available";
  return `Rs. ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(amount)}`;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
