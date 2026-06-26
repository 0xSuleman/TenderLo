import type { DatabaseClient } from "@tenderlo/db";
import { pakistanProvinces, stripUndefined, tenderCategories, type TenderSearchInput } from "@tenderlo/shared";

export type TenderPlanAccess = "free" | "paid" | "ops";

export interface TenderSearchAccess {
  organizationId?: string | undefined;
  isOps: boolean;
  hasPaidAccess: boolean;
}

export interface TenderSearchResult {
  data: Array<Record<string, unknown>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta: {
    planAccess: TenderPlanAccess;
    appliedFilters: Record<string, unknown>;
  };
}

export interface TenderSourceOption {
  id: string;
  name: string;
  source_type: string;
}

export interface TenderFilterOptions {
  categories: readonly string[];
  cities: string[];
  provinces: readonly string[];
  organizations: string[];
  sources: TenderSourceOption[];
}

type RecommendationRow = {
  tender_id: string;
  score: number;
  status: string;
};

const TENDER_SELECT = [
  "id",
  "title",
  "source_url",
  "tender_number",
  "department",
  "procurement_category",
  "sector",
  "province",
  "city",
  "description",
  "advertisement_date",
  "closing_date",
  "opening_date",
  "bid_security_amount",
  "estimated_value",
  "document_fee",
  "status",
  "extraction_confidence",
  "is_human_verified",
  "created_at",
  "updated_at",
  "tender_sources(name, source_type)"
].join(",");

const RECOMMENDATION_SORT_WINDOW = 1000;
const PUBLIC_TENDER_STATUSES = ["published", "closed", "cancelled", "corrigendum"];
const ACTIVE_TENDER_STATUSES = ["published", "corrigendum"];

