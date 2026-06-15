import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function SubcontractingPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: rows } = context ? await context.admin.from("subcontracting_opportunities").select("*, tenders(title)").order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Subcontracting" body="Contractor-posted work packages linked to tender opportunities." />
      <div className="grid gap-4">{(rows ?? []).map((row: any) => <Card key={row.id}><div className="flex justify-between gap-3"><h2 className="font-semibold">{row.title}</h2><Badge>{row.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{row.sector} · {row.region ?? "Pakistan"}</p></Card>)}</div>
    </AppShell>
  );
}
