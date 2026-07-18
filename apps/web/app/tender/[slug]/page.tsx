import type { ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarDays,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  Globe2,
  Landmark,
  Link2,
  Mail,
  MapPin,
  MapPinned,
  Phone,
  Send,
  Tag,
  UserRound,
  Waypoints
} from "lucide-react";
import { parseTenderIdFromSlug, tenderDetailPath } from "@tenderlo/shared";
import { MarketingNav } from "@/components/nav";
import { SectionReveal } from "@/components/motion";
import { Card, LinkButton } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getPageContext } from "@/lib/page-context";
import { hasActiveTenderPlan } from "@/lib/tender-search";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type TenderDocument = {
  id: string;
  storage_path: string;
  source_url: string | null;
  original_filename: string;
  mime_type: string;
  page_count: number | null;
  parser_status: string;
  ocr_status: string;
};

type RelatedTender = {
  id: string;
  title: string;
  department: string | null;
  sector: string | null;
  province: string | null;
  city: string | null;
  closing_date: string | null;
};

export default async function TenderSlugPage({ params }: { params: Promise<{ slug: string }> }): Promise<JSX.Element> {
  const { slug } = await params;
  const id = parseTenderIdFromSlug(slug);
  const admin = createSupabaseAdminClient();
  const context = await getPageContext();
  const fullAccess = context?.isOps ? true : context ? await hasActiveTenderPlan(admin, context.organizationId) : false;
  const { data: tender } = id
    ? await admin
      .from("tenders")
      .select("*, tender_sources(name,source_type,base_url), tender_source_links(source_url,provenance)")
      .eq("id", id)
      .maybeSingle()
    : { data: null };
  const isVisible = tender && (context?.isOps || ["published", "closed", "cancelled", "corrigendum"].includes(tender.status));

  if (!isVisible) {
    return (
      <>
        <MarketingNav />
        <main className="mx-auto max-w-6xl px-4 py-12">
          <Card>Tender not found or not available for public viewing.</Card>
        </main>
      </>
    );
  }

  const [{ data: fields }, { data: documents }, relatedTenders] = await Promise.all([
    fullAccess
      ? admin
        .from("extracted_fields")
        .select("field_name,field_value,confidence_score,verification_status")
        .eq("tender_id", id)
        .neq("verification_status", "rejected")
        .neq("verification_status", "needs_review")
        .order("confidence_score", { ascending: false })
      : Promise.resolve({ data: [] }),
    fullAccess
      ? admin
        .from("tender_documents")
        .select("id,storage_path,source_url,original_filename,mime_type,page_count,parser_status,ocr_status")
        .eq("tender_id", id)
        .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    loadRelatedTenders(admin, tender)
  ]);

  const extracted = buildExtractedFieldMap(fields ?? []);
  const provenance = firstSourceProvenance(tender.tender_source_links);
  const contact = resolveContact(extracted);
  const websiteUrl = extracted.website_url
    ?? stringValue(provenance.websiteUrl)
    ?? tender.tender_sources?.base_url
    ?? sourceOrigin(tender.source_url);
  const originalSourceUrl = extracted.original_source_url
    ?? stringValue(provenance.originalSourceUrl)
    ?? tender.source_url;
  const docs = (documents ?? []) as TenderDocument[];
  const primaryDocument = docs.find(isBrowserPreviewableDocument) ?? docs[0];
  const primaryDocumentUrl = primaryDocument ? tenderFileUrl(primaryDocument.storage_path) : null;
  const canPreviewPrimaryDocument = primaryDocument ? isBrowserPreviewableDocument(primaryDocument) : false;
  const isActive = isActiveTender(tender.status, tender.closing_date);

  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-7xl px-4 py-10 md:py-12">
        <a className="mb-5 inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground transition hover:bg-white/70 hover:text-foreground" href="/tenders">
          <ArrowLeft className="h-4 w-4" />
          Back to all tenders
        </a>

        <header className="premium-gradient animate-rise relative overflow-hidden rounded-lg p-6 text-primary-foreground shadow-glow md:p-8">
          <div aria-hidden="true" className="absolute -right-20 -top-24 size-64 rounded-full bg-white/15 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-28 left-1/3 size-64 rounded-full bg-secondary/30 blur-3xl" />
          <div className="relative grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/75">Tender opportunity</p>
              <h1 className="max-w-5xl break-words font-display text-3xl font-semibold leading-tight md:text-4xl">{tender.title}</h1>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/90">
                <span className="flex min-w-0 items-start gap-2"><Tag className="mt-0.5 h-4 w-4 shrink-0" /><strong className="shrink-0">Tender No:</strong><span className="break-all">{tender.tender_number ?? "Needs review"}</span></span>
                <span className="flex min-w-0 items-start gap-2"><Landmark className="mt-0.5 h-4 w-4 shrink-0" /><strong className="shrink-0">Issuing authority:</strong><span className="break-words">{tender.department ?? "Needs review"}</span></span>
              </div>
            </div>
            <div className="min-w-52 rounded-lg border border-white/25 bg-white/14 p-4 shadow-soft backdrop-blur-xl">
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{isActive ? "Active Tender" : "Expired / Non-Active"}</span>
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />Closing date</p>
              <p className="mt-1 pl-6 text-sm text-white/90">{formatDateTime(tender.closing_date)}</p>
            </div>
          </div>
        </header>

        <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-7">
            <SectionReveal>
              <DetailSection title="Tender overview" icon={<FileCheck2 className="h-5 w-5" />}>
                <DetailRow icon={<FolderOpen />} label="Category" value={tender.procurement_category ?? "Needs review"} />
                <DetailRow icon={<Waypoints />} label="Sector" value={friendlyValue(tender.sector)} />
                <DetailRow icon={<FileText />} label="Tender type" value={extracted.tender_type ?? tender.procurement_category ?? "Needs review"} />
                <DetailRow icon={<BadgeCheck />} label="Procurement method" value={extracted.procurement_method ?? "Needs review"} />
                <DetailRow icon={<Send />} label="Submission method" value={extracted.submission_method ?? "Needs review"} />
                <DetailRow icon={<Globe2 />} label="Source name" value={tender.tender_sources?.name ?? "Needs review"} />
                <DetailRow icon={<BadgeCheck />} label="Source status" value={extracted.source_status ?? tender.status.replaceAll("_", " ")} />
              </DetailSection>
            </SectionReveal>

            <SectionReveal>
              <DetailSection title="Location & dates" icon={<MapPinned className="h-5 w-5" />}>
                <DetailRow icon={<MapPin />} label="City" value={tender.city ?? "Needs review"} />
                <DetailRow icon={<MapPinned />} label="Province" value={tender.province ?? "Needs review"} />
                <DetailRow icon={<Globe2 />} label="Country" value="Pakistan" />
                <DetailRow icon={<CalendarDays />} label="Publish date" value={formatDate(tender.advertisement_date)} />
                <DetailRow icon={<Clock3 />} label="Closing date" value={formatDateTime(tender.closing_date)} />
                <DetailRow icon={<Clock3 />} label="Bid opening" value={formatDateTime(tender.opening_date)} />
                <DetailRow icon={<CalendarDays />} label="Added to TenderLo" value={formatDateTime(tender.created_at)} />
              </DetailSection>
            </SectionReveal>

            <SectionReveal>
              <DetailSection title="Commercial details" icon={<Banknote className="h-5 w-5" />}>
                <DetailRow icon={<Banknote />} label="Estimated value" value={fullAccess ? commercialValue(tender.estimated_value ?? extracted.estimated_value, extracted.estimated_value_summary) : "Available on paid plans"} />
                <DetailRow icon={<Banknote />} label="Bid security" value={fullAccess ? extracted.bid_security_summary ?? commercialValue(tender.bid_security_amount ?? extracted.bid_security_amount) : "Available on paid plans"} />
                <DetailRow icon={<Banknote />} label="Document fee" value={fullAccess ? commercialValue(tender.document_fee ?? extracted.document_fee) : "Available on paid plans"} />
                <DetailRow icon={<BadgeCheck />} label="Data confidence" value={`${Math.round(Number(tender.extraction_confidence ?? 0) * 100)}% · ${tender.is_human_verified ? "Human verified" : "Automated, evidence-backed"}`} />
              </DetailSection>
            </SectionReveal>

            <SectionReveal>
              <DetailSection title="Contact & websites" icon={<Building2 className="h-5 w-5" />}>
                <DetailRow icon={<UserRound />} label="Contact person" value={fullAccess ? contact.person : "Available on paid plans"} />
                <DetailRow icon={<Phone />} label="Contact phone" value={fullAccess ? contact.phone : "Available on paid plans"} />
                <DetailRow icon={<Mail />} label="Contact email" value={fullAccess ? contact.email : "Available on paid plans"} />
                <DetailRow icon={<Globe2 />} label="Website" value={fullAccess ? externalValue(websiteUrl) : "Available on paid plans"} />
                <DetailRow icon={<Link2 />} label="Original source" value={fullAccess ? externalValue(originalSourceUrl) : "Available on paid plans"} />
              </DetailSection>
            </SectionReveal>

            <SectionReveal>
              <section>
                <SectionHeading icon={<FileText className="h-5 w-5" />} title="Tender documents" />
                <Card className="overflow-hidden p-0">
                  {fullAccess && primaryDocumentUrl && canPreviewPrimaryDocument ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-5 py-4">
                        <div>
                          <p className="font-semibold">{primaryDocument?.original_filename}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{primaryDocument?.page_count ? `${primaryDocument.page_count} pages · ` : ""}{primaryDocument?.parser_status.replaceAll("_", " ")}</p>
                        </div>
                        <a className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" href={primaryDocumentUrl}>
                          <Download className="h-4 w-4" />Download
                        </a>
                      </div>
                      {primaryDocument?.mime_type.toLowerCase().includes("pdf") ? (
                        <iframe className="h-[540px] w-full bg-slate-900 md:h-[720px]" src={primaryDocumentUrl} title={`Tender document: ${primaryDocument?.original_filename ?? tender.title}`} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="max-h-[720px] w-full object-contain bg-slate-900" src={primaryDocumentUrl} alt={`Tender document: ${primaryDocument?.original_filename ?? tender.title}`} />
                      )}
                    </>
                  ) : (
                    <div className="grid place-items-center px-6 py-14 text-center">
                      <FileText className="h-10 w-10 text-primary" />
                      <h3 className="mt-4 font-semibold">{fullAccess ? "Official document preview unavailable" : "Unlock the official tender documents"}</h3>
                      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{fullAccess ? "The source record is preserved, but no browser-previewable tender document is attached. Portal webpages are not treated as tender documents." : "Tender documents are stored privately and served through authenticated TenderLo links."}</p>
                      {!fullAccess ? <LinkButton className="mt-5" href={context ? "/pricing" : "/signup"}>Unlock full details</LinkButton> : null}
                    </div>
                  )}
                </Card>
                {fullAccess && docs.length > 1 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {docs.map((document) => (
                      <a key={document.id} className="premium-surface interactive-lift inline-flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold" href={tenderFileUrl(document.storage_path)}>
                        <span className="truncate">{document.original_filename}</span>
                        <Download className="h-4 w-4 shrink-0 text-primary" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            </SectionReveal>

            <SectionReveal>
              <section>
                <SectionHeading icon={<FileText className="h-5 w-5" />} title="Tender description" />
                <Card>
                  <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">
                    {fullAccess ? tender.description ?? "A detailed description has not been verified yet." : tender.description?.slice(0, 600) ?? "Full description is available inside TenderLo."}
                  </p>
                </Card>
              </section>
            </SectionReveal>
          </div>

          <aside className="grid gap-6 lg:sticky lg:top-24">
            <SectionReveal>
              <section>
                <SectionHeading icon={<ExternalLink className="h-5 w-5" />} title="Actions" />
                <Card className="grid gap-3">
                  <LinkButton href={fullAccess && primaryDocumentUrl ? primaryDocumentUrl : context ? "/pricing" : "/signup"}>
                    <Download className="h-4 w-4" />{fullAccess ? "Download tender document" : "Unlock tender document"}
                  </LinkButton>
                  {fullAccess && originalSourceUrl ? (
                    <a className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary/35 bg-white/55 px-4 text-sm font-semibold text-primary shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/80" href={originalSourceUrl} rel="noreferrer" target="_blank">
                      <ExternalLink className="h-4 w-4" />View original advertisement
                    </a>
                  ) : (
                    <LinkButton href={context ? "/pricing" : "/signup"}><ExternalLink className="h-4 w-4" />Unlock original source</LinkButton>
                  )}
                  <a className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border/75 bg-white/45 px-4 text-sm font-semibold text-foreground shadow-sm backdrop-blur transition hover:bg-white/80" href="/tenders">
                    <ArrowLeft className="h-4 w-4" />Back to all tenders
                  </a>
                </Card>
              </section>
            </SectionReveal>

            <SectionReveal>
              <section>
                <SectionHeading icon={<Waypoints className="h-5 w-5" />} title="Related tenders" />
                <Card className="grid gap-3">
                  {relatedTenders.length ? relatedTenders.map((related) => (
                    <RelatedTenderCard key={related.id} tender={related} />
                  )) : <p className="text-sm text-muted-foreground">No closely related active tenders are available yet.</p>}
                </Card>
              </section>
            </SectionReveal>
          </aside>
        </div>
      </main>
    </>
  );
}

function DetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section>
      <SectionHeading icon={icon} title={title} />
      <Card className="divide-y divide-border/55 p-0">{children}</Card>
    </section>
  );
}

