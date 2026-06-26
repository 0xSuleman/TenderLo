import { ArrowLeft, Clock, Download, FileText } from "lucide-react";
import { parseTenderIdFromSlug } from "@tenderlo/shared";
import { MarketingNav } from "@/components/nav";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getPageContext } from "@/lib/page-context";
import { hasActiveTenderPlan } from "@/lib/tender-search";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TenderSlugPage({ params }: { params: Promise<{ slug: string }> }): Promise<JSX.Element> {
  const { slug } = await params;
  const id = parseTenderIdFromSlug(slug);
  const admin = createSupabaseAdminClient();
  const context = await getPageContext();
  const fullAccess = context?.isOps ? true : context ? await hasActiveTenderPlan(admin, context.organizationId) : false;
  const { data: tender } = id
    ? await admin.from("tenders").select("*, tender_sources(name,source_type,base_url)").eq("id", id).maybeSingle()
    : { data: null };
  const isVisible = tender && (context?.isOps || ["published", "closed", "cancelled", "corrigendum"].includes(tender.status));
  const [{ data: fields }, { data: documents }] = fullAccess && isVisible
    ? await Promise.all([
      admin.from("extracted_fields").select("field_name,field_value,confidence_score,verification_status").eq("tender_id", id).neq("verification_status", "rejected").order("confidence_score", { ascending: false }),
      admin.from("tender_documents").select("id,storage_path,source_url,original_filename,mime_type,page_count,parser_status,ocr_status").eq("tender_id", id).order("created_at", { ascending: true })
    ])
    : [{ data: [] }, { data: [] }];
  const extracted = buildExtractedFieldMap(fields ?? []);

  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <a className="mb-4 inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground transition hover:bg-white/70 hover:text-foreground" href="/tenders">
          <ArrowLeft className="h-4 w-4" />
          Tender preview
        </a>
        <PageHeader title={isVisible ? tender.title : "Tender"} body={isVisible ? tender.department ?? "Published tender preview" : "Published tender preview"} />
        {isVisible ? (
          <Card>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={isActiveTender(tender.status, tender.closing_date) ? "good" : "warn"}>{isActiveTender(tender.status, tender.closing_date) ? "Active" : "Expired / Non-Active"}</Badge>
              <Badge tone="good">{tender.procurement_category ?? "Miscellaneous"}</Badge>
              <Badge tone="info">{tender.sector ?? "uncategorized"}</Badge>
              <Badge tone="info"><Clock className="h-3.5 w-3.5" />Closing {formatDate(tender.closing_date)}</Badge>
            </div>
            <DetailGrid
              items={[
                ["Title", tender.title],
                ["Active status", isActiveTender(tender.status, tender.closing_date) ? "Active" : "Expired / Non-Active"],
                ["Estimated cost", fullAccess ? formatCurrency(tender.estimated_value) : "Available on paid plans"],
                ["Category", tender.procurement_category ?? "Miscellaneous"],
                ["Sector", tender.sector ?? "Needs review"],
                ["Tender type", tender.procurement_category ?? "Needs review"],
                ["Publish date", formatDate(tender.advertisement_date)],
                ["Closing date", formatDate(tender.closing_date)],
                ["Created at", formatDate(tender.created_at)],
                ["Issuing authority", tender.department ?? "Needs review"],
                ["Procurement method", extracted.procurement_method ?? "Needs review"],
                ["Submission method", extracted.submission_method ?? "Needs review"],
                ["Source name", tender.tender_sources?.name ?? "Source needs review"],
                ["City", tender.city ?? "Needs review"],
                ["Province", tender.province ?? "Needs review"],
                ["Country", "Pakistan"],
                ["Website", fullAccess ? tender.tender_sources?.base_url ?? sourceWebsite(tender.source_url) ?? "Needs review" : "Available on paid plans"],
                ["Contact person", extracted.contact_person ?? "Needs review"]
              ]}
            />
            <div className="mt-6 rounded-md border border-white/70 bg-white/58 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" />Preview description</div>
              <p className="text-sm leading-6 text-muted-foreground">{tender.description?.slice(0, 600) ?? "Full description is available inside TenderLo."}</p>
            </div>
            {fullAccess ? (
              <div className="mt-6">
                <h2 className="font-semibold">Tender PDF Document</h2>
                <div className="mt-3 grid gap-3">
                  {(documents ?? []).length ? (documents ?? []).map((document: any) => (
                    <a key={document.id} className="inline-flex items-center justify-between gap-3 rounded-md border border-white/70 bg-white/58 px-3 py-2 text-sm font-semibold transition hover:bg-white" href={`/tender_files/${encodeStoragePath(document.storage_path)}`}>
                      <span>{document.original_filename ?? "Tender document"}</span>
                      <span className="inline-flex items-center gap-2 text-primary"><Download className="h-4 w-4" />Download</span>
                    </a>
                  )) : <p className="text-sm text-muted-foreground">Official PDF document is not attached yet.</p>}
                </div>
              </div>
            ) : (
              <LinkButton className="mt-6" href={context ? "/pricing" : "/signup"}>Unlock full details</LinkButton>
            )}
          </Card>
        ) : (
          <Card>Tender not found.</Card>
        )}
      </main>
    </>
  );
}

function DetailGrid({ items }: { items: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="grid gap-4 md:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-white/70 bg-white/58 p-3">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function buildExtractedFieldMap(fields: Array<{ field_name: string; field_value: string | null }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    if (!map[field.field_name] && field.field_value) map[field.field_name] = field.field_value;
  }
  return map;
}

function isActiveTender(status: string, closingDate: string | null): boolean {
  if (!["published", "corrigendum"].includes(status)) return false;
  if (!closingDate) return true;
  return Date.parse(closingDate) >= startOfToday().getTime();
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function sourceWebsite(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).host;
  } catch {
    return null;
  }
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
