import { AppShell } from "@/components/nav";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function AdminTendersPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: tenders } = context?.isOps ? await context.admin.from("tenders").select("*").order("updated_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Manual Tender Editor" body="Ops-created and edited tender records write audit logs." />
      <div className="grid gap-4">
        {(tenders ?? []).map((tender: any) => (
          <Card key={tender.id}><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{tender.title}</h2><Badge>{tender.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{tender.department}</p><LinkButton className="mt-4" href={`/tenders/${tender.id}`}>Open</LinkButton></Card>
        ))}
      </div>
    </AppShell>
  );
}
