import { z } from "zod";

export * from "./config";
export * from "./errors";
export * from "./logger";

export const userRoles = ["owner", "admin", "member", "viewer", "ops_admin"] as const;
export const membershipStatuses = ["active", "invited", "suspended"] as const;
export const plans = ["starter", "growth", "pro", "enterprise"] as const;
export const subscriptionStatuses = ["trialing", "active", "past_due", "cancelled", "manual_invoice"] as const;
export const pecCategories = ["C-A", "C-B", "C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "unknown"] as const;
export const verificationStatuses = ["unverified", "verified", "expired", "rejected", "needs_review"] as const;
export const tenderStatuses = ["draft", "published", "closed", "cancelled", "corrigendum", "under_review"] as const;
export const sourceTypes = ["federal", "provincial", "department", "newspaper", "manual"] as const;
export const sourceStatuses = ["active", "disabled", "failing"] as const;
export const ingestionStatuses = ["running", "succeeded", "failed", "partial"] as const;
export const parserStatuses = ["pending", "parsed", "ocr_required", "failed"] as const;
export const ocrStatuses = ["not_needed", "pending", "completed", "failed"] as const;
export const extractionMethods = ["pdf_text", "docx_text", "html_selector", "html_generic", "ocr", "manual"] as const;
export const sourceMethods = ["html_selector", "regex", "keyword_window", "table_rule", "ocr", "manual"] as const;
export const qaTaskTypes = [
  "low_confidence_field",
  "duplicate_review",
  "source_failure",
  "parser_failure",
  "manual_verification"
] as const;
export const qaStatuses = ["open", "in_progress", "resolved", "dismissed"] as const;
export const priorities = ["low", "medium", "high", "urgent"] as const;
export const notificationChannels = ["email", "in_app", "whatsapp"] as const;
export const notificationFrequencies = ["immediate", "daily", "weekly"] as const;
export const notificationStatuses = ["pending", "sent", "failed", "read"] as const;
export const complianceStatuses = ["eligible", "eligible_with_warnings", "not_eligible", "unknown"] as const;
export const recommendationStatuses = ["recommended", "warning", "blocked", "dismissed"] as const;
export const duplicateStatuses = ["pending", "merged", "rejected"] as const;
export const engineerTypes = ["PE", "RE", "trainee", "unknown"] as const;
export const equipmentOwnershipTypes = ["owned", "leased", "rented", "unknown"] as const;
export const invoiceStatuses = ["draft", "sent", "paid", "void", "overdue"] as const;

export const contractorSectors = [
  "construction",
  "roads",
  "highways",
  "bridges",
  "buildings",
  "MEP",
  "electrical",
  "power",
  "mechanical",
  "HVAC",
  "plumbing",
  "fire_safety",
  "water",
  "sewerage",
  "sanitation",
  "telecom_infrastructure",
  "IT_infrastructure",
  "oil_and_gas_works",
  "industrial_maintenance",
  "general_contracting",
  "uncategorized"
] as const;

export const tenderCategories = [
  "Accommodation & Hospitality",
  "Advertising & Marketing",
  "Agricultural Supplies",
  "Asset Disposal & Auction",
  "Audio Visual & Broadcasting",
  "Audit & Verification",
  "Building Maintenance",
  "Catering & Food Services",
  "Chemicals & Industrial Materials",
  "Cleaning & Janitorial",
  "Construction & Civil Works",
  "Consultancy Services",
  "Cultural & Religious",
  "Defence & Military Supplies",
  "Educational Supplies",
  "Electrical Works & Equipment",
  "Event Management",
  "Facility Management",
  "Financial & Insurance Services",
  "Furniture & Furnishings",
  "Hardware & Tools",
  "Human Resources & Recruitment",
  "HVAC & Refrigeration",
  "Industrial Equipment",
  "IT & Computer Equipment",
  "IT Services & Support",
  "Laboratory Equipment & Services",
  "Landscaping & Horticulture",
  "Legal & Judicial Services",
  "Marine & Vessel Services",
  "Mechanical Works & Equipment",
  "Medical & Surgical Supplies",
  "Medical Equipment",
  "Metals & Scrap",
  "Mining & Quarrying",
  "Miscellaneous",
  "Office Equipment & Supplies",
  "Pharmaceuticals",
  "Plant & Machinery",
  "Plastics & Packaging",
  "Real Estate & Property",
  "Road & Infrastructure Works",
  "Scientific Instruments",
  "Security & Safety Equipment",
  "Solar & Power Equipment",
  "Sports & Recreation",
  "Stationery & Printing",
  "Telecommunication",
  "Training & Education Services",
  "Transportation & Logistics",
  "Uniforms & Textiles",
  "Vehicle Maintenance",
  "Vehicles & Auto Parts",
  "Waste Management & Environment",
  "Water Supply & Sanitation"
] as const;

export const pakistanProvinces = [
  "Azad Jammu & Kashmir (AJK)",
  "Balochistan",
  "Gilgit-Baltistan",
  "Islamabad Capital Territory",
  "Khyber Pakhtunkhwa",
  "Punjab",
  "Sindh"
] as const;

export const tenderAvailabilityFilters = ["active", "non_active", "all"] as const;
export const closingDateFilters = ["any", "today", "tomorrow", "next_3_days", "next_1_week", "next_1_month"] as const;
export const estimatedCostFilters = ["any", "not_available", "under_10_lac", "10_lac_50_lac", "50_lac_1_crore", "1_crore_plus"] as const;

export const majorPakistanCities = [
  "Karachi",
  "Lahore",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Quetta",
  "Hyderabad",
  "Sukkur",
  "Gujranwala",
  "Sialkot",
  "Bahawalpur",
  "Sargodha",
  "Abbottabad",
  "Mardan",
  "Dera Ghazi Khan",
  "Larkana",
  "Gwadar",
  "Muzaffarabad",
  "Gilgit"
] as const;

export type UserRole = (typeof userRoles)[number];
export type MembershipStatus = (typeof membershipStatuses)[number];
export type Plan = (typeof plans)[number];
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];
export type PecCategory = (typeof pecCategories)[number];
export type VerificationStatus = (typeof verificationStatuses)[number];
export type TenderStatus = (typeof tenderStatuses)[number];
export type SourceType = (typeof sourceTypes)[number];
export type SourceStatus = (typeof sourceStatuses)[number];
export type IngestionStatus = (typeof ingestionStatuses)[number];
export type ParserStatus = (typeof parserStatuses)[number];
export type OcrStatus = (typeof ocrStatuses)[number];
export type ExtractionMethod = (typeof extractionMethods)[number];
export type SourceMethod = (typeof sourceMethods)[number];
export type QaTaskType = (typeof qaTaskTypes)[number];
export type QaStatus = (typeof qaStatuses)[number];
export type Priority = (typeof priorities)[number];
export type NotificationChannel = (typeof notificationChannels)[number];
export type NotificationFrequency = (typeof notificationFrequencies)[number];
export type NotificationStatus = (typeof notificationStatuses)[number];
export type ComplianceStatus = (typeof complianceStatuses)[number];
export type RecommendationStatus = (typeof recommendationStatuses)[number];
export type ContractorSector = (typeof contractorSectors)[number];
export type TenderCategory = (typeof tenderCategories)[number];
export type TenderAvailabilityFilter = (typeof tenderAvailabilityFilters)[number];
export type ClosingDateFilter = (typeof closingDateFilters)[number];
export type EstimatedCostFilter = (typeof estimatedCostFilters)[number];
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email().max(320);
export const nonEmptyString = z.string().trim().min(1);
export const optionalDateSchema = z.string().date().nullable().optional();

