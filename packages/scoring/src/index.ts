import { buildCompanyProfileSnapshot, createServiceClient, type DatabaseClient } from "@tenderlo/db";
import {
  clamp,
  daysUntil,
  isExpired,
  reconScoringConfig,
  safeJson,
  type CompanyProfileSnapshot,
  type ComplianceResult,
  type ContractorSector,
  type PecCategory,
  type Plan,
  type RecommendationStatus,
  type RecommendationResult,
  type TenderScoringInput
} from "@tenderlo/shared";

export const pecRank: Record<PecCategory, number> = {
  "C-A": 8,
  "C-B": 7,
  "C-1": 6,
  "C-2": 5,
  "C-3": 4,
  "C-4": 3,
  "C-5": 2,
  "C-6": 1,
  unknown: 0
};

export const planLimits: Record<Plan, { users: number; savedSearches: number; profileDocuments: number; complianceChecksPerMonth: number; newspaperCoverage: boolean; opsReviewedData: boolean; phase2Tools: boolean }> = {
  starter: {
    users: 2,
    savedSearches: 5,
    profileDocuments: 10,
    complianceChecksPerMonth: 15,
    newspaperCoverage: false,
    opsReviewedData: false,
    phase2Tools: false
  },
  growth: {
    users: 8,
    savedSearches: 25,
    profileDocuments: 100,
    complianceChecksPerMonth: 100,
    newspaperCoverage: true,
    opsReviewedData: false,
    phase2Tools: false
  },
  pro: {
    users: 25,
    savedSearches: 100,
    profileDocuments: 500,
    complianceChecksPerMonth: 500,
    newspaperCoverage: true,
    opsReviewedData: true,
    phase2Tools: true
  },
  enterprise: {
    users: 500,
    savedSearches: 1000,
    profileDocuments: 5000,
    complianceChecksPerMonth: 5000,
    newspaperCoverage: true,
    opsReviewedData: true,
    phase2Tools: true
  }
};

const criticalDocumentTypes = ["pec_license", "tax_certificate", "bank_letter"];
const recommendedDocumentTypes = ["experience_certificate", "audited_financials", "insurance", "guarantee"];

export function requiredPecForValue(value: number | null | undefined): PecCategory {
  if (!value || value <= 0) return "unknown";
  if (value >= 4_000_000_000) return "C-A";
  if (value >= 2_500_000_000) return "C-B";
  if (value >= 1_000_000_000) return "C-1";
  if (value >= 500_000_000) return "C-2";
  if (value >= 200_000_000) return "C-3";
  if (value >= 50_000_000) return "C-4";
  if (value >= 15_000_000) return "C-5";
  return "C-6";
}

export function isPecSufficient(companyCategory: PecCategory, requiredCategory: PecCategory): boolean | "unknown" {
  if (requiredCategory === "unknown" || companyCategory === "unknown") return "unknown";
  return pecRank[companyCategory] >= pecRank[requiredCategory];
}

