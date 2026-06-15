import { sourceCreateSchema } from "@tenderlo/shared";
import { created, fail, ok, parseBody } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireOpsAdmin(request);
    const { data, error } = await admin.from("tender_sources").select("*, ingestion_runs(*)").order("name");
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, user } = await requireOpsAdmin(request);
    const input = await parseBody(request, sourceCreateSchema);
    const { data, error } = await admin.from("tender_sources").insert(input).select("*").single();
    if (error) throw error;
    await writeAuditLog(admin, {
      actorUserId: user.id,
      action: "source.created",
      entityType: "tender_source",
      entityId: data.id,
      newValue: data
    });
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
