import { createQaTask } from "@tenderlo/db";
import { created, fail } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin } = await requireOpsAdmin(request);
    await createQaTask(admin, {
      tenderId: id,
      taskType: "parser_failure",
      priority: "medium",
      title: "Tender reparse requested",
      details: { requested_at: new Date().toISOString() }
    });
    return created({ tender_id: id, status: "queued_for_reparse" });
  } catch (error) {
    return fail(error);
  }
}