export const organizationInputSchema = z.object({
  name: nonEmptyString.max(160),
  legal_name: z.string().trim().max(220).optional().nullable(),
  primary_contact_name: z.string().trim().max(160).optional().nullable(),
  primary_contact_email: emailSchema.optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  province: z.string().trim().max(120).optional().nullable()
});

export const onboardingSchema = organizationInputSchema.extend({
  full_name: nonEmptyString.max(160),
  phone: z.string().trim().max(80).optional().nullable()
});

export const invitationCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "member", "viewer"])
});

export const companyProfileSchema = z.object({
  business_type: z.string().trim().max(120).nullable().optional(),
  ntn: z.string().trim().max(80).nullable().optional(),
  strn: z.string().trim().max(80).nullable().optional(),
  website: z.string().url().nullable().optional().or(z.literal("")),
  operating_regions: z.array(z.string().trim().min(1)).default([]),
  sectors: z.array(z.enum(contractorSectors)).default([])
});

export const pecLicenseSchema = z.object({
  license_number: nonEmptyString.max(120),
  category: z.enum(pecCategories),
  specialization_codes: z.array(z.string().trim().min(1)).default([]),
  issue_date: z.string().date().nullable().optional(),
  expiry_date: z.string().date().nullable().optional(),
  verification_status: z.enum(verificationStatuses).default("unverified")
});

