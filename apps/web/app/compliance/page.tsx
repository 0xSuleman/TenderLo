import { ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CompliancePage(): Promise<JSX.Element> {
  const context = await getPageContext();
  let checks: any[] = [];
  if (context) {
    const { data } = await context.admin.from("compliance_checks").select("*, tenders(title, closing_date)").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(50);
    checks = data ?? [];
  }
  return (
    <AppShell>
      <PageHeader title="Compliance Reports" body="Printable bid-readiness checks with blockers, warnings, unknowns, and source evidence." />
      {checks.length === 0 ? (
        <EmptyState
          body="Run a compliance check from a tender detail workflow after profile and tender requirements are available."
          icon={<ClipboardCheck className="h-7 w-7" />}
          title="No compliance reports yet"
        />
      ) : (
        <MotionList className="grid gap-4">
          {checks.map((check) => (
            <MotionItem key={check.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">{check.tenders?.title}</h2><p className="mt-1 text-sm text-muted-foreground">Created {formatDate(check.created_at)}</p></div>
                  <Badge tone={check.status === "not_eligible" ? "bad" : check.status === "eligible_with_warnings" || check.status === "unknown" ? "warn" : "good"}>{check.status}</Badge>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <p className="rounded-md bg-white/58 p-3"><strong>Missing:</strong> {check.missing_documents?.join(", ") || "None"}</p>
                  <p className="rounded-md bg-white/58 p-3"><strong>Expired:</strong> {check.expired_documents?.join(", ") || "None"}</p>
                  <p className="rounded-md bg-white/58 p-3"><strong>Blockers:</strong> {check.blockers?.join("; ") || "None"}</p>
                </div>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
