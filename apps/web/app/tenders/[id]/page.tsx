import { ArrowLeft, Clock, FileText } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PublicTenderPage({ params }: { params: Promise<{ id: string }> }): Promise<JSX.Element> {
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data: tender } = await admin
    .from("tenders")
    .select("id,title,tender_number,department,sector,province,city,description,closing_date,status,tender_sources(name,source_type)")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <a className="mb-4 inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground transition hover:bg-white/70 hover:text-foreground" href="/tenders">
          <ArrowLeft className="h-4 w-4" />
          Tender preview
        </a>
        <PageHeader title={tender?.title ?? "Tender"} body={tender?.department ?? "Published tender preview"} />
        {tender ? (
          <Card>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone="good">{tender.status}</Badge>
              <Badge tone="good">{tender.sector ?? "uncategorized"}</Badge>
              <Badge tone="info"><Clock className="h-3.5 w-3.5" />Closing {formatDate(tender.closing_date)}</Badge>
            </div>
            <dl className="grid gap-4 md:grid-cols-2">
              {[
                ["Closing date", formatDate(tender.closing_date)],
                ["Location", tender.city ?? tender.province ?? "Needs review"],
                ["Tender number", tender.tender_number ?? "Needs review"],
                ["Source", tender.tender_sources?.name ?? "Source needs review"]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-white/70 bg-white/58 p-3">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 rounded-md border border-white/70 bg-white/58 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" />Preview description</div>
              <p className="text-sm leading-6 text-muted-foreground">{tender.description?.slice(0, 600) ?? "Full description is available inside TenderLo."}</p>
            </div>
            <LinkButton className="mt-6" href="/signup">Unlock full details</LinkButton>
          </Card>
        ) : (
          <Card>Tender not found.</Card>
        )}
      </main>
    </>
  );
}
