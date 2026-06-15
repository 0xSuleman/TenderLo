import { describe, expect, it } from "vitest";
import { canUseFeature, requiredPecForValue, runComplianceCheck, scorePartnerFit, scoreRecommendation } from "@tenderlo/scoring";
import type { CompanyProfileSnapshot, TenderScoringInput } from "@tenderlo/shared";

const profile: CompanyProfileSnapshot = {
  organizationId: "org",
  sectors: ["roads", "construction"],
  operatingRegions: ["Punjab", "Lahore"],
  pecCategory: "C-3",
  specializationCodes: ["CE01"],
  documents: [
    { documentType: "pec_license", verificationStatus: "verified", expiryDate: "2027-01-01" },
    { documentType: "tax_certificate", verificationStatus: "verified", expiryDate: "2027-01-01" },
    { documentType: "bank_letter", verificationStatus: "verified", expiryDate: "2027-01-01" },
    { documentType: "experience_certificate", verificationStatus: "verified", expiryDate: null },
    { documentType: "audited_financials", verificationStatus: "verified", expiryDate: null }
  ],
  engineers: [{ discipline: "Civil", verificationStatus: "verified", expiryDate: "2027-01-01" }],
  equipmentCount: 4
};

const tender: TenderScoringInput = {
  tenderId: "tender",
  title: "Road works",
  sector: "roads",
  province: "Punjab",
  city: "Lahore",
  closingDate: "2026-06-20T10:00:00.000Z",
  estimatedValue: 150_000_000,
  extractedRequirements: { pec_category: "C-4" }
};

describe("RECON scoring and compliance", () => {
  it("maps project value to PEC requirement", () => {
    expect(requiredPecForValue(60_000_000)).toBe("C-4");
    expect(requiredPecForValue(2_600_000_000)).toBe("C-B");
  });

  it("scores eligible tenders with explainable reasons", () => {
    const rec = scoreRecommendation(profile, tender);
    expect(rec.score).toBeGreaterThan(70);
    expect(rec.blockers).toHaveLength(0);
    expect(rec.positiveReasons.length).toBeGreaterThan(0);
  });

  it("keeps unknown compliance data visible", () => {
    const result = runComplianceCheck({ ...profile, pecCategory: "unknown" }, { ...tender, extractedRequirements: {}, estimatedValue: null });
    expect(result.status).toBe("unknown");
    expect(result.unknowns).toContain("PEC category requirement");
  });

  it("blocks expired PEC documents", () => {
    const result = runComplianceCheck(
      {
        ...profile,
        documents: [{ documentType: "pec_license", verificationStatus: "expired", expiryDate: "2020-01-01" }]
      },
      tender
    );
    expect(result.status).toBe("not_eligible");
    expect(result.blockers.some((blocker) => blocker.includes("expired"))).toBe(true);
  });

  it("enforces server-side plan feature gates", () => {
    expect(canUseFeature("starter", "newspaperCoverage", "active")).toBe(false);
    expect(canUseFeature("pro", "phase2Tools", "active")).toBe(true);
    expect(canUseFeature("pro", "phase2Tools", "past_due")).toBe(false);
  });

  it("scores Phase 2 partner fit deterministically", () => {
    const fit = scorePartnerFit(
      { sectors: ["roads"], operatingRegions: ["Punjab"], pecCategory: "C-3" },
      { sectors: ["roads", "bridges"], operatingRegions: ["Punjab"], pecCategory: "C-4" }
    );
    expect(fit.score).toBeGreaterThan(40);
  });
});