export const engineerSchema = z.object({
  full_name: nonEmptyString.max(160),
  pec_number: z.string().trim().max(120).nullable().optional(),
  engineer_type: z.enum(engineerTypes).default("unknown"),
  discipline: z.string().trim().max(120).nullable().optional(),
  verification_status: z.enum(verificationStatuses).default("unverified"),
  expiry_date: z.string().date().nullable().optional()
});

export const equipmentSchema = z.object({
  name: nonEmptyString.max(160),
  equipment_type: z.string().trim().max(120).nullable().optional(),
  capacity: z.string().trim().max(120).nullable().optional(),
  ownership_type: z.enum(equipmentOwnershipTypes).default("unknown"),
  location: z.string().trim().max(160).nullable().optional(),
  verification_status: z.enum(verificationStatuses).default("unverified")
});

export const savedSearchSchema = z.object({
  name: nonEmptyString.max(160),
  query: z.string().trim().max(240).default(""),
  filters: z.record(z.unknown()).default({})
});

export const notificationRuleSchema = z.object({
  saved_search_id: uuidSchema.nullable().optional(),
  channel: z.enum(notificationChannels),
  frequency: z.enum(notificationFrequencies),
  enabled: z.boolean().default(true)
});

const blankToUndefined = (value: unknown): unknown => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalSearchString = (maxLength: number) => z.preprocess(blankToUndefined, z.string().trim().max(maxLength).optional());
const optionalSearchDate = z.preprocess(blankToUndefined, z.string().date().optional());
const optionalSearchMoney = z.preprocess(blankToUndefined, z.coerce.number().nonnegative().optional());
const optionalSearchBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean().optional());

export const tenderSearchSorts = [
  "relevance",
  "newest",
  "closing_soon",
  "estimated_value_asc",
  "estimated_value_desc",
  "bid_security_asc",
  "bid_security_desc",
  "recommendation_score"
] as const;

