import { fail, ok } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  try {
    const admin = createSupabaseAdminClient();
    const url = new URL(request.url);
    const contractor = url.searchParams.get("contractor");
    let query = admin.from("award_records").select("*, tenders(title, department)").order("award_date", { ascending: false, nullsFirst: false }).limit(100);
    if (contractor) query = query.ilike("contractor_name", `%${contractor}%`);
    const { data, error } = await query;
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
