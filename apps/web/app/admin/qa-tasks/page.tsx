import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function QaTasksPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: tasks } = context?.isOps ? await context.admin.from("qa_tasks").select("*, tenders(title), tender_sources(name)").order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="QA Tasks" body="Low-confidence fields, duplicate reviews, parser failures, and source failures." />
      <div className="grid gap-4">
        {(tasks ?? []).map((task: any) => (
          <Card key={task.id}>
            <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{task.title}</h2><Badge tone={task.priority === "urgent" || task.priority === "high" ? "bad" : "warn"}>{task.status}</Badge></div>
            <p className="mt-1 text-sm text-muted-foreground">{task.task_type} · {task.tenders?.title ?? task.tender_sources?.name ?? "global"}</p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