export const tenderSearchSchema = z
  .object({
    q: optionalSearchString(240),
    availability: z.preprocess(blankToUndefined, z.enum(tenderAvailabilityFilters).optional()).default("active"),
    closing_date_filter: z.preprocess(blankToUndefined, z.enum(closingDateFilters).optional()).default("any"),
    estimated_cost_filter: z.preprocess(blankToUndefined, z.enum(estimatedCostFilters).optional()).default("any"),
    category: z.preprocess(blankToUndefined, z.enum(tenderCategories).optional()),
    province: optionalSearchString(120),
    city: optionalSearchString(120),
    sector: z.preprocess(blankToUndefined, z.enum(contractorSectors).optional()),
    source: z.preprocess(blankToUndefined, uuidSchema.optional()),
    source_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
    organization: optionalSearchString(160),
    department: optionalSearchString(160),
    closing_date_after: optionalSearchDate,
    closing_date_before: optionalSearchDate,
    deadline_from: optionalSearchDate,
    deadline_to: optionalSearchDate,
    bid_security_min: optionalSearchMoney,
    bid_security_max: optionalSearchMoney,
    estimated_value_min: optionalSearchMoney,
    estimated_value_max: optionalSearchMoney,
    tender_status: z.preprocess(blankToUndefined, z.enum(tenderStatuses).optional()),
    status: z.preprocess(blankToUndefined, z.enum(tenderStatuses).optional()),
    pec_category: z.preprocess(blankToUndefined, z.enum(pecCategories).optional()),
    eligible_only: optionalSearchBoolean,
    sort: z
      .preprocess(blankToUndefined, z.enum([...tenderSearchSorts, "closing_date", "estimated_value"]).optional())
      .default("closing_soon"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(50).optional()),
    page_size: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).optional())
  })
  .transform((input) => {
    const limit = Math.min(input.limit ?? input.page_size ?? 25, 50);
    const sort = input.sort === "closing_date" ? "closing_soon" : input.sort === "estimated_value" ? "estimated_value_desc" : input.sort;
    const closingDateAfter = input.closing_date_after ?? input.deadline_from;
    const closingDateBefore = input.closing_date_before ?? input.deadline_to;
    const tenderStatus = input.tender_status ?? input.status ?? "published";
    const source = input.source ?? input.source_id;
    return {
      q: input.q,
      availability: input.availability,
      closing_date_filter: input.closing_date_filter,
      estimated_cost_filter: input.estimated_cost_filter,
      category: input.category,
      province: input.province,
      city: input.city,
      sector: input.sector,
      source,
      source_id: source,
      organization: input.organization ?? input.department,
      department: input.department ?? input.organization,
      closing_date_after: closingDateAfter,
      closing_date_before: closingDateBefore,
      deadline_from: closingDateAfter,
      deadline_to: closingDateBefore,
      bid_security_min: input.bid_security_min,
      bid_security_max: input.bid_security_max,
      estimated_value_min: input.estimated_value_min,
      estimated_value_max: input.estimated_value_max,
      tender_status: tenderStatus,
      status: tenderStatus,
      pec_category: input.pec_category,
      eligible_only: input.eligible_only ?? false,
      sort,
      page: input.page,
      limit,
      page_size: limit
    };
  })
  .superRefine((input, context) => {
    if (input.closing_date_after && input.closing_date_before && input.closing_date_after > input.closing_date_before) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "closing_date_after must be on or before closing_date_before.", path: ["closing_date_after"] });
    }
    if (input.bid_security_min !== undefined && input.bid_security_max !== undefined && input.bid_security_min > input.bid_security_max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "bid_security_min must be less than or equal to bid_security_max.", path: ["bid_security_min"] });
    }
    if (input.estimated_value_min !== undefined && input.estimated_value_max !== undefined && input.estimated_value_min > input.estimated_value_max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "estimated_value_min must be less than or equal to estimated_value_max.", path: ["estimated_value_min"] });
    }
  });

export type TenderSearchInput = z.infer<typeof tenderSearchSchema>;

export const tenderManualSchema = z.object({
  title: nonEmptyString.max(500),
  source_url: z.string().url().nullable().optional(),
  tender_number: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().max(240).nullable().optional(),
  procurement_category: z.enum(tenderCategories).nullable().optional(),
  sector: z.enum(contractorSectors).nullable().optional(),
  province: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().nullable().optional(),
  advertisement_date: z.string().date().nullable().optional(),
  closing_date: z.string().datetime().nullable().optional().or(z.string().date().nullable().optional()),
  opening_date: z.string().datetime().nullable().optional().or(z.string().date().nullable().optional()),
  bid_security_amount: z.coerce.number().nonnegative().nullable().optional(),
  estimated_value: z.coerce.number().nonnegative().nullable().optional(),
  document_fee: z.coerce.number().nonnegative().nullable().optional(),
  status: z.enum(tenderStatuses).default("published")
});

