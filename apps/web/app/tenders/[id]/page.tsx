import { redirect } from "next/navigation";
import { tenderDetailPath } from "@tenderlo/shared";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function LegacyTenderIdPage({ params }: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data: tender } = await admin.from("tenders").select("id,title").eq("id", id).maybeSingle();
  if (!tender) redirect("/tenders");
  redirect(tenderDetailPath(tender.title, tender.id) as any);
}
