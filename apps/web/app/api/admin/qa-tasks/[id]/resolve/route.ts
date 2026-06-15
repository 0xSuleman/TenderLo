import { z } from "zod";
import { fail, ok, parseBody } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

const resolveSchema = z.object({
  status: z.enum(["resolved", "dismissed"]).default("resolved"),
  field_id: z.string().uuid().optional(),
  verified_value: z.string().optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, user } = await requireOpsAdmin(request);
    const input = await parseBody(request, resolveSchema);
    const { data: before } = await admin.from("qa_tasks").select("*").eq("id", id).single();
    if (input.field_id && input.verified_value) {
      await admin
        .from("extracted_fields")
        .update({ field_value: input.verified_value, verification_status: "verified", verified_by: user.id, verified_at: new Date().toISOString(), source_method: "manual" })
        .eq("id", input.field_id);
    }
    const { data, error } = await admin
      .from("qa_tasks")
      .update({ status: input.status, resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await writeAuditLog(admin, {
      organizationId: data.organization_id,
      actorUserId: user.id,
      action: "qa_task.resolved",
      entityType: "qa_task",
      entityId: id,
      oldValue: before,
      newValue: data
    });
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
