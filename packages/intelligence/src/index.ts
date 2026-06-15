import {
  clamp,
  contractorSectors,
  createContentHashInput,
  intelligenceRuntimeConfig,
  majorPakistanCities,
  normalizeForSearch,
  normalizeWhitespace,
  pakistanProvinces,
  type ContractorSector,
  type DuplicateCandidateResult,
  type ExtractedFieldResult,
  type SectorMatch
} from "@tenderlo/shared";

export const pecRequirementPattern = /\b(C-A|C-B|C-1|C-2|C-3|C-4|C-5|C-6)\b/gi;

const monthMap: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const sectorKeywords: Record<ContractorSector, string[]> = {
  construction: ["construction", "civil work", "civil works", "civil contractor"],
  roads: ["road", "roads", "carpet", "pavement", "asphalt", "street"],
  highways: ["highway", "motorway", "nh", "nha", "interchange"],
  bridges: ["bridge", "culvert", "flyover", "underpass"],
  buildings: ["building", "school", "hospital", "office block", "residential", "renovation"],
  MEP: ["mep", "electro mechanical", "electromechanical"],
  electrical: ["electrical", "wiring", "transformer", "substation", "lt", "ht", "feeder"],
  power: ["power", "solar", "grid", "transmission", "distribution", "generator"],
  mechanical: ["mechanical", "machinery", "pump", "boiler", "compressor"],
  HVAC: ["hvac", "air conditioning", "chiller", "ventilation", "cooling"],
  plumbing: ["plumbing", "pipe", "piping", "water supply line", "sanitary"],
  fire_safety: ["fire safety", "fire fighting", "fire alarm", "sprinkler"],
  water: ["water", "tube well", "filtration", "drinking water", "water supply"],
  sewerage: ["sewerage", "sewer", "drainage", "storm water"],
  sanitation: ["sanitation", "solid waste", "wastewater", "cleaning"],
  telecom_infrastructure: ["telecom", "fiber", "fibre", "tower", "ofc", "low voltage"],
  IT_infrastructure: ["it infrastructure", "network", "server", "data center", "lan", "cctv"],
  oil_and_gas_works: ["oil", "gas", "pipeline", "sngpl", "ssgc", "petroleum"],
  industrial_maintenance: ["industrial", "plant maintenance", "maintenance", "overhauling", "shutdown"],
  general_contracting: ["general contracting", "miscellaneous works", "repair and maintenance"],
  uncategorized: []
};

const departmentAliases: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /\bmes\b|military engineering services/i, normalized: "Military Engineering Services" },
  { pattern: /\bnha\b|national highway authority/i, normalized: "National Highway Authority" },
  { pattern: /\bcda\b|capital development authority/i, normalized: "Capital Development Authority" },
  { pattern: /\bwasa\b|water and sanitation agency/i, normalized: "Water and Sanitation Agency" },
  { pattern: /\bwapda\b|water and power development authority/i, normalized: "Water and Power Development Authority" },
  { pattern: /\bogdcl\b|oil and gas development company/i, normalized: "Oil and Gas Development Company Limited" },
  { pattern: /\bsngpl\b|sui northern gas/i, normalized: "Sui Northern Gas Pipelines Limited" },
  { pattern: /\bssgc\b|sui southern gas/i, normalized: "Sui Southern Gas Company" },
  { pattern: /\bpunjab\b.*health/i, normalized: "Punjab Health Department" },
  { pattern: /\bsindh\b.*works/i, normalized: "Sindh Works and Services Department" }
];

