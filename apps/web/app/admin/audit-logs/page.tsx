import { AppShell } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: logs } = context?.isOps ? await context.admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Audit Logs" body="Tender, profile, billing, source, QA, role, and admin changes." />
      <div className="grid gap-4">{(logs ?? []).map((log: any) => <Card key={log.id}><h2 className="font-semibold">{log.action}</h2><p className="text-sm text-muted-foreground">{log.entity_type} · {formatDate(log.created_at)}</p></Card>)}</div>
    </AppShell>
  );
}
