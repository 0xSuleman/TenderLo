import { z } from "zod";
import { fail, ok, parseBody } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

const mergeSchema = z.object({
  duplicate_tender_id: z.string().uuid()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { duplicate_tender_id } = await parseBody(request, mergeSchema);
    const { admin, user } = await requireOpsAdmin(request);
    await admin.from("tender_documents").update({ tender_id: id }).eq("tender_id", duplicate_tender_id);
    await admin.from("extracted_fields").update({ tender_id: id }).eq("tender_id", duplicate_tender_id);
    await admin.from("tender_source_links").update({ tender_id: id }).eq("tender_id", duplicate_tender_id);
    await admin.from("duplicate_candidates").update({ status: "merged", reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("tender_id", duplicate_tender_id).eq("candidate_tender_id", id);
    await admin.from("tenders").delete().eq("id", duplicate_tender_id);
    await writeAuditLog(admin, {
      actorUserId: user.id,
      action: "tender.merged",
      entityType: "tender",
      entityId: id,
      oldValue: { duplicate_tender_id },
      newValue: { primary_tender_id: id }
    });
    return ok({ primary_tender_id: id, duplicate_tender_id, status: "merged" });
  } catch (error) {
    return fail(error);
  }
}
