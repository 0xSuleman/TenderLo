export const sourceRuntimeConfig = {
  maxLinksPerSourceRun: 50,
  politeRequestDelayMs: 750,
  publicPortalFrequencyMinutes: 15,
  newspaperFrequencyMinutes: 1440,
  maxDocumentsPerTender: 10,
  pageFetchTimeoutMs: 15_000,
  documentFetchTimeoutMs: 30_000
} as const;

export const parsingRuntimeConfig = {
  minPdfTextCharsBeforeOcr: 40,
  ocrTimeoutMs: 120_000,
  ocrMaxPdfPages: 3,
  ocrMaxBufferBytes: 20 * 1024 * 1024,
  tesseractLanguages: process.env.TENDERLO_TESSERACT_LANGUAGES ?? "eng+urd",
  confidence: {
    htmlSelector: 0.86,
    htmlGeneric: 0.72,
    docxText: 0.88,
    pdfText: 0.82,
    ocrFallback: 0.62
  }
} as const;

export const intelligenceRuntimeConfig = {
  confidence: {
    numericDate: 0.78,
    namedDate: 0.86,
    money: 0.82,
    pecCategory: 0.9,
    province: 0.78,
    city: 0.76,
    keywordWindowBoost: 0.08,
    maxRuleConfidence: 0.96,
    needsReviewThreshold: 0.75
  },
  classification: {
    titleKeywordWeight: 5,
    bodyKeywordWeight: 2,
    primarySectorMinimumScore: 4
  },
  duplicate: {
    sameSourceUrlWeight: 0.45,
    sameTenderNumberWeight: 0.28,
    titleSimilarityWeight: 0.28,
    titleSimilarityReasonThreshold: 0.75,
    sameDepartmentWeight: 0.12,
    sameClosingDateWeight: 0.12,
    sameBidSecurityWeight: 0.08,
    autoMergeThreshold: 0.86,
    reviewThreshold: 0.55
  }
} as const;

export const pipelineRuntimeConfig = {
  defaultExtractionConfidence: 0.55,
  publishConfidenceThreshold: 0.68,
  lowConfidenceFieldThreshold: 0.7,
  highRecommendationAlertThreshold: 75,
  notificationBatchSize: 100,
  maxNotificationDeliveryAttempts: 5,
  subscriptionPeriodDays: 30
} as const;

export const reconScoringConfig = {
  weights: {
    pecValueEligibility: 35,
    sectorSpecialization: 25,
    geography: 15,
    documentReadiness: 15,
    deadlineWindow: 10
  },
  warningScores: {
    unknownPec: 12,
    sectorMismatch: 10,
    uncategorizedSector: 5,
    unknownGeography: 5,
    outsideGeography: 7,
    unknownDeadline: 2,
    urgentDeadline: 2,
    tightDeadline: 6,
    longDeadline: 8
  },
  strongRecommendationThreshold: 75,
  preparationWindows: {
    urgentDays: 3,
    tightDays: 7,
    workableDays: 21
  }
} as const;

export const profileCompletenessConfig = {
  companyBusinessType: 10,
  companyNtn: 10,
  operatingRegions: 10,
  sectors: 10,
  pecLicense: 20,
  engineers: 10,
  equipment: 10,
  profileDocument: 5,
  maxScore: 100,
  profileDocuments: ["tax_certificate", "experience_certificate", "audited_financials", "bank_letter"]
} as const;

export const billingRuntimeConfig = {
  planPricesPkr: {
    starter: 4500,
    growth: 14500,
    pro: 34500
  },
  defaultSubscriptionPeriodDays: 30
} as const;
