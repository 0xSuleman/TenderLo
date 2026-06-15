import { FileSearch, Filter, Search, X } from "lucide-react";
import { contractorSectors, pecCategories, pakistanProvinces, tenderSearchSchema } from "@tenderlo/shared";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList, ScoreRing } from "@/components/motion";
import { Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { formatCurrency, formatDate } from "@/lib/utils";
import { hasActiveTenderPlan, listTenderSourceOptions, searchTenders, type TenderSearchResult, type TenderSourceOption } from "@/lib/tender-search";

export const dynamic = "force-dynamic";

const sortOptions = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["closing_soon", "Closing soon"],
  ["estimated_value_desc", "Estimated value high to low"],
  ["estimated_value_asc", "Estimated value low to high"],
  ["bid_security_desc", "Bid security high to low"],
  ["bid_security_asc", "Bid security low to high"],
  ["recommendation_score", "Recommendation score"]
] as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<JSX.Element> {
  const params = await searchParams;
  const parsed = tenderSearchSchema.safeParse(params);
  const input = parsed.success ? parsed.data : tenderSearchSchema.parse({});
  const validationMessage = parsed.success ? null : parsed.error.issues[0]?.message ?? "Invalid search filters.";
  const context = await getPageContext();
  const activeFilters = buildActiveFilters(params);
  let result: TenderSearchResult = {
    data: [],
    pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0 },
    meta: { planAccess: "free", appliedFilters: {} }
  };
  let sources: TenderSourceOption[] = [];

  if (context) {
    sources = await listTenderSourceOptions(context.admin);
    const hasPaidAccess = await hasActiveTenderPlan(context.admin, context.organizationId);
    result = await searchTenders(context.admin, input, {
      organizationId: context.organizationId,
      isOps: context.isOps,
      hasPaidAccess
    });
  }

  return (
    <AppShell>
      <PageHeader title="Tender Search" body="Search published tenders by keyword, geography, contractor sector, value, bid security, PEC requirement, source, and bid-readiness fit." />
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card>
          <form className="grid gap-4" method="get">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter className="h-4 w-4" />
              Filters
            </div>
            {validationMessage ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{validationMessage}</p> : null}
            <Field label="Keyword">
              <Input name="q" defaultValue={input.q ?? ""} placeholder="Roads, HVAC, WASA" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Province">
                <Select name="province" defaultValue={input.province ?? ""}>
                  <option value="">All provinces</option>
                  {pakistanProvinces.map((province) => <option key={province} value={province}>{province}</option>)}
                </Select>
              </Field>
              <Field label="City">
                <Input name="city" defaultValue={input.city ?? ""} />
              </Field>
            </div>
            <Field label="Sector">
              <Select name="sector" defaultValue={input.sector ?? ""}>
                <option value="">All sectors</option>
                {contractorSectors.map((sector) => <option key={sector} value={sector}>{sector.replaceAll("_", " ")}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select name="source" defaultValue={input.source ?? ""}>
                <option value="">All sources</option>
                {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </Select>
            </Field>
            <Field label="Department">
              <Input name="department" defaultValue={input.department ?? ""} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Closing after">
                <Input name="closing_date_after" type="date" defaultValue={input.closing_date_after ?? ""} />
              </Field>
              <Field label="Closing before">
                <Input name="closing_date_before" type="date" defaultValue={input.closing_date_before ?? ""} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Estimated value min">
                <Input name="estimated_value_min" type="number" min="0" defaultValue={input.estimated_value_min ?? ""} />
              </Field>
              <Field label="Estimated value max">
                <Input name="estimated_value_max" type="number" min="0" defaultValue={input.estimated_value_max ?? ""} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Bid security min">
                <Input name="bid_security_min" type="number" min="0" defaultValue={input.bid_security_min ?? ""} />
              </Field>
              <Field label="Bid security max">
                <Input name="bid_security_max" type="number" min="0" defaultValue={input.bid_security_max ?? ""} />
              </Field>
            </div>
            <Field label="PEC category">
              <Select name="pec_category" defaultValue={input.pec_category ?? ""}>
                <option value="">Any PEC category</option>
                {pecCategories.filter((category) => category !== "unknown").map((category) => <option key={category} value={category}>{category}</option>)}
              </Select>
            </Field>
            {context?.isOps ? (
              <Field label="Tender status">
                <Select name="tender_status" defaultValue={input.tender_status}>
                  <option value="published">Published</option>
                  <option value="under_review">Under review</option>
                  <option value="draft">Draft</option>
                  <option value="corrigendum">Corrigendum</option>
                  <option value="closed">Closed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </Field>
            ) : null}
            <Field label="Sort">
              <Select name="sort" defaultValue={input.sort}>
                {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Results per page">
              <Select name="limit" defaultValue={String(input.limit)}>
                {[10, 25, 50].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input className="h-4 w-4 rounded border-border" name="eligible_only" type="checkbox" defaultChecked={input.eligible_only} disabled={!context} />
              Eligible only
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">
                <Search className="h-4 w-4" />
                Search
              </Button>
              <a className="inline-flex h-10 items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/70 hover:text-foreground" href="/search">Reset</a>
            </div>
          </form>
        </Card>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{result.pagination.total} tenders found</p>
              <p className="text-sm text-muted-foreground">Page {result.pagination.totalPages === 0 ? 0 : result.pagination.page} of {result.pagination.totalPages}</p>
            </div>
            <Badge tone={result.meta.planAccess === "free" ? "warn" : "good"}>{result.meta.planAccess}</Badge>
          </div>

          {activeFilters.length ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {activeFilters.map((filter) => (
                <a key={filter.key} className="inline-flex items-center gap-2 rounded-md border border-white/70 bg-white/72 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition hover:bg-white hover:text-foreground" href={removeFilterHref("/search", params, filter.key)}>
                  {filter.label}: {filter.value}
                  <X className="h-3.5 w-3.5" />
                </a>
              ))}
              <a className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-white/70" href="/search">Clear all</a>
            </div>
          ) : null}

          <div className="grid gap-4">
            {context ? null : (
              <Card>
                <h2 className="font-semibold">Sign in to search contractor recommendations.</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Public previews remain available on the tender preview page.</p>
                <LinkButton className="mt-4" href="/login">Sign in</LinkButton>
              </Card>
            )}
            {result.data.length === 0 && context ? (
              <EmptyState
                body="Try widening the date, value, PEC, or geography filters."
                icon={<FileSearch className="h-7 w-7" />}
                title="No tenders match these filters"
              />
            ) : null}
            <MotionList className="grid gap-4">
              {result.data.map((tender) => (
                <MotionItem key={String(tender.id)}>
                  <TenderResultCard tender={tender} fullAccess={result.meta.planAccess !== "free"} />
                </MotionItem>
              ))}
            </MotionList>
          </div>

          {result.pagination.totalPages > 1 ? (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              {result.pagination.page > 1 ? <LinkButton href={pageHref("/search", params, result.pagination.page - 1)}>Previous</LinkButton> : null}
              {result.pagination.page < result.pagination.totalPages ? <LinkButton href={pageHref("/search", params, result.pagination.page + 1)}>Next</LinkButton> : null}
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function TenderResultCard({ tender, fullAccess }: { tender: Record<string, unknown>; fullAccess: boolean }): JSX.Element {
  const source = tender.source as { name?: string | null } | null | undefined;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone={tender.status === "published" ? "good" : "warn"}>{String(tender.status ?? "unknown")}</Badge>
            {tender.sector ? <Badge>{String(tender.sector).replaceAll("_", " ")}</Badge> : null}
          </div>
          <h2 className="font-semibold">{String(tender.title ?? "Untitled tender")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{String(tender.department ?? "Department needs review")} · {String(tender.city ?? tender.province ?? "Pakistan")}</p>
          {source?.name ? <p className="mt-1 text-xs text-muted-foreground">{source.name}</p> : null}
        </div>
        <div className="grid gap-2 justify-items-end">
          {typeof tender.recommendation_score === "number" ? <ScoreRing label="RECON score" value={tender.recommendation_score} /> : null}
          <p className="text-sm font-medium">Closing: {formatDate(tender.closing_date as string | null | undefined)}</p>
        </div>
      </div>
      {typeof tender.preview === "string" && tender.preview ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{tender.preview}</p> : null}
      {fullAccess ? (
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div><dt className="text-muted-foreground">Estimated value</dt><dd className="font-medium">{formatCurrency(tender.estimated_value as string | number | null | undefined)}</dd></div>
          <div><dt className="text-muted-foreground">Bid security</dt><dd className="font-medium">{formatCurrency(tender.bid_security_amount as string | number | null | undefined)}</dd></div>
          <div><dt className="text-muted-foreground">Tender number</dt><dd className="font-medium">{String(tender.tender_number ?? "Needs review")}</dd></div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Value, bid security, source URL, and documents are available on paid plans after verification.</p>
      )}
      <LinkButton className="mt-4" href={`/tenders/${String(tender.id)}`}>Open tender</LinkButton>
    </Card>
  );
}

function pageHref(path: string, params: Record<string, string | undefined>, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  search.set("page", String(page));
  return `${path}?${search.toString()}`;
}

function buildActiveFilters(params: Record<string, string | undefined>): Array<{ key: string; label: string; value: string }> {
  const labels: Record<string, string> = {
    q: "Keyword",
    province: "Province",
    city: "City",
    sector: "Sector",
    source: "Source",
    department: "Department",
    closing_date_after: "Closing after",
    closing_date_before: "Closing before",
    estimated_value_min: "Value min",
    estimated_value_max: "Value max",
    bid_security_min: "Bid security min",
    bid_security_max: "Bid security max",
    pec_category: "PEC",
    tender_status: "Status",
    eligible_only: "Eligible",
    sort: "Sort"
  };
  return Object.entries(params)
    .filter(([key, value]) => Boolean(value) && key !== "page" && key !== "limit")
    .map(([key, value]) => ({ key, label: labels[key] ?? key, value: value ?? "" }));
}

function removeFilterHref(path: string, params: Record<string, string | undefined>, keyToRemove: string): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === keyToRemove || key === "page" || !value) continue;
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