export function parseDateCandidates(text: string): Array<{ value: string; evidence: string; confidence: number }> {
  const normalized = normalizeWhitespace(text);
  const results: Array<{ value: string; evidence: string; confidence: number }> = [];
  const numericPattern = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?\b/gi;
  const namedPattern = /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?\b/gi;

  for (const match of normalized.matchAll(numericPattern)) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = normalizeYear(Number(match[3]));
    const date = buildDate(year, month, day, match[4], match[5], match[6]);
    if (date) results.push({ value: date.toISOString(), evidence: match[0], confidence: intelligenceRuntimeConfig.confidence.numericDate });
  }

  for (const match of normalized.matchAll(namedPattern)) {
    const day = Number(match[1]);
    const monthLabel = match[2];
    if (!monthLabel) continue;
    const month = monthMap[monthLabel.toLowerCase().replace(".", "")];
    const year = Number(match[3]);
    const date = buildDate(year, month, day, match[4], match[5], match[6]);
    if (date) results.push({ value: date.toISOString(), evidence: match[0], confidence: intelligenceRuntimeConfig.confidence.namedDate });
  }

  return dedupeByValue(results);
}

function normalizeYear(year: number): number {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function buildDate(
  year: number,
  month: number | undefined,
  day: number,
  hourValue?: string,
  minuteValue?: string,
  meridiem?: string
): Date | null {
  if (month === undefined || month < 0 || month > 11 || day < 1 || day > 31) return null;
  let hour = hourValue ? Number(hourValue) : 0;
  const minute = minuteValue ? Number(minuteValue) : 0;
  if (meridiem?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (meridiem?.toLowerCase() === "am" && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseMoneyCandidates(text: string): Array<{ value: number; evidence: string; confidence: number }> {
  const normalized = normalizeWhitespace(text);
  const results: Array<{ value: number; evidence: string; confidence: number }> = [];
  const moneyPattern =
    /\b(?:PKR|Rs\.?|Rupees?)\s*([0-9][0-9,]*(?:\.\d+)?)\s*(million|billion|lac|lakh|crore|m|bn)?\b|\b([0-9][0-9,]*(?:\.\d+)?)\s*(million|billion|lac|lakh|crore)\s*(?:PKR|Rs\.?|Rupees?)?\b/gi;

  for (const match of normalized.matchAll(moneyPattern)) {
    const amountText = match[1] ?? match[3];
    const multiplierText = (match[2] ?? match[4] ?? "").toLowerCase();
    const base = Number(String(amountText).replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const multiplier = multiplierText.startsWith("b") || multiplierText === "bn" ? 1_000_000_000 : multiplierText.startsWith("m") ? 1_000_000 : multiplierText === "lac" || multiplierText === "lakh" ? 100_000 : multiplierText === "crore" ? 10_000_000 : 1;
    results.push({ value: base * multiplier, evidence: match[0], confidence: intelligenceRuntimeConfig.confidence.money });
  }

  return dedupeByValue(results);
}

export function extractTenderFields(text: string): ExtractedFieldResult[] {
  const compactText = normalizeWhitespace(text);
  const fields: ExtractedFieldResult[] = [];

  fields.push(...extractDateField(compactText, "closing_date", ["closing date", "last date", "submission deadline", "bid submission", "receiving of tenders"]));
  fields.push(...extractDateField(compactText, "opening_date", ["opening date", "bid opening", "opening of tenders"]));
  fields.push(...extractMoneyField(compactText, "bid_security_amount", ["bid security", "earnest money", "security deposit", "call deposit", "bid bond"]));
  fields.push(...extractMoneyField(compactText, "estimated_value", ["estimated cost", "estimated value", "nit cost", "engineer estimate", "project cost"]));
  fields.push(...extractMoneyField(compactText, "document_fee", ["tender fee", "document fee", "bidding document fee"]));

  const pecMatches = [...compactText.matchAll(pecRequirementPattern)];
  for (const match of pecMatches) {
    fields.push({
      fieldName: "pec_category",
      fieldValue: (match[1] ?? "unknown").toUpperCase(),
      sourceMethod: "regex",
      confidenceScore: intelligenceRuntimeConfig.confidence.pecCategory,
      evidenceText: windowAround(compactText, match.index ?? 0, 140),
      verificationStatus: "unverified"
    });
  }

  const geography = detectGeography(compactText);
  if (geography.province) {
    fields.push({
      fieldName: "province",
      fieldValue: geography.province,
      sourceMethod: "keyword_window",
      confidenceScore: intelligenceRuntimeConfig.confidence.province,
      evidenceText: geography.evidence,
      verificationStatus: "unverified"
    });
  }
  if (geography.city) {
    fields.push({
      fieldName: "city",
      fieldValue: geography.city,
      sourceMethod: "keyword_window",
      confidenceScore: intelligenceRuntimeConfig.confidence.city,
      evidenceText: geography.evidence,
      verificationStatus: "unverified"
    });
  }

  return collapseFieldCandidates(fields);
}

function extractDateField(text: string, fieldName: string, keywords: string[]): ExtractedFieldResult[] {
  const fields: ExtractedFieldResult[] = [];
  for (const keyword of keywords) {
    for (const index of findAllIndexes(text.toLowerCase(), keyword)) {
      const evidenceText = windowAround(text, index, 220);
      const dates = parseDateCandidates(evidenceText);
      for (const date of dates.slice(0, 2)) {
        fields.push({
          fieldName,
          fieldValue: date.value,
          sourceMethod: "keyword_window",
          confidenceScore: clamp(date.confidence + intelligenceRuntimeConfig.confidence.keywordWindowBoost, 0, intelligenceRuntimeConfig.confidence.maxRuleConfidence),
          evidenceText,
          verificationStatus: date.confidence >= intelligenceRuntimeConfig.confidence.needsReviewThreshold ? "unverified" : "needs_review"
        });
      }
    }
  }
  return fields;
}

function extractMoneyField(text: string, fieldName: string, keywords: string[]): ExtractedFieldResult[] {
  const fields: ExtractedFieldResult[] = [];
  for (const keyword of keywords) {
    for (const index of findAllIndexes(text.toLowerCase(), keyword)) {
      const evidenceText = windowAround(text, index, 240);
      const money = parseMoneyCandidates(evidenceText);
      for (const amount of money.slice(0, 2)) {
        fields.push({
          fieldName,
          fieldValue: String(amount.value),
          sourceMethod: "keyword_window",
          confidenceScore: clamp(amount.confidence + intelligenceRuntimeConfig.confidence.keywordWindowBoost, 0, intelligenceRuntimeConfig.confidence.maxRuleConfidence),
          evidenceText,
          verificationStatus: amount.confidence >= intelligenceRuntimeConfig.confidence.needsReviewThreshold ? "unverified" : "needs_review"
        });
      }
    }
  }
  return fields;
}

export function detectGeography(text: string): { province: string | null; city: string | null; evidence: string } {
  const normalized = normalizeForSearch(text);
  const province = pakistanProvinces.find((item) => normalized.includes(normalizeForSearch(item))) ?? null;
  const city = majorPakistanCities.find((item) => normalized.includes(normalizeForSearch(item))) ?? null;
  const target = city ?? province;
  const evidence = target ? windowAround(text, normalized.indexOf(normalizeForSearch(target)), 120) : "";
  return { province, city, evidence };
}

export function normalizeDepartment(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(value);
  const alias = departmentAliases.find((entry) => entry.pattern.test(normalized));
  return alias?.normalized ?? normalized;
}

export function classifyTender(input: { title: string; description?: string | null; body?: string | null }): SectorMatch[] {
  const title = normalizeForSearch(input.title);
  const body = normalizeForSearch(`${input.description ?? ""} ${input.body ?? ""}`);
  const matches: SectorMatch[] = [];

  for (const sector of contractorSectors) {
    if (sector === "uncategorized") continue;
    const matchedKeywords: string[] = [];
    let score = 0;
    for (const keyword of sectorKeywords[sector]) {
      const normalizedKeyword = normalizeForSearch(keyword);
      if (title.includes(normalizedKeyword)) {
        score += intelligenceRuntimeConfig.classification.titleKeywordWeight;
        matchedKeywords.push(keyword);
      }
      if (body.includes(normalizedKeyword)) {
        score += intelligenceRuntimeConfig.classification.bodyKeywordWeight;
        matchedKeywords.push(keyword);
      }
    }
    if (score > 0) {
      matches.push({
        sector,
        score,
        matchedKeywords: [...new Set(matchedKeywords)],
        isPrimary: false
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  if (matches[0] && matches[0].score >= intelligenceRuntimeConfig.classification.primarySectorMinimumScore) {
    matches[0].isPrimary = true;
    return matches;
  }

  return [
    {
      sector: "uncategorized",
      score: 0,
      matchedKeywords: [],
      isPrimary: true
    }
  ];
}

export function calculateDuplicateConfidence(
  tender: {
    id?: string;
    source_url?: string | null;
    tender_number?: string | null;
    normalized_title: string;
    department?: string | null;
    closing_date?: string | null;
    bid_security_amount?: number | null;
  },
  candidate: {
    id: string;
    source_url?: string | null;
    tender_number?: string | null;
    normalized_title: string;
    department?: string | null;
    closing_date?: string | null;
    bid_security_amount?: number | null;
  }
): DuplicateCandidateResult {
  const reasons: string[] = [];
  let score = 0;

  if (tender.source_url && candidate.source_url && tender.source_url === candidate.source_url) {
    score += intelligenceRuntimeConfig.duplicate.sameSourceUrlWeight;
    reasons.push("same source URL");
  }
  if (tender.tender_number && candidate.tender_number && normalizeForSearch(tender.tender_number) === normalizeForSearch(candidate.tender_number)) {
    score += intelligenceRuntimeConfig.duplicate.sameTenderNumberWeight;
    reasons.push("same tender number");
  }
  const titleSimilarity = tokenSimilarity(tender.normalized_title, candidate.normalized_title);
  score += titleSimilarity * intelligenceRuntimeConfig.duplicate.titleSimilarityWeight;
  if (titleSimilarity > intelligenceRuntimeConfig.duplicate.titleSimilarityReasonThreshold) reasons.push("similar normalized title");

  if (tender.department && candidate.department && normalizeForSearch(tender.department) === normalizeForSearch(candidate.department)) {
    score += intelligenceRuntimeConfig.duplicate.sameDepartmentWeight;
    reasons.push("same department");
  }
  if (tender.closing_date && candidate.closing_date && tender.closing_date.slice(0, 10) === candidate.closing_date.slice(0, 10)) {
    score += intelligenceRuntimeConfig.duplicate.sameClosingDateWeight;
    reasons.push("same closing date");
  }
  if (tender.bid_security_amount && candidate.bid_security_amount && Math.abs(tender.bid_security_amount - candidate.bid_security_amount) < 1) {
    score += intelligenceRuntimeConfig.duplicate.sameBidSecurityWeight;
    reasons.push("same bid security");
  }

  const confidenceScore = clamp(score, 0, 1);
  return {
    candidateTenderId: candidate.id,
    confidenceScore,
    reasons,
    action: confidenceScore >= intelligenceRuntimeConfig.duplicate.autoMergeThreshold ? "merge" : confidenceScore >= intelligenceRuntimeConfig.duplicate.reviewThreshold ? "review" : "keep"
  };
}

export function buildCanonicalTenderId(input: {
  sourceId: string;
  sourceUrl?: string | null;
  tenderNumber?: string | null;
  title: string;
  department?: string | null;
  closingDate?: string | null;
}): string {
  return normalizeForSearch(
    createContentHashInput([input.sourceId, input.sourceUrl, input.tenderNumber, input.title, input.department, input.closingDate?.slice(0, 10)])
  ).slice(0, 420);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeForSearch(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeForSearch(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function windowAround(text: string, index: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return normalizeWhitespace(text.slice(start, end));
}

function findAllIndexes(text: string, needle: string): number[] {
  const indexes: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return indexes;
}

function dedupeByValue<T extends { value: string | number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collapseFieldCandidates(fields: ExtractedFieldResult[]): ExtractedFieldResult[] {
  const best = new Map<string, ExtractedFieldResult>();
  for (const field of fields) {
    const key = `${field.fieldName}:${field.fieldValue}`;
    const current = best.get(key);
    if (!current || field.confidenceScore > current.confidenceScore) {
      best.set(key, field);
    }
  }
  return [...best.values()].sort((a, b) => b.confidenceScore - a.confidenceScore);
}
