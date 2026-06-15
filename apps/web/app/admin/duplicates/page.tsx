import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function DuplicateReviewPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: duplicates } = context?.isOps ? await context.admin.from("duplicate_candidates").select("*, tenders!duplicate_candidates_tender_id_fkey(title), candidate:tenders!duplicate_candidates_candidate_tender_id_fkey(title)").order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Duplicate Review" body="Medium-confidence duplicate matches stay in ops review." />
      <div className="grid gap-4">
        {(duplicates ?? []).map((dup: any) => (
          <Card key={dup.id}><div className="flex justify-between gap-3"><h2 className="font-semibold">{dup.tenders?.title}</h2><Badge>{Math.round(Number(dup.confidence_score) * 100)}%</Badge></div><p className="mt-1 text-sm text-muted-foreground">Candidate: {dup.candidate?.title}</p></Card>
        ))}
      </div>
    </AppShell>
  );
}
