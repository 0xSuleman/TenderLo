import { Bell, FileSearch, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/nav";
import { AnimatedNumber, MotionItem, MotionList, ProgressBar } from "@/components/motion";
import { Badge, Card, LinkButton, MetricCard, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  if (!context) return <AppShell><Card>Sign in to open your contractor dashboard.</Card></AppShell>;
  const [org, profile, tenders, recs, qa] = await Promise.all([
    context.admin.from("organizations").select("*").eq("id", context.organizationId).single(),
    context.admin.from("company_profiles").select("*").eq("organization_id", context.organizationId).maybeSingle(),
    context.admin.from("tenders").select("id", { count: "exact", head: true }).in("status", ["published", "corrigendum"]),
    context.admin.from("recommendations").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).neq("status", "blocked"),
    context.admin.from("qa_tasks").select("id", { count: "exact", head: true }).eq("status", "open")
  ]);
  return (
    <AppShell>
      <PageHeader title={org.data?.name ?? "Dashboard"} body="Contractor tender pipeline, readiness, and QA status." />
      <MotionList className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MotionItem><MetricCard detail="published" label="Published tenders" value={<AnimatedNumber value={tenders.count ?? 0} />} /></MotionItem>
        <MotionItem><MetricCard detail="fit" label="Recommendations" tone="good" value={<AnimatedNumber value={recs.count ?? 0} />} /></MotionItem>
        <MotionItem>
          <MetricCard
            detail="readiness"
            label="Profile score"
            tone={(profile.data?.profile_completeness_score ?? 0) >= 70 ? "good" : "warn"}
            value={<AnimatedNumber suffix="%" value={profile.data?.profile_completeness_score ?? 0} />}
          />
        </MotionItem>
        <MotionItem><MetricCard detail="review" label="Open QA" tone={qa.count ? "warn" : "good"} value={<AnimatedNumber value={qa.count ?? 0} />} /></MotionItem>
      </MotionList>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Bid-readiness pulse</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Profile completeness directly affects recommendation quality and compliance warnings.</p>
            </div>
            <Badge tone="info">RECON inputs</Badge>
          </div>
          <ProgressBar className="mt-5" tone={(profile.data?.profile_completeness_score ?? 0) >= 70 ? "success" : "warning"} value={profile.data?.profile_completeness_score ?? 0} />
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone="good">PEC-aware</Badge>
            <Badge>Evidence-backed</Badge>
            <Badge tone="warn">Unknowns visible</Badge>
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-xl font-semibold">Quick actions</h2>
          <div className="mt-4 grid gap-2">
            <LinkButton href="/search"><FileSearch className="h-4 w-4" />Search tenders</LinkButton>
            <LinkButton href="/profile"><Upload className="h-4 w-4" />Update Profile Vault</LinkButton>
            <LinkButton href="/recommendations"><ShieldCheck className="h-4 w-4" />Review recommendations</LinkButton>
            <LinkButton href="/saved-searches"><Bell className="h-4 w-4" />Manage alerts</LinkButton>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