export function scoreRecommendation(profile: CompanyProfileSnapshot, tender: TenderScoringInput): RecommendationResult {
  const compliance = runComplianceCheck(profile, tender);
  const blockers = [...compliance.blockers];
  const warnings = [...compliance.warnings];
  const positiveReasons: string[] = [];

  if (blockers.length) {
    return {
      score: 0,
      status: "blocked",
      positiveReasons,
      warnings,
      blockers,
      missingDocuments: compliance.missingDocuments,
      nextAction: "Resolve blockers before preparing a bid-readiness pack."
    };
  }

  let score = 0;
  const requiredPec = detectRequiredPec(tender);
  const pecStatus = isPecSufficient(profile.pecCategory, requiredPec);
  if (pecStatus === true) {
    score += reconScoringConfig.weights.pecValueEligibility;
    positiveReasons.push(`PEC category ${profile.pecCategory} covers detected requirement ${requiredPec}.`);
  } else if (pecStatus === "unknown") {
    score += reconScoringConfig.warningScores.unknownPec;
    warnings.push("PEC requirement or company PEC category is unknown and needs review.");
  }

  if (tender.sector && profile.sectors.includes(tender.sector)) {
    score += reconScoringConfig.weights.sectorSpecialization;
    positiveReasons.push(`Tender sector ${formatSector(tender.sector)} matches company focus.`);
  } else if (tender.sector && tender.sector !== "uncategorized") {
    score += reconScoringConfig.warningScores.sectorMismatch;
    warnings.push(`Tender sector ${formatSector(tender.sector)} is not clearly listed in the company profile.`);
  } else {
    score += reconScoringConfig.warningScores.uncategorizedSector;
    warnings.push("Tender sector is uncategorized and should be reviewed.");
  }

  const tenderRegion = tender.city ?? tender.province;
  if (tenderRegion && profile.operatingRegions.some((region) => tenderRegion.toLowerCase().includes(region.toLowerCase()) || region.toLowerCase().includes(tenderRegion.toLowerCase()))) {
    score += reconScoringConfig.weights.geography;
    positiveReasons.push(`Tender location matches operating region ${tenderRegion}.`);
  } else if (!tenderRegion) {
    score += reconScoringConfig.warningScores.unknownGeography;
    warnings.push("Tender geography is unknown.");
  } else {
    score += reconScoringConfig.warningScores.outsideGeography;
    warnings.push(`Tender is outside listed operating regions: ${tenderRegion}.`);
  }

  const documentReadiness = calculateDocumentReadiness(profile);
  score += Math.round(documentReadiness.score * reconScoringConfig.weights.documentReadiness);
  positiveReasons.push(...documentReadiness.positiveReasons);
  warnings.push(...documentReadiness.warnings);

  const deadlineScore = calculateDeadlineScore(tender.closingDate);
  score += deadlineScore.score;
  if (deadlineScore.reason) {
    if (deadlineScore.score >= 7) positiveReasons.push(deadlineScore.reason);
    else warnings.push(deadlineScore.reason);
  }

  const finalScore = Math.round(clamp(score, 0, 100));
  return {
    score: finalScore,
    status: warnings.length || compliance.unknowns.length ? "warning" : "recommended",
    positiveReasons,
    warnings: [...new Set([...warnings, ...compliance.unknowns.map((unknown) => `${unknown} is unknown and needs review.`)])],
    blockers,
    missingDocuments: compliance.missingDocuments,
    nextAction: finalScore >= reconScoringConfig.strongRecommendationThreshold ? "Prepare bid documents and verify extracted requirements." : "Review warnings and complete missing Profile Vault evidence before bidding."
  };
}

export function runComplianceCheck(profile: CompanyProfileSnapshot, tender: TenderScoringInput): ComplianceResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const unknowns: string[] = [];
  const missingDocuments: string[] = [];
  const expiredDocuments: string[] = [];

  const days = daysUntil(tender.closingDate);
  if (days !== null && days < 0) {
    blockers.push("Tender closing date has passed.");
  } else if (days === null) {
    unknowns.push("closing date");
  } else if (days < 5) {
    warnings.push("Tender has a short preparation window.");
  }

  const requiredPec = detectRequiredPec(tender);
  const pecStatus = isPecSufficient(profile.pecCategory, requiredPec);
  if (pecStatus === false) {
    blockers.push(`Company PEC category ${profile.pecCategory} is below detected requirement ${requiredPec}.`);
  } else if (pecStatus === "unknown") {
    unknowns.push("PEC category requirement");
  }

  if (tender.sector && tender.sector !== "uncategorized" && !profile.sectors.includes(tender.sector)) {
    warnings.push(`Company specialization does not clearly match ${formatSector(tender.sector)}.`);
  } else if (!tender.sector || tender.sector === "uncategorized") {
    unknowns.push("tender sector");
  }

  for (const documentType of criticalDocumentTypes) {
    const doc = profile.documents.find((entry) => entry.documentType === documentType);
    if (!doc) {
      missingDocuments.push(documentType);
      if (documentType === "pec_license") blockers.push("PEC license document is missing from Profile Vault.");
      else warnings.push(`${formatDocumentType(documentType)} is missing from Profile Vault.`);
      continue;
    }
    if (doc.verificationStatus === "expired" || isExpired(doc.expiryDate)) {
      expiredDocuments.push(documentType);
      if (documentType === "pec_license") blockers.push("PEC license document is expired.");
      else warnings.push(`${formatDocumentType(documentType)} is expired.`);
    }
  }

  for (const documentType of recommendedDocumentTypes) {
    const doc = profile.documents.find((entry) => entry.documentType === documentType);
    if (!doc) missingDocuments.push(documentType);
    else if (doc.verificationStatus === "expired" || isExpired(doc.expiryDate)) expiredDocuments.push(documentType);
  }

  if (!profile.engineers.length) {
    warnings.push("No engineer records are available in Profile Vault.");
  }
  if (profile.engineers.some((engineer) => engineer.verificationStatus === "expired" || isExpired(engineer.expiryDate))) {
    warnings.push("One or more engineer verification records are expired.");
  }

  let status: ComplianceResult["status"] = "eligible";
  if (blockers.length) status = "not_eligible";
  else if (unknowns.length) status = "unknown";
  else if (warnings.length || missingDocuments.length || expiredDocuments.length) status = "eligible_with_warnings";

  return {
    status,
    detectedRequirements: tender.extractedRequirements,
    missingDocuments: [...new Set(missingDocuments)],
    expiredDocuments: [...new Set(expiredDocuments)],
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
    unknowns: [...new Set(unknowns)],
    profileSnapshot: profile
  };
}