function SectionHeading({ title, icon }: { title: string; icon: ReactNode }): JSX.Element {
  return <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-foreground"><span className="text-primary">{icon}</span>{title}</h2>;
}

function DetailRow({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start">
      <dt className="flex items-center gap-2 font-semibold text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary">{icon}{label}</dt>
      <dd className="break-words leading-6 text-muted-foreground">{value}</dd>
    </div>
  );
}

function RelatedTenderCard({ tender }: { tender: RelatedTender }): JSX.Element {
  return (
    <a className="group rounded-lg border border-border/65 bg-white/48 p-3 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-white/78" href={tenderDetailPath(tender.title, tender.id)}>
      <h3 className="line-clamp-3 text-sm font-semibold leading-5 group-hover:text-primary">{tender.title}</h3>
      <p className="mt-2 text-xs text-muted-foreground"><strong>Closes:</strong> {formatDate(tender.closing_date)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{[tender.city, tender.province].filter(Boolean).join(", ") || tender.department || "Pakistan"}</p>
    </a>
  );
}

async function loadRelatedTenders(admin: ReturnType<typeof createSupabaseAdminClient>, tender: any): Promise<RelatedTender[]> {
  let query = admin
    .from("tenders")
    .select("id,title,department,sector,province,city,closing_date")
    .neq("id", tender.id)
    .in("status", ["published", "corrigendum"])
    .or(`closing_date.is.null,closing_date.gte.${startOfToday().toISOString()}`)
    .order("closing_date", { ascending: true, nullsFirst: false })
    .limit(6);
  if (tender.sector && tender.sector !== "uncategorized") query = query.eq("sector", tender.sector);
  else if (tender.procurement_category) query = query.eq("procurement_category", tender.procurement_category);
  else query = query.eq("source_id", tender.source_id);
  const { data } = await query;
  return (data ?? []) as RelatedTender[];
}

function buildExtractedFieldMap(fields: Array<{ field_name: string; field_value: string | null }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    if (!map[field.field_name] && field.field_value) map[field.field_name] = field.field_value;
  }
  return map;
}

