import { Bell } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function AlertsPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: alerts } = context ? await context.admin.from("notifications").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Alerts" body="Saved-search, recommendation, email, in-app, and WhatsApp notifications." />
      {(alerts ?? []).length === 0 ? (
        <EmptyState body="Saved searches and recommendations will create notifications here." icon={<Bell className="h-7 w-7" />} title="No alerts yet" />
      ) : (
        <MotionList className="grid gap-4">
          {(alerts ?? []).map((alert: any) => (
            <MotionItem key={alert.id}>
              <Card>
                <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{alert.title}</h2><Badge tone={alert.status === "sent" ? "good" : alert.status === "failed" ? "bad" : "warn"}>{alert.status}</Badge></div>
                <p className="mt-2 text-sm text-muted-foreground">{alert.body}</p>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
