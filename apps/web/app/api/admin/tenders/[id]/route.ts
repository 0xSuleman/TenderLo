import { tenderManualSchema } from "@tenderlo/shared";
import { fail, ok, parseBody } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, user } = await requireOpsAdmin(request);
    const input = await parseBody(request, tenderManualSchema.partial());
    const { data: before } = await admin.from("tenders").select("*").eq("id", id).single();
    const { data, error } = await admin.from("tenders").update({ ...input, is_human_verified: true }).eq("id", id).select("*").single();
    if (error) throw error;
    await writeAuditLog(admin, {
      actorUserId: user.id,
      action: "tender.updated",
      entityType: "tender",
      entityId: id,
      oldValue: before,
      newValue: data
    });
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
