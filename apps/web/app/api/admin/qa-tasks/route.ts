import { fail, ok } from "@/lib/api";
import { requireOpsAdmin } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireOpsAdmin(request);
    const { data, error } = await admin
      .from("qa_tasks")
      .select("*, tenders(title), tender_sources(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
