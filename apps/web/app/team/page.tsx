import { Users } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function TeamPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: members } = context ? await context.admin.from("memberships").select("*, profiles(full_name)").eq("organization_id", context.organizationId) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Team Settings" body="Workspace roles control billing, profile edits, document access, and QA operations." />
      {(members ?? []).length === 0 ? (
        <EmptyState body="Active contractor workspace members will appear here." icon={<Users className="h-7 w-7" />} title="No team members found" />
      ) : (
        <MotionList className="grid gap-4">
          {(members ?? []).map((member: any) => (
            <MotionItem key={member.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">{member.profiles?.full_name ?? member.user_id}</h2><p className="text-sm text-muted-foreground">{member.role}</p></div>
                  <Badge tone={member.status === "active" ? "good" : "warn"}>{member.status}</Badge>
                </div>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
