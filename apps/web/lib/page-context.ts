import { getActiveMembership, isOpsAdmin, type DatabaseClient } from "@tenderlo/db";
import { createSupabaseAdminClient, createSupabaseRouteClient } from "@/lib/supabase";

export async function getPageContext(): Promise<{ admin: DatabaseClient; userId: string; organizationId: string; isOps: boolean } | null> {
  try {
    const supabase = await createSupabaseRouteClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const admin = createSupabaseAdminClient();
    const membership = await getActiveMembership(admin, data.user.id);
    return {
      admin,
      userId: data.user.id,
      organizationId: membership.organization_id,
      isOps: await isOpsAdmin(admin, data.user.id)
    };
  } catch {
    return null;
  }
}