export function detectRequiredPec(tender: TenderScoringInput): PecCategory {
  const explicit = tender.extractedRequirements.pec_category;
  if (typeof explicit === "string" && explicit in pecRank) return explicit as PecCategory;
  return requiredPecForValue(tender.estimatedValue);
}

export function canUseFeature(
  plan: Plan,
  feature: "newspaperCoverage" | "opsReviewedData" | "phase2Tools",
  subscriptionStatus: "trialing" | "active" | "past_due" | "cancelled" | "manual_invoice",
  gracePeriodActive = false
): boolean {
  if (subscriptionStatus === "cancelled") return false;
  if (subscriptionStatus === "past_due" && !gracePeriodActive) return false;
  if (subscriptionStatus === "manual_invoice") return plan === "enterprise";
  return planLimits[plan][feature];
}

export function scorePartnerFit(
  left: { sectors: ContractorSector[]; operatingRegions: string[]; pecCategory: PecCategory },
  right: { sectors: ContractorSector[]; operatingRegions: string[]; pecCategory: PecCategory }
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const sharedSectors = left.sectors.filter((sector) => right.sectors.includes(sector));
  if (sharedSectors.length) {
    score += Math.min(45, sharedSectors.length * 15);
    reasons.push(`Shared sectors: ${sharedSectors.map(formatSector).join(", ")}.`);
  }
  const sharedRegions = left.operatingRegions.filter((region) => right.operatingRegions.some((candidate) => candidate.toLowerCase() === region.toLowerCase()));
  if (sharedRegions.length) {
    score += Math.min(30, sharedRegions.length * 10);
    reasons.push(`Shared operating regions: ${sharedRegions.join(", ")}.`);
  }
  const pecGap = Math.abs(pecRank[left.pecCategory] - pecRank[right.pecCategory]);
  if (pecGap <= 2 && left.pecCategory !== "unknown" && right.pecCategory !== "unknown") {
    score += 25 - pecGap * 5;
    reasons.push(`PEC categories ${left.pecCategory} and ${right.pecCategory} are compatible for JV review.`);
  }
  return { score: Math.round(clamp(score, 0, 100)), reasons };
}

export interface RecommendationRebuildRecord {
  organizationId: string;
  tenderId: string;
  score: number;
  status: RecommendationStatus;
  title: string;
}

export async function rebuildRecommendationRecords(
  organizationId?: string,
  supabase: DatabaseClient = createServiceClient()
): Promise<RecommendationRebuildRecord[]> {
  let orgQuery = supabase.from("organizations").select("id");
  if (organizationId) orgQuery = orgQuery.eq("id", organizationId);
  const { data: organizations, error: orgError } = await orgQuery;
  if (orgError) throw orgError;

  const { data: tenders, error: tenderError } = await supabase
    .from("tenders")
    .select("*")
    .in("status", ["published", "corrigendum"])
    .order("closing_date", { ascending: true, nullsFirst: false });
  if (tenderError) throw tenderError;

  const rebuilt: RecommendationRebuildRecord[] = [];
  for (const org of (organizations ?? []) as Array<{ id: string }>) {
    const profile = await buildCompanyProfileSnapshot(supabase, org.id);
    for (const tender of (tenders ?? []) as any[]) {
      const input = await buildTenderScoringInput(supabase, tender);
      const result = scoreRecommendation(profile, input);
      await supabase.from("recommendations").upsert(
        {
          organization_id: org.id,
          tender_id: tender.id,
          score: result.score,
          status: result.status,
          positive_reasons: result.positiveReasons,
          warnings: result.warnings,
          blockers: result.blockers,
          next_action: result.nextAction,
          calculated_at: new Date().toISOString()
        },
        { onConflict: "organization_id,tender_id" }
      );
      rebuilt.push({
        organizationId: org.id,
        tenderId: tender.id,
        score: result.score,
        status: result.status,
        title: tender.title
      });
    }
  }
  return rebuilt;
}

