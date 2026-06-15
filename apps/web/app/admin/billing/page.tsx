import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function BillingSupportPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: subs } = context?.isOps ? await context.admin.from("subscriptions").select("*, organizations(name)").order("updated_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Billing Support" body="PayFast subscriptions and manual invoice state." />
      <div className="grid gap-4">{(subs ?? []).map((sub: any) => <Card key={sub.id}><div className="flex justify-between gap-3"><h2 className="font-semibold">{sub.organizations?.name}</h2><Badge>{sub.status}</Badge></div><p className="text-sm text-muted-foreground">{sub.plan} · {sub.provider}</p></Card>)}</div>
    </AppShell>
  );
}
