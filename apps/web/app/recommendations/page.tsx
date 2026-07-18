import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList, ScoreRing } from "@/components/motion";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  let recommendations: any[] = [];
  if (context) {
    const { data } = await context.admin.from("recommendations").select("*, tenders(title, department, closing_date)").eq("organization_id", context.organizationId).order("score", { ascending: false }).limit(50);
    recommendations = data ?? [];
  }
  return (
    <AppShell>
      <PageHeader title="Recommendations" body="RECON scoring applies blockers before fit scoring." />
      {recommendations.length === 0 ? (
        <EmptyState
          body="Complete Profile Vault data and publish tenders to generate explainable RECON recommendations."
          icon={<ShieldCheck className="h-7 w-7" />}
          title="No recommendations yet"
        />
      ) : (
        <MotionList className="grid gap-4">
          {recommendations.map((rec) => (
            <MotionItem key={rec.id}>
              <Card className={rec.status === "blocked" ? "border-red-200/80" : rec.status === "warning" ? "border-amber-200/90" : "border-emerald-200/80"}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge tone={rec.status === "blocked" ? "bad" : rec.status === "warning" ? "warn" : "good"}>{rec.status}</Badge>
                      <Badge>Closing {rec.tenders?.closing_date ? new Date(rec.tenders.closing_date).toLocaleDateString("en-PK") : "needs review"}</Badge>
                    </div>
                    <h2 className="font-semibold">{rec.tenders?.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{rec.next_action}</p>
                  </div>
                  <ScoreRing label="RECON score" value={rec.score} />
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <p className="rounded-md bg-white/58 p-3"><strong>Reasons:</strong> {rec.positive_reasons?.join("; ") || "Needs profile data"}</p>
                  <p className="rounded-md bg-white/58 p-3"><strong>Warnings:</strong> {rec.warnings?.join("; ") || "None"}</p>
                  <p className="rounded-md bg-white/58 p-3"><strong>Blockers:</strong> {rec.blockers?.join("; ") || "None"}</p>
                </div>
                <LinkButton className="mt-4" href={`/tenders/${rec.tender_id}`}>View Tender</LinkButton>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
