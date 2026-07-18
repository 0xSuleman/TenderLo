import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: sources } = context?.isOps
    ? await context.admin.from("tender_sources").select("*, ingestion_runs(*)").order("name")
    : { data: [] };

  return (
    <AppShell>
      <PageHeader title="Source Health" body="Official portals, department sites, and public newspaper adapters." />
      <div className="grid gap-4">
        {(sources ?? []).map((source: any) => {
          const latestRun = [...(source.ingestion_runs ?? [])].sort((left: any, right: any) =>
            new Date(right.started_at).getTime() - new Date(left.started_at).getTime()
          )[0];
          const circuitOpen = source.circuit_open_until && new Date(source.circuit_open_until).getTime() > Date.now();
          return (
            <Card key={source.id}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{source.name}</h2>
                <Badge tone={source.status === "active" ? "good" : "bad"}>{source.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{source.adapter_key} · consecutive failures {source.consecutive_failures}</p>
              {circuitOpen ? <p className="mt-2 text-sm font-medium text-amber-700">Circuit paused until {new Date(source.circuit_open_until).toLocaleString()}</p> : null}
              {source.last_error ? <p className="mt-2 text-sm text-destructive">Last error: {source.last_error}</p> : null}
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <span>Last success: {source.last_success_at ? new Date(source.last_success_at).toLocaleString() : "Never"}</span>
                <span>Last run: {latestRun?.status ?? "Never"}</span>
                <span>Accepted: {latestRun ? Number(latestRun.tenders_created ?? 0) + Number(latestRun.tenders_updated ?? 0) : 0}</span>
                <span>Rejected: {latestRun?.tenders_rejected ?? 0}</span>
                <span>Documents: {latestRun ? `${latestRun.documents_downloaded ?? 0} downloaded / ${latestRun.documents_failed ?? 0} failed` : "—"}</span>
                <span>Snapshots: {latestRun?.snapshots_stored ?? 0}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
