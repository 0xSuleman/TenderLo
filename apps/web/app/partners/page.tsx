import { AppShell } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function PartnersPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: matches } = context ? await context.admin.from("partner_matches").select("*, organizations!partner_matches_matched_organization_id_fkey(name, city, province)").eq("organization_id", context.organizationId).order("score", { ascending: false }) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="JV Partner Matches" body="Deterministic partner-fit scoring from sector, region, and PEC compatibility." />
      <div className="grid gap-4">{(matches ?? []).map((match: any) => <Card key={match.id}><h2 className="font-semibold">{match.organizations?.name}</h2><p className="text-sm text-muted-foreground">Score {match.score} · {match.reasons?.join("; ")}</p></Card>)}</div>
    </AppShell>
  );
}
