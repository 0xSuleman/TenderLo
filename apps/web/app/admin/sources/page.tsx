import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: sources } = context?.isOps ? await context.admin.from("tender_sources").select("*").order("name") : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Source Health" body="Official portals, department sites, and public newspaper adapters." />
      <div className="grid gap-4">
        {(sources ?? []).map((source: any) => (
          <Card key={source.id}>
            <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{source.name}</h2><Badge tone={source.status === "active" ? "good" : "bad"}>{source.status}</Badge></div>
            <p className="mt-1 text-sm text-muted-foreground">{source.adapter_key} · failures {source.consecutive_failures}</p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
