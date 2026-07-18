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
      .select("*, tender_sources(name, source_type, base_url), tender_sector_matches(*), tender_source_links(*)")
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

    const [{ data: fields }, { data: docs }, relatedTenders] = await Promise.all([
      admin.from("extracted_fields").select("*").eq("tender_id", id).neq("verification_status", "rejected").order("confidence_score", { ascending: false }),
      admin.from("tender_documents").select("id, storage_path, source_url, original_filename, mime_type, page_count, parser_status, ocr_status").eq("tender_id", id),
      loadRelatedTenders(admin, tender)
    ]);
    const extracted = buildExtractedFieldMap(fields ?? []);
    const provenance = firstSourceProvenance(tender.tender_source_links);
    const contact = parseContactDetails(extracted.contact_person);
    return ok({
      ...tender,
      category: tender.procurement_category,
      active_status: formatActiveStatus(tender.status, tender.closing_date),
      estimated_cost: formatEstimatedCost(tender.estimated_value),
      procurement_method: extracted.procurement_method ?? null,
      submission_method: extracted.submission_method ?? null,
      tender_type: extracted.tender_type ?? tender.procurement_category ?? null,
      contact_person: extracted.contact_person ?? null,
      contact_email: extracted.contact_email ?? contact.email,
      contact_phone: extracted.contact_phone ?? contact.phone,
      website_url: extracted.website_url ?? stringValue(provenance.websiteUrl) ?? tender.tender_sources?.base_url ?? null,
      original_source_url: extracted.original_source_url ?? stringValue(provenance.originalSourceUrl) ?? tender.source_url ?? null,
      source_provenance: provenance,
      extracted_fields: fields,
      related_tenders: relatedTenders,
      documents: (docs ?? []).map((doc: any) => ({
        ...doc,
        download_url: `/tender_files/${encodeStoragePath(doc.storage_path)}`
      }))
    });
  } catch (error) {
    return fail(error);
  }
}

async function loadRelatedTenders(admin: ReturnType<typeof createSupabaseAdminClient>, tender: any): Promise<any[]> {
  let query = admin
    .from("tenders")
    .select("id,title,department,sector,province,city,closing_date,status")
    .neq("id", tender.id)
    .in("status", ["published", "corrigendum"])
    .or(`closing_date.is.null,closing_date.gte.${startOfToday().toISOString()}`)
    .order("closing_date", { ascending: true, nullsFirst: false })
    .limit(6);
  query = tender.sector && tender.sector !== "uncategorized"
    ? query.eq("sector", tender.sector)
    : query.eq("procurement_category", tender.procurement_category);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

function buildExtractedFieldMap(fields: Array<{ field_name: string; field_value: string | null }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    if (!map[field.field_name] && field.field_value) map[field.field_name] = field.field_value;
  }
  return map;
}

function firstSourceProvenance(value: unknown): Record<string, unknown> {
  const link = Array.isArray(value) ? value[0] : value;
  if (!link || typeof link !== "object") return {};
  const provenance = (link as Record<string, unknown>).provenance;
  return provenance && typeof provenance === "object" && !Array.isArray(provenance)
    ? provenance as Record<string, unknown>
    : {};
}

function parseContactDetails(value: string | undefined): { email: string | null; phone: string | null } {
  if (!value) return { email: null, phone: null };
  return {
    email: value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null,
    phone: value.match(/(?:\+?92[\s().-]*|0)(?:3\d{2}|\d{2,3})[\s().-]*\d{3,4}[\s.-]*\d{3,4}\b/)?.[0] ?? null
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
