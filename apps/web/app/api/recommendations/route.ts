import { fail, ok } from "@/lib/api";
import { requireOrgContext } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin, organizationId } = await requireOrgContext(request);
    const { data, error } = await admin
      .from("recommendations")
      .select("*, tenders(*)")
      .eq("organization_id", organizationId)
      .order("score", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