function firstSourceProvenance(value: unknown): Record<string, unknown> {
  const link = Array.isArray(value) ? value[0] : value;
  if (!link || typeof link !== "object") return {};
  const provenance = (link as Record<string, unknown>).provenance;
  return provenance && typeof provenance === "object" && !Array.isArray(provenance)
    ? provenance as Record<string, unknown>
    : {};
}

function resolveContact(extracted: Record<string, string>): { person: string; phone: string; email: string } {
  const raw = extracted.contact_person ?? "";
  const email = extracted.contact_email ?? raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "Not stated in official document";
  const phone = extracted.contact_phone ?? raw.match(/(?:\+?92[\s().-]*|0)(?:3\d{2}|\d{2,3})[\s().-]*\d{3,4}[\s.-]*\d{3,4}\b/)?.[0] ?? "Not stated in official document";
  const person = raw
    .split("|")
    .map((part) => part.trim())
    .find((part) => part && !part.includes("@") && part !== phone)
    ?? "Not stated in official document";
  return { person, phone, email };
}

function externalValue(value: string | null | undefined): ReactNode {
  if (!value) return "Needs review";
  return <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={value} rel="noreferrer" target="_blank">{value}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>;
}

function friendlyValue(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Needs review";
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Needs review";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi"
  }).format(new Date(value));
}

function sourceOrigin(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tenderFileUrl(path: string): string {
  return `/tender_files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function commercialValue(value: number | string | null | undefined, fallback?: string): string {
  return value === null || value === undefined || value === ""
    ? fallback ?? "Not stated in official document"
    : formatCurrency(value);
}

function isBrowserPreviewableDocument(document: TenderDocument): boolean {
  const mimeType = document.mime_type.toLowerCase();
  const filename = document.original_filename.toLowerCase();
  return mimeType.includes("pdf")
    || mimeType.startsWith("image/")
    || /\.(?:pdf|jpe?g|png|tiff?|webp)$/.test(filename);
}