export async function hasActiveTenderPlan(admin: DatabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["trialing", "active", "manual_invoice"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function listTenderSourceOptions(admin: DatabaseClient): Promise<TenderSourceOption[]> {
  const { data, error } = await admin.from("tender_sources").select("id,name,source_type").order("name");
  if (error) throw error;
  return (data ?? []) as TenderSourceOption[];
}

export async function listTenderFilterOptions(admin: DatabaseClient): Promise<TenderFilterOptions> {
  const sources = await listTenderSourceOptions(admin);
  const today = startOfTodayIso();
  const { data, error } = await admin
    .from("tenders")
    .select("city,department,procurement_category")
    .in("status", ACTIVE_TENDER_STATUSES)
    .or(`closing_date.is.null,closing_date.gte.${today}`)
    .order("city", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ city: string | null; department: string | null; procurement_category: string | null }>;
  return {
    categories: tenderCategories,
    cities: uniqueSorted(rows.map((row) => row.city)),
    provinces: pakistanProvinces,
    organizations: uniqueSorted(rows.map((row) => row.department)),
    sources
  };
}

export async function searchTenders(admin: DatabaseClient, input: TenderSearchInput, access: TenderSearchAccess): Promise<TenderSearchResult> {
  const planAccess = resolvePlanAccess(access);
  const appliedFilters = buildAppliedFilters(input, access);
  const recommendationRows = await loadRelevantRecommendations(admin, input, access.organizationId);
  const recommendationMap = new Map(recommendationRows.map((row) => [row.tender_id, row]));
  const constrainedTenderIds = await resolveConstrainedTenderIds(admin, input, access.organizationId, recommendationRows);

  if (constrainedTenderIds?.length === 0) {
    return emptyResult(input, planAccess, appliedFilters);
  }

  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  const usesManualRecommendationSort = input.sort === "recommendation_score" && Boolean(access.organizationId);
  let query = buildTenderQuery(admin, input, access, constrainedTenderIds);

  if (usesManualRecommendationSort) {
    query = applySqlSort(query, "closing_soon");
    const { data, error, count } = await query.range(0, RECOMMENDATION_SORT_WINDOW - 1);
    if (error) throw error;
    const sorted = [...((data ?? []) as Array<Record<string, unknown>>)].sort((left, right) => {
      const scoreDelta = (recommendationMap.get(String(right.id))?.score ?? -1) - (recommendationMap.get(String(left.id))?.score ?? -1);
      if (scoreDelta !== 0) return scoreDelta;
      return compareNullableDates(String(left.closing_date ?? ""), String(right.closing_date ?? ""));
    });
    const pageRows = sorted.slice(from, to + 1);
    await mergePageRecommendations(admin, access.organizationId, pageRows, recommendationMap);
    return {
      data: pageRows.map((row) => serializeTender(row, recommendationMap.get(String(row.id)), planAccess)),
      pagination: buildPagination(input, count ?? sorted.length),
      meta: { planAccess, appliedFilters }
    };
  }

  query = applySqlSort(query, input.sort);
  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const pageRows = (data ?? []) as Array<Record<string, unknown>>;
  await mergePageRecommendations(admin, access.organizationId, pageRows, recommendationMap);
  return {
    data: pageRows.map((row) => serializeTender(row, recommendationMap.get(String(row.id)), planAccess)),
    pagination: buildPagination(input, count ?? pageRows.length),
    meta: { planAccess, appliedFilters }
  };
}

function resolvePlanAccess(access: TenderSearchAccess): TenderPlanAccess {
  if (access.isOps) return "ops";
  if (access.hasPaidAccess) return "paid";
  return "free";
}

async function loadRelevantRecommendations(
  admin: DatabaseClient,
  input: TenderSearchInput,
  organizationId?: string
): Promise<RecommendationRow[]> {
  if (!organizationId || (!input.eligible_only && input.sort !== "recommendation_score")) return [];
  const { data, error } = await admin
    .from("recommendations")
    .select("tender_id,score,status")
    .eq("organization_id", organizationId)
    .order("score", { ascending: false })
    .limit(RECOMMENDATION_SORT_WINDOW);
  if (error) throw error;
  return (data ?? []) as RecommendationRow[];
}

async function mergePageRecommendations(
  admin: DatabaseClient,
  organizationId: string | undefined,
  rows: Array<Record<string, unknown>>,
  recommendationMap: Map<string, RecommendationRow>
): Promise<void> {
  if (!organizationId || rows.length === 0) return;
  const missingTenderIds = rows.map((row) => String(row.id)).filter((id) => !recommendationMap.has(id));
  if (missingTenderIds.length === 0) return;
  const { data, error } = await admin
    .from("recommendations")
    .select("tender_id,score,status")
    .eq("organization_id", organizationId)
    .in("tender_id", missingTenderIds);
  if (error) throw error;
  for (const row of (data ?? []) as RecommendationRow[]) recommendationMap.set(row.tender_id, row);
}

async function resolveConstrainedTenderIds(
  admin: DatabaseClient,
  input: TenderSearchInput,
  organizationId: string | undefined,
  recommendationRows: RecommendationRow[]
): Promise<string[] | null> {
  let constrainedTenderIds: string[] | null = null;
  if (input.pec_category) {
    constrainedTenderIds = intersectIds(constrainedTenderIds, await loadTenderIdsByPecCategory(admin, input.pec_category));
  }
  if (input.eligible_only) {
    if (!organizationId) return [];
    const eligibleTenderIds = recommendationRows
      .filter((row) => row.status === "recommended" || row.status === "warning")
      .map((row) => row.tender_id);
    constrainedTenderIds = intersectIds(constrainedTenderIds, eligibleTenderIds);
  }
  return constrainedTenderIds;
}

async function loadTenderIdsByPecCategory(admin: DatabaseClient, pecCategory: string): Promise<string[]> {
  const { data, error } = await admin
    .from("extracted_fields")
    .select("tender_id")
    .eq("field_name", "pec_category")
    .eq("field_value", pecCategory)
    .neq("verification_status", "rejected")
    .limit(RECOMMENDATION_SORT_WINDOW);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ tender_id: string }>;
  return [...new Set(rows.map((row) => row.tender_id))];
}

function buildTenderQuery(admin: DatabaseClient, input: TenderSearchInput, access: TenderSearchAccess, constrainedTenderIds: string[] | null): any {
  let query: any = admin.from("tenders").select(TENDER_SELECT, { count: "exact" });
  query = applyAvailabilityFilter(query, input, access);
  if (input.q) query = query.textSearch("search_document", input.q, { type: "websearch" });
  if (input.category) query = query.eq("procurement_category", input.category);
  if (input.province) query = query.eq("province", input.province);
  if (input.city) query = query.eq("city", input.city);
  if (input.sector) query = query.eq("sector", input.sector);
  if (input.source) query = query.eq("source_id", input.source);
  if (input.department) query = query.ilike("department", `%${input.department}%`);
  query = applyClosingDateFilter(query, input);
  if (input.closing_date_after) query = query.gte("closing_date", input.closing_date_after);
  if (input.closing_date_before) query = query.lte("closing_date", input.closing_date_before);
  if (input.bid_security_min !== undefined) query = query.gte("bid_security_amount", input.bid_security_min);
  if (input.bid_security_max !== undefined) query = query.lte("bid_security_amount", input.bid_security_max);
  query = applyEstimatedCostFilter(query, input);
  if (input.estimated_value_min !== undefined) query = query.gte("estimated_value", input.estimated_value_min);
  if (input.estimated_value_max !== undefined) query = query.lte("estimated_value", input.estimated_value_max);
  if (constrainedTenderIds) query = query.in("id", constrainedTenderIds);
  return query;
}

function applyAvailabilityFilter(query: any, input: TenderSearchInput, access: TenderSearchAccess): any {
  if (access.isOps && input.availability === "all") return query;
  const visibleStatuses = access.isOps ? undefined : PUBLIC_TENDER_STATUSES;
  if (visibleStatuses) query = query.in("status", visibleStatuses);
  const today = startOfTodayIso();

  if (input.availability === "all") return query;
  if (input.availability === "non_active") {
    return query.or(`status.in.(closed,cancelled),closing_date.lt.${today}`);
  }
  return query.in("status", ACTIVE_TENDER_STATUSES).or(`closing_date.is.null,closing_date.gte.${today}`);
}

function applyClosingDateFilter(query: any, input: TenderSearchInput): any {
  const today = startOfToday();
  if (input.closing_date_filter === "today") return query.gte("closing_date", today.toISOString()).lt("closing_date", addDays(today, 1).toISOString());
  if (input.closing_date_filter === "tomorrow") return query.gte("closing_date", addDays(today, 1).toISOString()).lt("closing_date", addDays(today, 2).toISOString());
  if (input.closing_date_filter === "next_3_days") return query.gte("closing_date", today.toISOString()).lt("closing_date", addDays(today, 3).toISOString());
  if (input.closing_date_filter === "next_1_week") return query.gte("closing_date", today.toISOString()).lt("closing_date", addDays(today, 7).toISOString());
  if (input.closing_date_filter === "next_1_month") return query.gte("closing_date", today.toISOString()).lt("closing_date", addDays(today, 31).toISOString());
  return query;
}

function applyEstimatedCostFilter(query: any, input: TenderSearchInput): any {
  if (input.estimated_cost_filter === "not_available") return query.is("estimated_value", null);
  if (input.estimated_cost_filter === "under_10_lac") return query.lt("estimated_value", 1_000_000);
  if (input.estimated_cost_filter === "10_lac_50_lac") return query.gte("estimated_value", 1_000_000).lt("estimated_value", 5_000_000);
  if (input.estimated_cost_filter === "50_lac_1_crore") return query.gte("estimated_value", 5_000_000).lt("estimated_value", 10_000_000);
  if (input.estimated_cost_filter === "1_crore_plus") return query.gte("estimated_value", 10_000_000);
  return query;
}

function applySqlSort(query: any, sort: TenderSearchInput["sort"]): any {
  if (sort === "newest") return query.order("created_at", { ascending: false });
  if (sort === "estimated_value_asc") return query.order("estimated_value", { ascending: true, nullsFirst: false });
  if (sort === "estimated_value_desc") return query.order("estimated_value", { ascending: false, nullsFirst: false });
  if (sort === "bid_security_asc") return query.order("bid_security_amount", { ascending: true, nullsFirst: false });
  if (sort === "bid_security_desc") return query.order("bid_security_amount", { ascending: false, nullsFirst: false });
  if (sort === "relevance") return query.order("created_at", { ascending: false });
  return query.order("closing_date", { ascending: true, nullsFirst: false });
}

function serializeTender(row: Record<string, unknown>, recommendation: RecommendationRow | undefined, planAccess: TenderPlanAccess): Record<string, unknown> {
  const source = extractSource(row.tender_sources);
  const fullAccess = planAccess === "paid" || planAccess === "ops";
  if (!fullAccess) {
    return stripUndefined({
      id: row.id,
      title: row.title,
      department: row.department,
      province: row.province,
      city: row.city,
      category: row.procurement_category,
      sector: row.sector,
      active_status: formatActiveStatus(row.status, row.closing_date),
      closing_date: row.closing_date,
      status: row.status,
      source,
      preview: typeof row.description === "string" ? row.description.slice(0, 220) : undefined
    });
  }
  return stripUndefined({
    id: row.id,
    title: row.title,
    source_url: row.source_url,
    tender_number: row.tender_number,
    department: row.department,
    category: row.procurement_category,
    procurement_category: row.procurement_category,
    sector: row.sector,
    tender_type: row.procurement_category,
    province: row.province,
    city: row.city,
    description: row.description,
    advertisement_date: row.advertisement_date,
    closing_date: row.closing_date,
    opening_date: row.opening_date,
    bid_security_amount: row.bid_security_amount,
    estimated_value: row.estimated_value,
    estimated_cost: formatEstimatedCost(row.estimated_value),
    document_fee: row.document_fee,
    active_status: formatActiveStatus(row.status, row.closing_date),
    status: row.status,
    extraction_confidence: row.extraction_confidence,
    is_human_verified: row.is_human_verified,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source,
    recommendation_score: recommendation?.score,
    recommendation_status: recommendation?.status
  });
}

function extractSource(value: unknown): { name: string | null; source_type: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : null,
    source_type: typeof record.source_type === "string" ? record.source_type : null
  };
}

