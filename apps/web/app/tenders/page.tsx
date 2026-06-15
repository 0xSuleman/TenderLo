import { FileSearch, Search } from "lucide-react";
import { contractorSectors, pakistanProvinces, tenderSearchSchema } from "@tenderlo/shared";
import { MarketingNav } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { listTenderSourceOptions, searchTenders, type TenderSearchResult, type TenderSourceOption } from "@/lib/tender-search";

export const dynamic = "force-dynamic";

const publicSortOptions = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["closing_soon", "Closing soon"]
] as const;

export default async function PublicTenderPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<JSX.Element> {
  const params = await searchParams;
  const parsed = tenderSearchSchema.safeParse(params);
  const input = parsed.success ? parsed.data : tenderSearchSchema.parse({});
  const admin = createSupabaseAdminClient();
  let result: TenderSearchResult = {
    data: [],
    pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0 },
    meta: { planAccess: "free", appliedFilters: {} }
  };
  let sources: TenderSourceOption[] = [];

  try {
    sources = await listTenderSourceOptions(admin);
    result = await searchTenders(admin, input, { isOps: false, hasPaidAccess: false });
  } catch {
    result = {
      data: [],
      pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0 },
      meta: { planAccess: "free", appliedFilters: {} }
    };
  }

  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <PageHeader title="Public Tender Preview" body="Limited previews from published TenderLo records." />
        <Card className="mb-6">
          <form className="grid gap-3 lg:grid-cols-[1.4fr_180px_180px_180px_auto]" method="get">
            <Field label="Keyword">
              <Input name="q" defaultValue={input.q ?? ""} placeholder="Roads, HVAC, WASA" />
            </Field>
            <Field label="Province">
              <Select name="province" defaultValue={input.province ?? ""}>
                <option value="">All provinces</option>
                {pakistanProvinces.map((province) => <option key={province} value={province}>{province}</option>)}
              </Select>
            </Field>
            <Field label="Sector">
              <Select name="sector" defaultValue={input.sector ?? ""}>
                <option value="">All sectors</option>
                {contractorSectors.map((sector) => <option key={sector} value={sector}>{sector.replaceAll("_", " ")}</option>)}
              </Select>
            </Field>
            <Field label="Sort">
              <Select name="sort" defaultValue={input.sort}>
                {publicSortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Button className="mt-7" type="submit">
              <Search className="h-4 w-4" />
              Search
            </Button>
            <div className="grid gap-3 lg:col-span-5 lg:grid-cols-[180px_180px_180px_180px_1fr]">
              <Field label="City">
                <Input name="city" defaultValue={input.city ?? ""} />
              </Field>
              <Field label="Department">
                <Input name="department" defaultValue={input.department ?? ""} />
              </Field>
              <Field label="Closing after">
                <Input name="closing_date_after" type="date" defaultValue={input.closing_date_after ?? ""} />
              </Field>
              <Field label="Closing before">
                <Input name="closing_date_before" type="date" defaultValue={input.closing_date_before ?? ""} />
              </Field>
              <Field label="Source">
                <Select name="source" defaultValue={input.source ?? ""}>
                  <option value="">All sources</option>
                  {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                </Select>
              </Field>
            </div>
          </form>
        </Card>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">{result.pagination.total} published tenders found</p>
          <LinkButton href="/signup">Unlock full details</LinkButton>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {result.data.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyState
                body="Published tenders will appear here after source ingestion or ops review publishes records."
                icon={<FileSearch className="h-7 w-7" />}
                title="No public tender previews match these filters"
              />
            </div>
          ) : null}
          <MotionList className="contents">
            {result.data.map((tender) => (
              <MotionItem key={String(tender.id)}>
                <Card>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge tone="good">{String(tender.status ?? "published")}</Badge>
                    {tender.sector ? <Badge>{String(tender.sector).replaceAll("_", " ")}</Badge> : null}
                  </div>
                  <h2 className="font-semibold">{String(tender.title ?? "Untitled tender")}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{String(tender.department ?? "Department needs review")} · {String(tender.city ?? tender.province ?? "Pakistan")}</p>
                  <p className="mt-2 text-sm">Closing: {formatDate(tender.closing_date as string | null | undefined)}</p>
                  {typeof tender.preview === "string" && tender.preview ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{tender.preview}</p> : null}
                  <LinkButton className="mt-4" href={`/tenders/${String(tender.id)}`}>Open preview</LinkButton>
                </Card>
              </MotionItem>
            ))}
          </MotionList>
        </div>

        {result.pagination.totalPages > 1 ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {result.pagination.page > 1 ? <LinkButton href={pageHref("/tenders", params, result.pagination.page - 1)}>Previous</LinkButton> : null}
            {result.pagination.page < result.pagination.totalPages ? <LinkButton href={pageHref("/tenders", params, result.pagination.page + 1)}>Next</LinkButton> : null}
          </div>
        ) : null}
      </main>
    </>
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
