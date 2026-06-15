import { AppShell } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AwardsPage(): Promise<JSX.Element> {
  const admin = createSupabaseAdminClient();
  const { data: awards } = await admin.from("award_records").select("*").order("award_date", { ascending: false, nullsFirst: false }).limit(100);
  return (
    <AppShell>
      <PageHeader title="Award History" body="Award records support contractor competitor analysis without opaque predictions." />
      <div className="grid gap-4">{(awards ?? []).map((award: any) => <Card key={award.id}><h2 className="font-semibold">{award.contractor_name}</h2><p className="text-sm text-muted-foreground">{award.department} · {formatCurrency(award.award_value)} · {formatDate(award.award_date)}</p></Card>)}</div>
    </AppShell>
  );
}
