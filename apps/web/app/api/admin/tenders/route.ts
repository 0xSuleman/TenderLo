import { buildCanonicalTenderId, classifyTender, classifyTenderCategory, normalizeDepartment } from "@tenderlo/intelligence";
import { normalizeForSearch, tenderManualSchema } from "@tenderlo/shared";
import { created, fail, parseBody } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, user } = await requireOpsAdmin(request);
    const input = await parseBody(request, tenderManualSchema);
    const { data: source } = await admin.from("tender_sources").select("id").eq("adapter_key", "manual").maybeSingle();
    let manualSourceId = source?.id;
    if (!manualSourceId) {
      const { data: createdSource, error: sourceError } = await admin
        .from("tender_sources")
        .insert({ name: "Manual Tender Entry", base_url: "https://tenderlo.local/manual", source_type: "manual", adapter_key: "manual", status: "active" })
        .select("id")
        .single();
      if (sourceError) throw sourceError;
      manualSourceId = createdSource.id;
    }
    const classification = classifyTender({ title: input.title, description: input.description ?? null });
    const procurementCategory = input.procurement_category ?? classifyTenderCategory({ title: input.title, description: input.description ?? null });
    const canonicalTenderId = buildCanonicalTenderId({
      sourceId: manualSourceId,
      sourceUrl: input.source_url ?? null,
      tenderNumber: input.tender_number ?? null,
      title: input.title,
      department: input.department ?? null,
      closingDate: input.closing_date ?? null
    });
    const { data, error } = await admin
      .from("tenders")
      .insert({
        ...input,
        source_id: manualSourceId,
        canonical_tender_id: canonicalTenderId,
        normalized_title: normalizeForSearch(input.title),
        department: normalizeDepartment(input.department) ?? input.department,
        procurement_category: procurementCategory,
        sector: input.sector ?? classification[0]?.sector ?? "uncategorized",
        extraction_confidence: 1,
        is_human_verified: true
      })
      .select("*")
      .single();
    if (error) throw error;
    await writeAuditLog(admin, {
      actorUserId: user.id,
      action: "tender.created",
      entityType: "tender",
      entityId: data.id,
      newValue: data
    });
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