export async function runComplianceForOrganizationTender(
  organizationId: string,
  tenderId: string,
  createdBy?: string,
  supabase: DatabaseClient = createServiceClient()
): Promise<string> {
  const profile = await buildCompanyProfileSnapshot(supabase, organizationId);
  const { data: tender, error } = await supabase.from("tenders").select("*").eq("id", tenderId).single();
  if (error) throw error;
  const result = runComplianceCheck(profile, await buildTenderScoringInput(supabase, tender));
  const { data: check, error: insertError } = await supabase
    .from("compliance_checks")
    .insert({
      organization_id: organizationId,
      tender_id: tenderId,
      status: result.status,
      detected_requirements: safeJson(result.detectedRequirements),
      missing_documents: result.missingDocuments,
      expired_documents: result.expiredDocuments,
      warnings: result.warnings,
      blockers: result.blockers,
      profile_snapshot: safeJson(result.profileSnapshot),
      created_by: createdBy ?? null
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return check.id;
}

export async function loadTenderRequirements(
  supabase: DatabaseClient,
  tenderId: string
): Promise<Record<string, string | number | null>> {
  const { data } = await supabase
    .from("extracted_fields")
    .select("field_name, field_value, confidence_score")
    .eq("tender_id", tenderId)
    .neq("verification_status", "rejected")
    .order("confidence_score", { ascending: false });
  const requirements: Record<string, string | number | null> = {};
  for (const field of (data ?? []) as Array<{ field_name: string; field_value: string }>) {
    if (requirements[field.field_name] === undefined) requirements[field.field_name] = field.field_value;
  }
  return requirements;
}

async function buildTenderScoringInput(supabase: DatabaseClient, tender: any): Promise<TenderScoringInput> {
  return {
    tenderId: tender.id,
    title: tender.title,
    sector: tender.sector,
    province: tender.province,
    city: tender.city,
    closingDate: tender.closing_date,
    estimatedValue: tender.estimated_value ? Number(tender.estimated_value) : null,
    extractedRequirements: await loadTenderRequirements(supabase, tender.id)
  };
}

function calculateDocumentReadiness(profile: CompanyProfileSnapshot): { score: number; positiveReasons: string[]; warnings: string[] } {
  const positiveReasons: string[] = [];
  const warnings: string[] = [];
  const requiredDocs = [...criticalDocumentTypes, ...recommendedDocumentTypes];
  const readyDocs = requiredDocs.filter((documentType) => {
    const doc = profile.documents.find((entry) => entry.documentType === documentType);
    return doc && doc.verificationStatus !== "expired" && !isExpired(doc.expiryDate);
  });
  const score = readyDocs.length / requiredDocs.length;
  if (readyDocs.length) positiveReasons.push(`${readyDocs.length} key Profile Vault documents are available.`);
  if (readyDocs.length < requiredDocs.length) warnings.push(`${requiredDocs.length - readyDocs.length} key Profile Vault documents are missing or expired.`);
  return { score, positiveReasons, warnings };
}

function calculateDeadlineScore(closingDate: string | null): { score: number; reason: string | null } {
  const days = daysUntil(closingDate);
  if (days === null) return { score: reconScoringConfig.warningScores.unknownDeadline, reason: "Deadline is unknown and needs verification." };
  if (days < 0) return { score: 0, reason: "Tender is already closed." };
  if (days <= reconScoringConfig.preparationWindows.urgentDays) return { score: reconScoringConfig.warningScores.urgentDeadline, reason: "Tender has less than four days remaining." };
  if (days <= reconScoringConfig.preparationWindows.tightDays) return { score: reconScoringConfig.warningScores.tightDeadline, reason: "Tender has a tight one-week preparation window." };
  if (days <= reconScoringConfig.preparationWindows.workableDays) return { score: reconScoringConfig.weights.deadlineWindow, reason: "Tender has a workable preparation window." };
  return { score: reconScoringConfig.warningScores.longDeadline, reason: "Tender has a long preparation window." };
}

function formatSector(sector: ContractorSector): string {
  return sector.replaceAll("_", " ");
}

function formatDocumentType(documentType: string): string {
  return documentType.replaceAll("_", " ");
}