export const sourceCreateSchema = z.object({
  name: nonEmptyString.max(220),
  base_url: z.string().url(),
  source_type: z.enum(sourceTypes),
  region: z.string().trim().max(120).nullable().optional(),
  adapter_key: nonEmptyString.max(160),
  scrape_frequency_minutes: z.coerce.number().int().min(15).max(10080).default(1440),
  status: z.enum(sourceStatuses).default("active")
});

export const billingCheckoutSchema = z.object({
  plan: z.enum(plans).exclude(["enterprise"])
});

export const partnerPreferenceSchema = z.object({
  sectors: z.array(z.enum(contractorSectors)).default([]),
  regions: z.array(z.string().trim().min(1)).default([]),
  min_pec_category: z.enum(pecCategories).default("unknown"),
  max_project_value: z.coerce.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

export const subcontractingOpportunitySchema = z.object({
  tender_id: uuidSchema.nullable().optional(),
  title: nonEmptyString.max(240),
  sector: z.enum(contractorSectors),
  region: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000),
  required_documents: z.array(z.string().trim().min(1)).default([]),
  status: z.enum(["open", "closed", "awarded"]).default("open")
});

export const bidPackageSchema = z.object({
  tender_id: uuidSchema,
  name: nonEmptyString.max(200)
});

export interface RawTenderDocument {
  url: string;
  filename?: string;
  mimeType?: string;
  contentHash?: string;
  sourceLabel?: string | undefined;
  originalSourceUrl?: string | undefined;
  websiteUrl?: string | undefined;
  sourceDocumentKey?: string | undefined;
}

export interface RawSourceSnapshotPayload {
  content: string;
  contentType: string;
  extension?: string;
}

export interface RawTenderPayload {
  sourceUrl: string;
  title: string;
  sourceGroup?: string | undefined;
  sourceLabel?: string | undefined;
  originalSourceUrl?: string | undefined;
  websiteUrl?: string | undefined;
  sourceMetadata?: Json | undefined;
  tenderNumber?: string;
  department?: string;
  procurementCategory?: string;
  province?: string;
  city?: string;
  description?: string;
  advertisementDate?: string;
  closingDate?: string;
  openingDate?: string;
  bidSecurityAmount?: number;
  estimatedValue?: number;
  documentFee?: number;
  procurementMethod?: string;
  submissionMethod?: string;
  contactPerson?: string;
  newspaperName?: string;
  publicationDate?: string;
  pageSection?: string;
  documents: RawTenderDocument[];
  raw: Json;
  rawSnapshot?: RawSourceSnapshotPayload;
}

export interface SourceAdapterContext {
  sourceId: string;
  sourceName: string;
  baseUrl: string;
  adapterKey: string;
  userAgent: string;
  metadata?: Json | undefined;
  parseDocument?: (input: ParseDocumentInput) => Promise<ParseDocumentResult>;
}

export interface SourceAdapter {
  key: string;
  name: string;
  sourceType: SourceType;
  respectsRobotsTxt: boolean;
  fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]>;
}

export interface ParsedDocumentPage {
  pageNumber: number;
  text: string;
  extractionMethod: ExtractionMethod;
  confidenceScore: number;
}

export interface ParseDocumentInput {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  sourceUrl?: string;
}

export interface ParseDocumentResult {
  parserStatus: "parsed" | "ocr_required" | "failed";
  ocrStatus: OcrStatus;
  pages: ParsedDocumentPage[];
  pageCount: number;
  errorMessage?: string;
}