function intersectIds(current: string[] | null, next: string[]): string[] {
  const uniqueNext = [...new Set(next)];
  if (current === null) return uniqueNext;
  const nextSet = new Set(uniqueNext);
  return current.filter((id) => nextSet.has(id));
}

function buildPagination(input: TenderSearchInput, total: number): TenderSearchResult["pagination"] {
  return {
    page: input.page,
    limit: input.limit,
    total,
    totalPages: Math.ceil(total / input.limit)
  };
}

function buildAppliedFilters(input: TenderSearchInput, access: TenderSearchAccess): Record<string, unknown> {
  return stripUndefined({
    q: input.q,
    availability: input.availability,
    closing_date_filter: input.closing_date_filter === "any" ? undefined : input.closing_date_filter,
    estimated_cost_filter: input.estimated_cost_filter === "any" ? undefined : input.estimated_cost_filter,
    category: input.category,
    province: input.province,
    city: input.city,
    sector: input.sector,
    source: input.source,
    organization: input.department,
    department: input.department,
    closing_date_after: input.closing_date_after,
    closing_date_before: input.closing_date_before,
    bid_security_min: input.bid_security_min,
    bid_security_max: input.bid_security_max,
    estimated_value_min: input.estimated_value_min,
    estimated_value_max: input.estimated_value_max,
    tender_status: access.isOps ? input.tender_status : "published",
    pec_category: input.pec_category,
    eligible_only: input.eligible_only ? true : undefined,
    sort: input.sort,
    page: input.page,
    limit: input.limit
  });
}

function formatActiveStatus(status: unknown, closingDate: unknown): "Active" | "Expired / Non-Active" {
  const statusValue = String(status ?? "");
  const closingTime = typeof closingDate === "string" ? Date.parse(closingDate) : NaN;
  if (ACTIVE_TENDER_STATUSES.includes(statusValue) && (Number.isNaN(closingTime) || closingTime >= startOfToday().getTime())) return "Active";
  return "Expired / Non-Active";
}

function formatEstimatedCost(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Cost Not Available";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Cost Not Available";
  return `Rs. ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(amount)}`;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfTodayIso(): string {
  return startOfToday().toISOString();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

function emptyResult(input: TenderSearchInput, planAccess: TenderPlanAccess, appliedFilters: Record<string, unknown>): TenderSearchResult {
  return {
    data: [],
    pagination: buildPagination(input, 0),
    meta: { planAccess, appliedFilters }
  };
}

function compareNullableDates(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}