export interface ExtractedFieldResult {
  fieldName: string;
  fieldValue: string;
  sourceMethod: SourceMethod;
  confidenceScore: number;
  evidenceText: string;
  verificationStatus: "unverified" | "needs_review";
}

export interface SectorMatch {
  sector: ContractorSector;
  score: number;
  matchedKeywords: string[];
  isPrimary: boolean;
}

export interface DuplicateCandidateResult {
  candidateTenderId: string;
  confidenceScore: number;
  reasons: string[];
  action: "merge" | "review" | "keep";
}

export interface CompanyProfileSnapshot {
  organizationId: string;
  sectors: ContractorSector[];
  operatingRegions: string[];
  pecCategory: PecCategory;
  specializationCodes: string[];
  documents: Array<{
    documentType: string;
    verificationStatus: VerificationStatus;
    expiryDate: string | null;
  }>;
  engineers: Array<{
    discipline: string | null;
    verificationStatus: VerificationStatus;
    expiryDate: string | null;
  }>;
  equipmentCount: number;
}

export interface TenderScoringInput {
  tenderId: string;
  title: string;
  sector: ContractorSector | null;
  province: string | null;
  city: string | null;
  closingDate: string | null;
  estimatedValue: number | null;
  extractedRequirements: Record<string, string | number | null>;
}

export interface RecommendationResult {
  score: number;
  status: RecommendationStatus;
  positiveReasons: string[];
  warnings: string[];
  blockers: string[];
  missingDocuments: string[];
  nextAction: string;
}

export interface ComplianceResult {
  status: ComplianceStatus;
  detectedRequirements: Record<string, string | number | null>;
  missingDocuments: string[];
  expiredDocuments: string[];
  warnings: string[];
  blockers: string[];
  unknowns: string[];
  profileSnapshot: CompanyProfileSnapshot;
}

export interface NotificationMessage {
  organizationId: string;
  userId: string | null;
  channel: NotificationChannel;
  type: string;
  title: string;
  body: string;
  relatedTenderId?: string | null;
  to?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationDeliveryResult {
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}

export interface BillingCheckoutRequest {
  organizationId: string;
  plan: Exclude<Plan, "enterprise">;
  userEmail: string;
}

export interface BillingCheckoutResponse {
  checkoutUrl: string;
  providerPaymentId: string;
}

export interface BillingWebhookResult {
  providerPaymentId: string;
  providerSubscriptionId?: string;
  status: "paid" | "failed" | "cancelled" | "pending";
  amount: number;
  currency: string;
  rawPayload: Record<string, string>;
}

export interface BillingProvider {
  createCheckout(input: BillingCheckoutRequest): Promise<BillingCheckoutResponse>;
  verifyWebhook(payload: Record<string, string>, remoteAddress?: string): Promise<BillingWebhookResult>;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeForSearch(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

export function slugify(value: string): string {
  return normalizeForSearch(value).replace(/\s+/g, "-").replace(/-+/g, "-");
}

export function tenderDetailPath(title: string, id: string): string {
  return `/tender/${slugify(title || "tender")}-${id}`;
}

export function parseTenderIdFromSlug(slug: string): string | null {
  const id = slug.slice(-36);
  return uuidSchema.safeParse(id).success ? id : null;
}

export function daysUntil(dateValue: string | Date | null | undefined, now = new Date()): number | null {
  if (!dateValue) return null;
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

export function isExpired(dateValue: string | Date | null | undefined, now = new Date()): boolean {
  const remaining = daysUntil(dateValue, now);
  return remaining !== null && remaining < 0;
}

export function isExpiringSoon(dateValue: string | Date | null | undefined, now = new Date(), windowDays = 30): boolean {
  const remaining = daysUntil(dateValue, now);
  return remaining !== null && remaining >= 0 && remaining <= windowDays;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter(Boolean) as T[];
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function maybeEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export function createContentHashInput(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => normalizeWhitespace(String(part ?? ""))).join("|");
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
